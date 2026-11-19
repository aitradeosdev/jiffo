import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm';
import {
  RISK_FLAG_INFO,
  RISK_FLAG_STATUSES,
  RISK_QUEUE_INFO,
  RISK_QUEUES,
  type RiskFlagStatus,
  type RiskQueue,
} from '@jiffo/shared';
import { conflict, forbidden, notFound } from '../common/errors';
import { DB, type Db } from '../db/database.module';
import { admins, errands, riskFlagErrands, riskFlags, users, type AdminRole } from '../db/schema';
import { AuditService } from './audit.service';
import { requireCountry } from './countries';
import { cursorOf, exactTime, parseCursor } from './list-helpers';
import { can } from './permissions';
import type { AdminContext } from './admin.types';

export type FlagDecision = 'clear' | 'confirm' | 'reopen';

/** How many of a flag's errands a list shows; the rest are counted. */
const ERRANDS_SHOWN = 10;

const STATUS_AFTER: Record<FlagDecision, RiskFlagStatus> = { clear: 'cleared', confirm: 'confirmed', reopen: 'open' };

/**
 * The Risk and verification queues as staff see them (docs/security-plan.md, E6, I3): what was flagged, who
 * and which errands it is about, and the decision. Operations decide the Risk queue and the verification
 * team the shared accounts, each with a reason kept in the audit log.
 */
