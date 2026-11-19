import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { forbidden } from '../common/errors';
import { DB, type Db, type Tx } from '../db/database.module';
import { adminApprovals, adminAudit, admins, errands, riskFlags, users } from '../db/schema';
import type { AdminContext } from './admin.types';

export interface AuditEntry {
  action: string;
  targetType?: string;
  targetId?: string;
  countryCode?: string;
  data?: Record<string, unknown>;
}

/**
 * The record of what admins changed. Write it in the same transaction as the change, before anything leaves
 * the server: it is also where a change to the admin's own app account is refused (docs/security-plan.md,
 * D3), which then undoes the whole transaction, whichever route made it.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async record(tx: Tx, admin: AdminContext, entry: AuditEntry) {
    await this.refuseOwnAccount(tx, admin, entry.targetType, entry.targetId);
    return tx.insert(adminAudit).values({
      adminId: admin.adminId,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      countryCode: entry.countryCode ?? null,
      // A change that waited for approval says which request it was and who approved it.
      data: admin.approval ? { ...(entry.data ?? {}), approval: admin.approval } : (entry.data ?? {}),
      reason: admin.reason ?? null,
      ip: admin.ip,
      userAgent: admin.userAgent,
    });
  }

  /**
   * The app accounts a change is about: the person, an errand's customer and agent, a flag's accounts, or, for
   * a request waiting for approval, whoever its change is about.
   */
  private async peopleIn(
    tx: Tx | Db,
    targetType: string | null | undefined,
    targetId: string | null | undefined,
  ): Promise<string[]> {
    if (!targetId) return [];
    if (targetType === 'person') return [targetId];
    if (targetType === 'errand') {
      const [errand] = await tx
        .select({ customerId: errands.customerId, agentId: errands.agentId })
        .from(errands)
        .where(eq(errands.id, targetId));
      return errand ? [errand.customerId, errand.agentId].filter((id): id is string => !!id) : [];
    }
    if (targetType === 'flag') {
      const [flag] = await tx
        .select({ userId: riskFlags.userId, otherUserId: riskFlags.otherUserId })
        .from(riskFlags)
        .where(eq(riskFlags.id, targetId));
      return flag ? [flag.userId, flag.otherUserId].filter((id): id is string => !!id) : [];
    }
    if (targetType === 'approval') {
      const [approval] = await tx
        .select({ targetType: adminApprovals.targetType, targetId: adminApprovals.targetId })
        .from(adminApprovals)
        .where(eq(adminApprovals.id, targetId));
      if (!approval || approval.targetType === 'approval') return [];
      return this.peopleIn(tx, approval.targetType, approval.targetId);
    }
    return [];
  }

  /**
   * A teammate never changes their own app account, or an errand it is part of: not suspending or crediting
   * it, not settling its dispute, not asking for or approving such a change (D3). Their phone number is the
   * link, so one is needed before they change anyone's account. Every change is checked here as it is
   * recorded; deciding a request is also checked before anything runs.
   */
  async refuseOwnAccount(
    tx: Tx | Db,
    admin: Pick<AdminContext, 'phone'>,
    targetType: string | null | undefined,
    targetId: string | null | undefined,
    /** Checking the person who asked for a change, before a second admin runs it. */
    asker = false,
  ) {
    const people = await this.peopleIn(tx, targetType, targetId);
    if (!people.length) return;
    if (!admin.phone) {
      throw asker
        ? forbidden('asker_phone_needed', "The person who asked has no phone number yet, so this can't run. Reject it.")
        : forbidden(
            'phone_needed',
            "An owner must add your phone number on the Team page before you can change people's accounts",
          );
    }
    const [own] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, people), eq(users.phone, admin.phone)))
      .limit(1);
    if (own) {
      throw asker
        ? forbidden('asker_own_account', 'This is about the account of the person who asked. Reject it.')
        : forbidden('own_account', "You can't change your own Jiffo account. Ask a teammate.");
    }
  }

  /**
   * A change made with the command line on a server (inviting or resetting an admin, say): recorded as
   * from the command line, with the server's user, since no admin is signed in there.
   */
  recordCli(tx: Pick<Tx, 'insert'>, entry: AuditEntry & { reason: string }) {
    return tx.insert(adminAudit).values({
      adminId: null,
      via: 'cli',
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      countryCode: entry.countryCode ?? null,
      data: { ...(entry.data ?? {}), serverUser: process.env.USER ?? process.env.USERNAME ?? null },
      reason: entry.reason,
    });
  }

  /** Newest first. Pass the last id of a page as `before` for the next one. */
  async list(query: { before?: number; limit: number; targetType?: string; targetId?: string }) {
    const rows = await this.db
      .select({
        id: adminAudit.id,
        action: adminAudit.action,
        targetType: adminAudit.targetType,
        targetId: adminAudit.targetId,
        countryCode: adminAudit.countryCode,
        data: adminAudit.data,
        reason: adminAudit.reason,
        via: adminAudit.via,
        ip: adminAudit.ip,
        userAgent: adminAudit.userAgent,
        createdAt: adminAudit.createdAt,
        admin: { id: admins.id, name: admins.name, email: admins.email },
      })
      .from(adminAudit)
      // The command line's changes have no admin, and are listed too.
      .leftJoin(admins, eq(admins.id, adminAudit.adminId))
      .where(
        and(
          query.before ? lt(adminAudit.id, query.before) : undefined,
          query.targetType ? eq(adminAudit.targetType, query.targetType) : undefined,
          query.targetId ? eq(adminAudit.targetId, query.targetId) : undefined,
        ),
      )
      .orderBy(desc(adminAudit.id))
      .limit(query.limit + 1);
    const entries = rows.slice(0, query.limit);
    // What each entry was about, by name, so the log reads without opening every target.
    const ids = (type: string) => [
      ...new Set(entries.filter((e) => e.targetType === type && e.targetId).map((e) => e.targetId!)),
    ];
    const [people, errandRows, team] = await Promise.all([
      ids('person').length
        ? this.db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, phone: users.phone })
            .from(users)
            .where(inArray(users.id, ids('person')))
        : [],
      ids('errand').length
        ? this.db
            .select({ id: errands.id, description: errands.description })
            .from(errands)
            .where(inArray(errands.id, ids('errand')))
        : [],
      ids('admin').length
        ? this.db
            .select({ id: admins.id, name: admins.name })
            .from(admins)
            .where(inArray(admins.id, ids('admin')))
        : [],
    ]);
    const label = new Map<string, string>([
      ...people.map((p) => [p.id, [p.firstName, p.lastName].filter(Boolean).join(' ') || p.phone] as const),
      ...errandRows.map((e) => [e.id, e.description] as const),
      ...team.map((a) => [a.id, a.name] as const),
    ]);
    return {
      entries: entries.map((e) => ({ ...e, targetLabel: e.targetId ? (label.get(e.targetId) ?? null) : null })),
      more: rows.length > query.limit,
    };
  }
}
