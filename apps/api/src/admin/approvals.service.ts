import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNotNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  APPROVAL_KIND_INFO,
  DEFAULT_SECURITY_SETTINGS,
  rolesWith,
  type AdminPermission,
  type AdminRole,
  type ApprovalKind,
} from '@jiffo/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { conflict, forbidden, notFound } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { DB, type Db } from '../db/database.module';
import { adminApprovals, admins } from '../db/schema';
import { AuditService } from './audit.service';
import type { AdminContext } from './admin.types';
import { can } from './permissions';

type Row = typeof adminApprovals.$inferSelect;
const HOUR_MS = 3_600_000;
/** How long a request may run before it is taken to have stopped part way (the server restarted, say). */
const STUCK_MS = 10 * 60_000;

/** One change to ask for: what it is, who it touches, why, and the request exactly as it will run. */
export interface ApprovalRequest {
  kind: ApprovalKind;
  payload: Record<string, unknown>;
  summary: string;
  note: string;
  countryCode?: string | null;
  targetType?: string;
  targetId?: string;
}

/** Runs an approved change as the person who asked for it. */
export type Executor = (as: AdminContext, payload: Record<string, unknown>) => Promise<unknown>;

/**
 * A country's Security settings, or the defaults when it has none or its stored version can't be read: a
 * broken version must not stop the change that fixes it.
 */
export async function securityOf(countries: CountriesService, countryCode: string) {
  try {
    const current = await countries.currentSettingsIfAny(countryCode);
    return current?.settings.security ?? DEFAULT_SECURITY_SETTINGS;
  } catch (error) {
    // Only a stored version that no longer reads; anything else (the database being down) is an error.
    // Checked by name: the settings schema may come from another copy of zod (@jiffo/shared's build).
    if (error instanceof Error && error.name === 'ZodError') return DEFAULT_SECURITY_SETTINGS;
    throw error;
  }
}

/** What an API error said, for the record. */
const messageOf = (error: unknown) => {
  if (error instanceof HttpException) {
    const body = error.getResponse() as { error?: { message?: string } } | string;
    return typeof body === 'string' ? body : (body.error?.message ?? error.message);
  }
  return 'Something went wrong';
};

/** A result kept with the approval: only plain data. */
const plain = (value: unknown): Record<string, unknown> | null => {
  if (value === undefined || value === null) return null;
  const copy = JSON.parse(JSON.stringify(value)) as unknown;
  return copy && typeof copy === 'object' && !Array.isArray(copy) ? (copy as Record<string, unknown>) : { value: copy };
};

/**
 * Two-person approval (docs/security-plan.md, D3, D4, X7). A change that needs it waits until another admin
 * whose role allows it approves; it then runs as the person who asked, with both names in the audit log.
 * The person who asked can't approve it, which the database also refuses. When nobody else holds the
 * permission at all (a team of one owner), it runs straight away, marked as approved by themselves.
 */
