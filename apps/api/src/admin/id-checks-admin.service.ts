import { Inject, Injectable } from '@nestjs/common';
import { and, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { ID_TYPES, providerInfo, type IdType } from '@jiffo/shared';
import { DB, type Db } from '../db/database.module';
import { admins, customerVerifications, users } from '../db/schema';
import { CustomerIdentityService } from '../identity/customer-identity.service';
import { PushService } from '../push/push.service';
import { AuditService } from './audit.service';
import { SUPPORT_CHECK_LABELS, type Check } from './check-labels';
import { requireCountry } from './countries';
import { containing, cursorOf, exactTime, idPrefix, parseCursor, phoneDigits } from './list-helpers';
import type { AdminContext } from './admin.types';

export const ID_CHECK_STATUSES = ['review', 'checking', 'failed', 'verified', 'declined'] as const;
export type IdCheckStatus = (typeof ID_CHECK_STATUSES)[number];

/** Each check as support reads it. */
const LABELS: Record<string, string> = {
  ...SUPPORT_CHECK_LABELS,
  duplicate: 'No other customer account on this ID',
};
const labelled = (checks: Check[]) => checks.map((c) => ({ ...c, label: LABELS[c.key] ?? c.key }));
const idName = (type: string) => ID_TYPES[type as IdType]?.name ?? type;
/** The provider as people read it; the development stand-in by what it is. */
const providerName = (key: string) =>
  providerInfo('identity', key)?.name ?? (key === 'fake' ? 'Test provider (development)' : key);
/** Since when a check has waited: when its result came back, or when it started. */
const since = sql`coalesce("customer_verifications"."checked_at", "customer_verifications"."created_at")`;

/**
 * Customers' identity checks as support sees them: the provider's results, never the ID or the selfie.
 * Checks the provider couldn't settle wait here for a person to verify or decline.
 */
@Injectable()
export class IdChecksAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly identity: CustomerIdentityService,
    private readonly audit: AuditService,
    private readonly push: PushService,
  ) {}

  async counts(country: string) {
    await requireCountry(this.db, country);
    const rows = await this.db
      .select({ status: customerVerifications.status, count: sql<number>`count(*)::int` })
      .from(customerVerifications)
      .innerJoin(users, eq(users.id, customerVerifications.userId))
      .where(eq(users.countryCode, country))
      .groupBy(customerVerifications.status);
    return Object.fromEntries(ID_CHECK_STATUSES.map((s) => [s, rows.find((r) => r.status === s)?.count ?? 0]));
  }

  /** Checks in one state: those waiting for someone oldest first, the rest newest first. */
  async list(query: { country: string; status: IdCheckStatus; q?: string; before?: string; limit: number }) {
    await requireCountry(this.db, query.country);
    const cursor = parseCursor(query.before);
    const oldestFirst = query.status === 'review' || query.status === 'checking';
    const rows = await this.db
      .select({
        id: customerVerifications.userId,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        legalName: customerVerifications.legalName,
        status: customerVerifications.status,
        idType: customerVerifications.idType,
        provider: customerVerifications.provider,
        checks: customerVerifications.checks,
        checkedAt: customerVerifications.checkedAt,
        decidedAt: customerVerifications.decidedAt,
        decisionNote: customerVerifications.decisionNote,
        createdAt: customerVerifications.createdAt,
        cursorAt: exactTime(since),
      })
      .from(customerVerifications)
      .innerJoin(users, eq(users.id, customerVerifications.userId))
      .where(
        and(
          eq(users.countryCode, query.country),
          eq(customerVerifications.status, query.status),
          query.q ? this.search(query.q) : undefined,
          cursor
            ? oldestFirst
              ? sql`(${since}, ${customerVerifications.userId}) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
              : sql`(${since}, ${customerVerifications.userId}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(
        oldestFirst
          ? sql`${since} asc, ${customerVerifications.userId} asc`
          : sql`${since} desc, ${customerVerifications.userId} desc`,
      )
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      checks: page.map(({ cursorAt: _, checks, idType, provider, ...r }) => ({
        ...r,
        idType,
        provider: providerName(provider),
        idName: idName(idType),
        /** The checks that didn't pass, which are why it is waiting. */
        flagged: labelled(checks.filter((c) => c.outcome !== 'passed')),
      })),
      next: rows.length > query.limit && last ? cursorOf(last) : null,
    };
  }

  private search(text: string): SQL | undefined {
    const like = containing(text);
    const phone = phoneDigits(text);
    const id = idPrefix(text);
    return or(
      ilike(sql`coalesce(${users.firstName}, '') || ' ' || coalesce(${users.lastName}, '')`, like),
      ilike(customerVerifications.legalName, like),
      id ? ilike(sql`${users.id}::text`, id) : undefined,
      phone ? ilike(users.phone, `%${phone}%`) : undefined,
    );
  }

  /** A customer's check for their page in the panel, or null if they haven't checked their ID. */
  async detail(userId: string) {
    const [row] = await this.db
      .select({
        status: customerVerifications.status,
        idType: customerVerifications.idType,
        provider: customerVerifications.provider,
        outcome: customerVerifications.outcome,
        legalName: customerVerifications.legalName,
        dateOfBirth: customerVerifications.dateOfBirth,
        checks: customerVerifications.checks,
        checkedAt: customerVerifications.checkedAt,
        decidedAt: customerVerifications.decidedAt,
        decidedBy: admins.name,
        decisionNote: customerVerifications.decisionNote,
        createdAt: customerVerifications.createdAt,
        held: customerVerifications.idFingerprint,
        pending: customerVerifications.pendingIdFingerprint,
      })
      .from(customerVerifications)
      .leftJoin(admins, eq(admins.id, customerVerifications.decidedBy))
      .where(eq(customerVerifications.userId, userId));
    if (!row) return null;
    const { held, pending, ...rest } = row;
    return {
      ...rest,
      provider: providerName(row.provider),
      idName: idName(row.idType),
      checks: labelled(row.checks),
      /** The provider gave the ID's number, so a second account on it can be caught; needed to verify. */
      hasIdNumber: !!(held ?? pending),
    };
  }

  async decide(
    admin: AdminContext,
    userId: string,
    input: { decision: 'verify' | 'decline' | 'reopen'; note: string },
  ) {
    const [user] = await this.db.select({ countryCode: users.countryCode }).from(users).where(eq(users.id, userId));
    const { before, after } = await this.db.transaction(async (tx) => {
      const result = await this.identity.decide(tx, { userId, adminId: admin.adminId, ...input });
      await this.audit.record(tx, admin, {
        action: `customer_identity.${input.decision}`,
        targetType: 'person',
        targetId: userId,
        countryCode: user?.countryCode,
        data: {
          note: input.note,
          from: result.before.status,
          flagged: result.before.checks.filter((c) => c.outcome !== 'passed').map((c) => c.key),
        },
      });
      return result;
    });
    await this.push.notifyUser(userId, 'customer', {
      title:
        after.status === 'verified'
          ? "You're verified"
          : after.status === 'failed'
            ? 'You can check your ID again'
            : 'About your ID check',
      body:
        after.status === 'verified'
          ? 'Add money and request your first errand.'
          : after.status === 'failed'
            ? 'Open Jiffo to check your ID again.'
            : "Open Jiffo to see our team's decision.",
      data: { type: 'customer.identity', status: after.status, from: before.status },
    });
    return { status: after.status, decidedAt: after.decidedAt };
  }
}