@Injectable()
export class FlagsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** How many flags each queue holds in each state: the country's, or one person's or errand's. */
  async counts(country: string, about: { person?: string; errand?: string } = {}) {
    await requireCountry(this.db, country);
    const rows = await this.db
      .select({ queue: riskFlags.queue, status: riskFlags.status, count: sql<number>`count(*)::int` })
      .from(riskFlags)
      .where(and(eq(riskFlags.countryCode, country), this.about(about)))
      .groupBy(riskFlags.queue, riskFlags.status);
    const of = (queue: RiskQueue) =>
      Object.fromEntries(
        RISK_FLAG_STATUSES.map((s) => [s, rows.find((r) => r.queue === queue && r.status === s)?.count ?? 0]),
      ) as Record<RiskFlagStatus, number>;
    return Object.fromEntries(RISK_QUEUES.map((q) => [q, of(q)])) as Record<RiskQueue, Record<RiskFlagStatus, number>>;
  }

  /** Flags about one person (either side), or linked to one errand. */
  private about({ person, errand }: { person?: string; errand?: string }) {
    return and(
      person ? or(eq(riskFlags.userId, person), eq(riskFlags.otherUserId, person)) : undefined,
      errand
        ? sql`exists (select 1 from ${riskFlagErrands} fe where fe.flag_id = ${riskFlags.id} and fe.errand_id = ${errand})`
        : undefined,
    );
  }

  /**
   * Flags in one queue and state: open ones oldest first, as a queue is worked; decided ones by when they
   * were decided, latest first.
   */
  async list(query: {
    country: string;
    queue: RiskQueue;
    status: RiskFlagStatus;
    person?: string;
    errand?: string;
    before?: string;
    limit: number;
  }) {
    await requireCountry(this.db, query.country);
    const cursor = parseCursor(query.before);
    const oldestFirst = query.status === 'open';
    // Open flags go by when they were raised, decided ones by when they were decided.
    const at = oldestFirst ? riskFlags.createdAt : sql`coalesce(${riskFlags.decidedAt}, ${riskFlags.createdAt})`;
    const rows = await this.db
      .select({
        id: riskFlags.id,
        queue: riskFlags.queue,
        kind: riskFlags.kind,
        status: riskFlags.status,
        userId: riskFlags.userId,
        otherUserId: riskFlags.otherUserId,
        details: riskFlags.details,
        createdAt: riskFlags.createdAt,
        updatedAt: riskFlags.updatedAt,
        decidedAt: riskFlags.decidedAt,
        decidedBy: admins.name,
        decisionNote: riskFlags.decisionNote,
        cursorAt: exactTime(at),
      })
      .from(riskFlags)
      .leftJoin(admins, eq(admins.id, riskFlags.decidedBy))
      .where(
        and(
          eq(riskFlags.countryCode, query.country),
          eq(riskFlags.queue, query.queue),
          eq(riskFlags.status, query.status),
          this.about(query),
          cursor
            ? oldestFirst
              ? sql`(${at}, ${riskFlags.id}) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
              : sql`(${at}, ${riskFlags.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(oldestFirst ? sql`${at} asc, ${riskFlags.id} asc` : sql`${at} desc, ${riskFlags.id} desc`)
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const ids = page.map((r) => r.id);
    const personIds = [...new Set(page.flatMap((r) => [r.userId, r.otherUserId]).filter((p): p is string => !!p))];
    const [people, linked, counted] = await Promise.all([
      personIds.length
        ? this.db
            .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, phone: users.phone })
            .from(users)
            .where(inArray(users.id, personIds))
        : [],
      ids.length ? this.errandsOf(ids) : [],
      ids.length
        ? this.db
            .select({ flagId: riskFlagErrands.flagId, n: sql<number>`count(*)::int` })
            .from(riskFlagErrands)
            .where(inArray(riskFlagErrands.flagId, ids))
            .groupBy(riskFlagErrands.flagId)
        : [],
    ]);
    const person = (id: string | null) => (id ? (people.find((p) => p.id === id) ?? null) : null);
    return {
      flags: page.map(({ cursorAt: _, userId, otherUserId, ...r }) => ({
        ...r,
        label: RISK_FLAG_INFO[r.kind].label,
        about: RISK_FLAG_INFO[r.kind].about,
        people: [person(userId), person(otherUserId)].filter((p) => !!p),
        errands: linked.filter((e) => e.flagId === r.id).map(({ flagId: _f, ...e }) => e),
        errandCount: counted.find((c) => c.flagId === r.id)?.n ?? 0,
      })),
      next: rows.length > query.limit && last ? cursorOf(last) : null,
    };
  }

  /** The latest few errands of each flag. */
  private async errandsOf(flagIds: string[]) {
    const ranked = this.db
      .select({
        flagId: riskFlagErrands.flagId,
        id: errands.id,
        status: errands.status,
        description: errands.description,
        feeKobo: errands.feeKobo,
        createdAt: errands.createdAt,
        rank: sql<number>`row_number() over (partition by ${riskFlagErrands.flagId} order by ${errands.createdAt} desc)`.as(
          'rank',
        ),
      })
      .from(riskFlagErrands)
      .innerJoin(errands, eq(errands.id, riskFlagErrands.errandId))
      .where(inArray(riskFlagErrands.flagId, flagIds))
      .as('ranked');
    const rows = await this.db
      .select()
      .from(ranked)
      .where(sql`${ranked.rank} <= ${ERRANDS_SHOWN}`)
      .orderBy(desc(ranked.createdAt));
    return rows.map(({ rank: _, ...r }) => r);
  }

  /** The flags on one errand, for its page in the panel. */
  forErrand(errandId: string) {
    return this.db
      .select({
        id: riskFlags.id,
        queue: riskFlags.queue,
        kind: riskFlags.kind,
        status: riskFlags.status,
        createdAt: riskFlags.createdAt,
        decisionNote: riskFlags.decisionNote,
      })
      .from(riskFlagErrands)
      .innerJoin(riskFlags, eq(riskFlags.id, riskFlagErrands.flagId))
      .where(eq(riskFlagErrands.errandId, errandId))
      .orderBy(riskFlags.createdAt)
      .then((rows) => rows.map((r) => ({ ...r, label: RISK_FLAG_INFO[r.kind].label })));
  }

  /**
   * Clears a flag (nothing wrong), confirms it (fraud: its errands stay out of the tier counts), or reopens
   * a decided one. Each queue needs its own permission, and the reason goes in the audit log.
   */
  async decide(admin: AdminContext, id: string, input: { decision: FlagDecision; note: string }) {
    return this.db.transaction(async (tx) => {
      const [flag] = await tx.select().from(riskFlags).where(eq(riskFlags.id, id)).for('update');
      if (!flag) throw notFound('flag_not_found', 'Flag not found');
      if (!can(admin.role as AdminRole, RISK_QUEUE_INFO[flag.queue].permission)) {
        throw forbidden('not_permitted', 'Your role does not allow this');
      }
      if (input.decision === 'reopen' ? flag.status === 'open' : flag.status !== 'open') {
        throw input.decision === 'reopen'
          ? conflict('flag_open', 'This flag is still open')
          : conflict('flag_decided', 'This flag was already decided. Reopen it first to change the decision.');
      }
      await this.audit.record(tx, admin, {
        action: `flag.${input.decision}`,
        targetType: 'flag',
        targetId: flag.id,
        countryCode: flag.countryCode,
        data: { note: input.note, kind: flag.kind, queue: flag.queue, from: flag.status },
      });
      const decided = input.decision !== 'reopen';
      const [after] = await tx
        .update(riskFlags)
        .set({
          status: STATUS_AFTER[input.decision],
          decidedBy: decided ? admin.adminId : null,
          decidedAt: decided ? new Date() : null,
          decisionNote: decided ? input.note : null,
          updatedAt: new Date(),
        })
        .where(eq(riskFlags.id, flag.id))
        .returning({
          id: riskFlags.id,
          queue: riskFlags.queue,
          status: riskFlags.status,
          decidedAt: riskFlags.decidedAt,
        });
      return after!;
    });
  }
}