@Injectable()
export class ApprovalsService {
  private readonly logger = new Logger(ApprovalsService.name);
  private readonly executors = new Map<ApprovalKind, Executor>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly countries: CountriesService,
  ) {}

  /** Each service registers how its kind of change runs, so this service depends on none of them. */
  register(kind: ApprovalKind, run: Executor) {
    this.executors.set(kind, run);
  }

  /**
   * Asks for a change. It waits for a second admin, or runs now when nobody else could approve it; the
   * answer says which.
   */
  async submit(admin: AdminContext, request: ApprovalRequest) {
    const { permission } = APPROVAL_KIND_INFO[request.kind];
    if (!can(admin.role as AdminRole, permission)) throw forbidden('not_permitted', 'Your role does not allow this');
    const others = await this.otherApprovers(permission, admin.adminId);
    const hours = await this.expiryHours(request.countryCode ?? null);
    const [row] = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(adminApprovals)
        .values({
          kind: request.kind,
          permission,
          countryCode: request.countryCode ?? null,
          targetType: request.targetType ?? null,
          targetId: request.targetId ?? null,
          summary: request.summary,
          payload: request.payload,
          requestedBy: admin.adminId,
          requestedIp: admin.ip,
          note: request.note,
          expiresAt: new Date(Date.now() + hours * HOUR_MS),
        })
        .returning();
      await this.audit.record(tx, admin, {
        action: 'approval.request',
        targetType: 'approval',
        targetId: rows[0]!.id,
        countryCode: request.countryCode ?? undefined,
        data: { kind: request.kind, summary: request.summary, note: request.note },
      });
      return rows;
    });
    if (others > 0) return { pending: true as const, approval: await this.view(row!.id) };
    // Nobody else holds this permission: it goes ahead now, recorded as approved by the person who asked.
    return this.decide(admin, row!.id, { approve: true, note: 'No other admin can approve this', self: true });
  }

  approve(admin: AdminContext, id: string, note?: string) {
    return this.decide(admin, id, { approve: true, note: note ?? null, self: false });
  }

  reject(admin: AdminContext, id: string, note: string) {
    return this.decide(admin, id, { approve: false, note, self: false });
  }

  /** The person who asked takes it back. */
  async cancel(admin: AdminContext, id: string) {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(adminApprovals)
        .set({ status: 'cancelled', decidedBy: admin.adminId, decidedAt: new Date() })
        .where(
          and(
            eq(adminApprovals.id, id),
            eq(adminApprovals.requestedBy, admin.adminId),
            eq(adminApprovals.status, 'pending'),
          ),
        )
        .returning();
      if (!row) throw conflict('approval_not_pending', 'Only your own request, while it waits, can be taken back');
      await this.audit.record(tx, admin, {
        action: 'approval.cancel',
        targetType: 'approval',
        targetId: id,
        countryCode: row.countryCode ?? undefined,
        data: { kind: row.kind, summary: row.summary },
      });
      return { approval: await this.view(id, tx) };
    });
  }

  private async decide(admin: AdminContext, id: string, how: { approve: boolean; note: string | null; self: boolean }) {
    await this.expire();
    const [found] = await this.db.select().from(adminApprovals).where(eq(adminApprovals.id, id));
    if (!found) throw notFound('approval_not_found', 'No such request');
    if (found.status !== 'pending') {
      throw conflict(
        'approval_not_pending',
        `This request is ${found.status === 'running' ? 'running' : found.status} already`,
      );
    }
    if (!can(admin.role as AdminRole, found.permission as AdminPermission)) {
      throw forbidden('not_permitted', 'Your role does not allow approving this');
    }
    // The second person rule (D3): never the one who asked, unless nobody else could.
    if (found.requestedBy === admin.adminId && !how.self) {
      throw forbidden('own_request', 'Someone else must approve your own request');
    }

    // Claimed once: two approvers at the same moment can't both run it.
    const [claimed] = await this.db
      .update(adminApprovals)
      .set({
        status: how.approve ? 'running' : 'rejected',
        decidedBy: admin.adminId,
        decidedAt: new Date(),
        decisionNote: how.note,
        selfApproved: how.self,
      })
      .where(and(eq(adminApprovals.id, id), eq(adminApprovals.status, 'pending')))
      .returning();
    if (!claimed) throw conflict('approval_not_pending', 'Someone else decided this request just now');

    if (!how.approve) {
      await this.db.transaction((tx) =>
        this.audit.record(tx, admin, {
          action: 'approval.reject',
          targetType: 'approval',
          targetId: id,
          countryCode: claimed.countryCode ?? undefined,
          data: { kind: claimed.kind, summary: claimed.summary, note: how.note },
        }),
      );
      return { approval: await this.view(id) };
    }

    let result: unknown;
    try {
      const as = await this.requester(claimed, admin, how.self);
      const run = this.executors.get(claimed.kind);
      if (!run) throw conflict('approval_unknown', 'This kind of request can no longer run');
      result = await run(as, claimed.payload);
    } catch (error) {
      await this.db
        .update(adminApprovals)
        .set({ status: 'failed', error: messageOf(error).slice(0, 500) })
        .where(eq(adminApprovals.id, id));
      throw error;
    }
    // The change has happened. If recording that fails, it is still marked approved, never failed.
    try {
      await this.db.transaction(async (tx) => {
        await tx
          .update(adminApprovals)
          .set({ status: 'approved', result: plain(result) })
          .where(eq(adminApprovals.id, id));
        await this.audit.record(tx, admin, {
          action: 'approval.approve',
          targetType: 'approval',
          targetId: id,
          countryCode: claimed.countryCode ?? undefined,
          data: { kind: claimed.kind, summary: claimed.summary, selfApproved: how.self },
        });
      });
    } catch (error) {
      this.logger.error(`Approval ${id} ran, but recording it failed: ${messageOf(error)}`);
      await this.db
        .update(adminApprovals)
        .set({ status: 'approved' })
        .where(eq(adminApprovals.id, id))
        .catch(() => undefined);
    }
    return { ...(plain(result) ?? {}), approval: await this.view(id) };
  }

  /** The person who asked, as they are now: still active, and still allowed to make this change. */
  private async requester(row: Row, decider: AdminContext, self: boolean): Promise<AdminContext> {
    const [who] = await this.db.select().from(admins).where(eq(admins.id, row.requestedBy));
    if (!who || who.status !== 'active' || !can(who.role, row.permission as AdminPermission)) {
      throw conflict('requester_not_permitted', 'The person who asked can no longer make this change');
    }
    return {
      adminId: who.id,
      sessionId: '',
      email: who.email,
      name: who.name,
      role: who.role,
      ip: row.requestedIp,
      // Runs on the approver's confirmed session: the change itself was confirmed when it was approved.
      confirmedAt: decider.confirmedAt,
      passkeyMissing: false,
      approval: { id: row.id, approvedBy: decider.adminId, selfApproved: self },
    };
  }

  /**
   * Teammates other than the one asking whose role holds the permission and who have ever signed in, whether
   * active, disabled or reset since. Only a team that never had anyone else may go ahead alone: disabling or
   * resetting the other owner doesn't make one owner the only approver. A team that loses its other approvers
   * adds one with the server's command line (`pnpm admin invite`).
   */
  private async otherApprovers(permission: AdminPermission, requesterId: string) {
    const [row] = await this.db
      .select({ n: count() })
      .from(admins)
      .where(
        and(ne(admins.id, requesterId), inArray(admins.role, rolesWith(permission)), isNotNull(admins.lastSignInAt)),
      );
    return row?.n ?? 0;
  }

  private async expiryHours(countryCode: string | null) {
    const security = await securityOf(this.countries, countryCode ?? this.config.DEFAULT_COUNTRY);
    return security.approvalExpiryHours;
  }

  /**
   * Requests nobody decided in time lapse. One left running (the server stopped while it ran) is marked as
   * failed after a while, saying to check whether it happened, so it never sits as running for ever.
   */
  private async expire() {
    await this.db
      .update(adminApprovals)
      .set({ status: 'expired' })
      .where(and(eq(adminApprovals.status, 'pending'), lt(adminApprovals.expiresAt, new Date())));
    await this.db
      .update(adminApprovals)
      .set({ status: 'failed', error: 'Stopped while running. Check the audit log to see whether it happened.' })
      .where(and(eq(adminApprovals.status, 'running'), lt(adminApprovals.decidedAt, new Date(Date.now() - STUCK_MS))));
  }

  /**
   * What an admin sees: requests their role may decide, and their own. Waiting ones first by default;
   * `done` lists the decided ones, newest first.
   */
  async list(admin: AdminContext, query: { done: boolean; limit: number }) {
    await this.expire();
    const permissions = Object.entries(APPROVAL_KIND_INFO)
      .filter(([, info]) => can(admin.role as AdminRole, info.permission))
      .map(([kind]) => kind as ApprovalKind);
    const visible = or(
      eq(adminApprovals.requestedBy, admin.adminId),
      permissions.length ? inArray(adminApprovals.kind, permissions) : sql`false`,
    );
    const status = query.done ? sql`${adminApprovals.status} <> 'pending'` : eq(adminApprovals.status, 'pending');
    const rows = await this.db
      .select()
      .from(adminApprovals)
      .where(and(visible, status))
      .orderBy(desc(adminApprovals.createdAt))
      .limit(query.limit);
    const views = await this.views(rows);
    return {
      approvals: views.map((v) => ({
        ...v,
        canDecide: v.status === 'pending' && v.requestedBy.id !== admin.adminId && permissions.includes(v.kind),
        canCancel: v.status === 'pending' && v.requestedBy.id === admin.adminId,
      })),
    };
  }

  /** How many wait for this admin's decision, for the panel's menu. */
  async waitingFor(admin: AdminContext) {
    const kinds = Object.entries(APPROVAL_KIND_INFO)
      .filter(([, info]) => can(admin.role as AdminRole, info.permission))
      .map(([kind]) => kind as ApprovalKind);
    if (!kinds.length) return { waiting: 0 };
    const [row] = await this.db
      .select({ n: count() })
      .from(adminApprovals)
      .where(
        and(
          eq(adminApprovals.status, 'pending'),
          gt(adminApprovals.expiresAt, new Date()),
          inArray(adminApprovals.kind, kinds),
          ne(adminApprovals.requestedBy, admin.adminId),
        ),
      );
    return { waiting: row?.n ?? 0 };
  }

  private async view(id: string, db: Pick<Db, 'select'> = this.db) {
    const [row] = await db.select().from(adminApprovals).where(eq(adminApprovals.id, id));
    if (!row) throw notFound('approval_not_found', 'No such request');
    return (await this.views([row], db))[0]!;
  }

  /** Requests as admins see them, with the names of who asked and who decided, read in one go. */
  private async views(rows: Row[], db: Pick<Db, 'select'> = this.db) {
    const ids = [...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy]).filter((x): x is string => !!x))];
    const people = ids.length
      ? await db.select({ id: admins.id, name: admins.name }).from(admins).where(inArray(admins.id, ids))
      : [];
    const name = (who: string | null) => (who ? (people.find((p) => p.id === who)?.name ?? null) : null);
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      label: APPROVAL_KIND_INFO[row.kind].label,
      // A request past its time reads as lapsed, even before anything marks it so.
      status: row.status === 'pending' && row.expiresAt.getTime() <= Date.now() ? ('expired' as const) : row.status,
      summary: row.summary,
      note: row.note,
      countryCode: row.countryCode,
      targetType: row.targetType,
      targetId: row.targetId,
      requestedBy: { id: row.requestedBy, name: name(row.requestedBy) },
      decidedBy: row.decidedBy ? { id: row.decidedBy, name: name(row.decidedBy) } : null,
      selfApproved: row.selfApproved,
      decisionNote: row.decisionNote,
      error: row.error,
      createdAt: row.createdAt,
      decidedAt: row.decidedAt,
      expiresAt: row.expiresAt,
    }));
  }
}
