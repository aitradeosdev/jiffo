import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, ilike, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  AGENT_TIERS,
  agentTierLabel,
  commissionBpsFor,
  holdsEarnings,
  TERMINAL_STATES,
  type AgentTier,
} from '@jiffo/shared';
import { DB, type Db, type Tx } from '../db/database.module';
import {
  admins,
  agentPresence,
  agentProfiles,
  devices,
  errandRatings,
  errands,
  journalEntries,
  ledgerAccounts,
  payoutAccounts,
  postings,
  sessions,
  users,
} from '../db/schema';
import { conflict, notFound } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { ErrandsService } from '../errands/errands.service';
import { PushService } from '../push/push.service';
import { AuditService } from './audit.service';
import { containing, cursorOf, exactTime, idPrefix, parseCursor, phoneDigits } from './list-helpers';
import type { AdminContext } from './admin.types';

export const PEOPLE_ROLES = ['customer', 'agent'] as const;
export type PeopleRole = (typeof PEOPLE_ROLES)[number];

/** Agents seen within this long count as online, as on the matching screen. */
const ONLINE_MS = 10 * 60_000;

const usesApp = (app: PeopleRole) =>
  sql<boolean>`exists (select 1 from ${devices} where ${devices.userId} = ${users.id} and ${devices.app} = ${app})`;
const DONE_STATES = [...TERMINAL_STATES];

/** Customers and agents as support sees them: who they are, what they've done, and the levers on them. */
@Injectable()
export class PeopleAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly errandsService: ErrandsService,
    private readonly push: PushService,
    private readonly audit: AuditService,
    private readonly countries: CountriesService,
  ) {}

  /** What each tier means under the country's current settings: commission, and when earnings can be withdrawn. */
  private async tierTerms(countryCode: string) {
    const { settings } = await this.countries.currentSettings(countryCode);
    return AGENT_TIERS.map((tier) => ({
      tier,
      commissionBps: commissionBpsFor(settings.fees, tier),
      holdHours: holdsEarnings(tier) ? settings.timers.bronzePayoutHoldHours : 0,
    }));
  }

  /** Newest first. Searched by name, phone, email or part of the account id. */
  async list(query: { country: string; role: PeopleRole; q?: string; before?: string; limit: number }) {
    const cursor = parseCursor(query.before);
    const agent = query.role === 'agent';
    const rows = await this.db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        status: users.status,
        createdAt: users.createdAt,
        cursorAt: exactTime(users.createdAt),
        tier: agentProfiles.tier,
        online: sql<boolean>`coalesce("agent_presence"."online"
          and "agent_presence"."located_at" > now() - make_interval(secs => ${ONLINE_MS / 1000}), false)`,
        // Written out with table names: inside a select list Drizzle leaves columns unqualified, and a bare
        // "id" inside these subqueries would mean the subquery's own table.
        errands: agent
          ? sql<number>`(select count(*)::int from errands e where e.agent_id = "users"."id" and e.status = 'completed')`
          : sql<number>`(select count(*)::int from errands e where e.customer_id = "users"."id")`,
        rating: sql<number | null>`(select round(avg(r.stars)::numeric, 1)::float from errand_ratings r
          where r.ratee_id = "users"."id" and r.rater_role = ${agent ? 'customer' : 'agent'})`,
        balanceKobo: sql<number>`coalesce((select sum(a.balance)::bigint from ledger_accounts a
          where a.owner_id = "users"."id"
          and a.type in ${agent ? sql`('agent_available', 'agent_held')` : sql`('customer_wallet')`}), 0)`,
      })
      .from(users)
      .leftJoin(agentProfiles, eq(agentProfiles.userId, users.id))
      .leftJoin(agentPresence, eq(agentPresence.userId, users.id))
      .where(
        and(
          eq(users.countryCode, query.country),
          usesApp(query.role),
          query.q ? this.search(query.q) : undefined,
          cursor ? sql`(${users.createdAt}, ${users.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(users.createdAt), desc(users.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      people: page.map(({ cursorAt: _, tier, ...r }) => ({
        ...r,
        balanceKobo: Number(r.balanceKobo),
        ...(agent ? { tier: tier ?? 'bronze' } : {}),
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
      ilike(users.email, like),
      id ? ilike(sql`${users.id}::text`, id) : undefined,
      phone ? ilike(users.phone, `%${phone}%`) : undefined,
    );
  }

  /** One person in full: both sides of their activity, their money, devices and payout account. */
  async detail(id: string) {
    const [user] = await this.db.select().from(users).where(eq(users.id, id));
    if (!user) throw notFound('person_not_found', 'Person not found');
    const [
      apps,
      profile,
      presence,
      asCustomer,
      asAgent,
      ratings,
      averages,
      balances,
      recent,
      money,
      payout,
      live,
      tiers,
    ] = await Promise.all([
      this.db
        .select({
          app: devices.app,
          platform: devices.platform,
          name: devices.name,
          push: sql<boolean>`${devices.pushToken} is not null`,
          lastSeenAt: devices.lastSeenAt,
          activeSessions: sql<number>`(select count(*)::int from sessions s
              where s.device_id = "devices"."id" and s.revoked_at is null and s.expires_at > now())`,
        })
        .from(devices)
        .where(eq(devices.userId, id))
        .orderBy(desc(devices.lastSeenAt)),
      this.db
        .select({
          tier: agentProfiles.tier,
          tierSetAt: agentProfiles.tierSetAt,
          tierSetBy: admins.name,
          categoryKeys: agentProfiles.categoryKeys,
          takesPurchases: agentProfiles.takesPurchases,
        })
        .from(agentProfiles)
        .leftJoin(admins, eq(admins.id, agentProfiles.tierSetBy))
        .where(eq(agentProfiles.userId, id)),
      this.db
        .select({ online: agentPresence.online, locatedAt: agentPresence.locatedAt })
        .from(agentPresence)
        .where(eq(agentPresence.userId, id)),
      this.counts(eq(errands.customerId, id)),
      this.counts(eq(errands.agentId, id)),
      this.db
        .select({
          raterRole: errandRatings.raterRole,
          stars: errandRatings.stars,
          comment: errandRatings.comment,
          errandId: errandRatings.errandId,
          createdAt: errandRatings.createdAt,
        })
        .from(errandRatings)
        .where(eq(errandRatings.rateeId, id))
        .orderBy(desc(errandRatings.createdAt))
        .limit(10),
      // Over every rating they've had, each side apart: not just the few shown.
      this.db
        .select({
          raterRole: errandRatings.raterRole,
          average: sql<number>`round(avg(${errandRatings.stars})::numeric, 1)::float`,
          count: sql<number>`count(*)::int`,
        })
        .from(errandRatings)
        .where(eq(errandRatings.rateeId, id))
        .groupBy(errandRatings.raterRole),
      this.db
        .select({ type: ledgerAccounts.type, balance: ledgerAccounts.balance })
        .from(ledgerAccounts)
        .where(eq(ledgerAccounts.ownerId, id)),
      this.db
        .select({
          id: errands.id,
          status: errands.status,
          description: errands.description,
          feeKobo: errands.feeKobo,
          createdAt: errands.createdAt,
          asAgent: sql<boolean>`${errands.agentId} = ${id}`,
        })
        .from(errands)
        .where(or(eq(errands.customerId, id), eq(errands.agentId, id)))
        .orderBy(desc(errands.createdAt))
        .limit(15),
      this.db
        .select({
          id: postings.id,
          account: ledgerAccounts.type,
          kind: journalEntries.kind,
          errandId: journalEntries.errandId,
          // Their accounts are owed by the platform: a credit (negative) is money in.
          amountKobo: sql<number>`(-${postings.amount})::bigint`,
          createdAt: postings.createdAt,
        })
        .from(postings)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.accountId))
        .innerJoin(journalEntries, eq(journalEntries.id, postings.journalId))
        .where(eq(ledgerAccounts.ownerId, id))
        .orderBy(desc(postings.id))
        .limit(20),
      this.db
        .select({
          bankName: payoutAccounts.bankName,
          accountName: payoutAccounts.accountName,
          accountNumber: payoutAccounts.accountNumber,
          createdAt: payoutAccounts.createdAt,
        })
        .from(payoutAccounts)
        .where(and(eq(payoutAccounts.userId, id), isNull(payoutAccounts.replacedAt))),
      this.liveErrands(id),
      this.tierTerms(user.countryCode),
    ]);
    const balance = (type: string) => Number(balances.find((b) => b.type === type)?.balance ?? 0);
    const isAgent = apps.some((a) => a.app === 'agent');
    const avg = (role: 'customer' | 'agent') => averages.find((a) => a.raterRole === role)?.average ?? null;
    const p = payout[0];
    return {
      person: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        email: user.email,
        status: user.status,
        countryCode: user.countryCode,
        createdAt: user.createdAt,
      },
      apps: [...new Set(apps.map((a) => a.app))],
      devices: apps,
      agent: isAgent
        ? {
            tier: profile[0]?.tier ?? 'bronze',
            tiers,
            ratings: averages.find((a) => a.raterRole === 'customer')?.count ?? 0,
            tierSetAt: profile[0]?.tierSetAt ?? null,
            tierSetBy: profile[0]?.tierSetBy ?? null,
            categoryKeys: profile[0]?.categoryKeys ?? null,
            takesPurchases: profile[0]?.takesPurchases ?? true,
            online:
              !!presence[0]?.online &&
              !!presence[0].locatedAt &&
              Date.now() - presence[0].locatedAt.getTime() < ONLINE_MS,
            lastLocatedAt: presence[0]?.locatedAt ?? null,
            availableKobo: balance('agent_available'),
            heldKobo: balance('agent_held'),
            rating: avg('customer'),
            stats: asAgent,
            payoutAccount: p
              ? {
                  bankName: p.bankName,
                  accountName: p.accountName,
                  last4: p.accountNumber.slice(-4),
                  since: p.createdAt,
                }
              : null,
          }
        : null,
      customer: {
        walletKobo: balance('customer_wallet'),
        rating: avg('agent'),
        stats: asCustomer,
      },
      ratings,
      errands: recent,
      money: money.map((m) => ({ ...m, amountKobo: Number(m.amountKobo) })),
      liveErrands: live.map((e) => e.id),
    };
  }

  private async counts(who: SQL) {
    const [row] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where ${errands.status} = 'completed')::int`,
        cancelled: sql<number>`count(*) filter (where ${errands.status} in ('cancelled', 'expired'))::int`,
        disputed: sql<number>`count(*) filter (where exists (select 1 from errand_events e
          where e.errand_id = "errands"."id" and e.to_status = 'disputed'))::int`,
      })
      .from(errands)
      .where(who);
    return row ?? { total: 0, completed: 0, cancelled: 0, disputed: 0 };
  }

  /** Errands the person is part of that haven't ended. */
  private liveErrands(id: string, db: Tx = this.db) {
    return db
      .select({ id: errands.id, status: errands.status, version: errands.version, customerId: errands.customerId })
      .from(errands)
      .where(and(or(eq(errands.customerId, id), eq(errands.agentId, id)), notInArray(errands.status, DONE_STATES)));
  }

  /**
   * Sets an agent's tier, which decides their commission and when earnings can be withdrawn, and tells the
   * agent. Choosing the tier they already have changes nothing.
   */
  async setTier(admin: AdminContext, id: string, tier: AgentTier, note: string) {
    const result = await this.db.transaction(async (tx) => {
      // Locks the person, so two changes at once are recorded one after the other.
      const [user] = await tx
        .select({ countryCode: users.countryCode })
        .from(users)
        .where(eq(users.id, id))
        .for('update');
      const [isAgent] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.userId, id), eq(devices.app, 'agent')))
        .limit(1);
      if (!user || !isAgent) throw notFound('agent_not_found', 'This person is not an agent');
      const [before] = await tx
        .select({ tier: agentProfiles.tier })
        .from(agentProfiles)
        .where(eq(agentProfiles.userId, id));
      const previous = before?.tier ?? 'bronze';
      if (previous === tier) return { tier, changed: false, countryCode: user.countryCode };
      await tx
        .insert(agentProfiles)
        .values({ userId: id, tier, tierSetBy: admin.adminId, tierSetAt: new Date() })
        .onConflictDoUpdate({
          target: agentProfiles.userId,
          set: { tier, tierSetBy: admin.adminId, tierSetAt: new Date(), updatedAt: new Date() },
        });
      await this.audit.record(tx, admin, {
        action: 'agent.tier',
        targetType: 'person',
        targetId: id,
        countryCode: user.countryCode,
        data: { from: previous, to: tier, note },
      });
      return { tier, changed: true, countryCode: user.countryCode };
    });
    if (result.changed) {
      const terms = (await this.tierTerms(result.countryCode)).find((t) => t.tier === tier)!;
      await this.push.notifyUser(id, 'agent', {
        title: `You're now ${agentTierLabel(tier)}`,
        body: terms.holdHours
          ? `Your errand earnings become withdrawable ${terms.holdHours} hours after each hand-off.`
          : 'Your errand earnings are withdrawable as soon as each hand-off is done.',
        data: { type: 'agent.tier', tier },
      });
    }
    return { tier: result.tier, changed: result.changed };
  }

  /**
   * Stops someone using Jiffo: their sessions end, an agent goes offline, and errands still waiting for an
   * agent are cancelled by support, all in one transaction. Refused while they are part of an errand in
   * progress, which support settles first.
   */
  async suspend(admin: AdminContext, id: string, note: string) {
    const { closed } = await this.db.transaction(async (tx) => {
      // Accepting and creating errands share this lock, so neither can slip in while this runs.
      const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!user) throw notFound('person_not_found', 'Person not found');
      if (user.status === 'suspended') throw conflict('already_suspended', 'This account is already suspended');
      const live = await tx
        .select()
        .from(errands)
        .where(and(or(eq(errands.customerId, id), eq(errands.agentId, id)), notInArray(errands.status, DONE_STATES)))
        .for('update');
      const inProgress = live.filter((e) => e.status !== 'requested');
      if (inProgress.length) {
        throw conflict('has_live_errands', 'Settle their errands in progress first', {
          errandIds: inProgress.map((e) => e.id),
        });
      }
      // Only their own requests can be waiting: an errand that is waiting has no agent yet.
      const closedResults = [];
      for (const errand of live)
        closedResults.push(await this.errandsService.adminCancelWaiting(tx, errand, admin.adminId, note));

      await tx.update(users).set({ status: 'suspended', updatedAt: new Date() }).where(eq(users.id, id));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date(), revokedReason: 'suspended' })
        .where(and(eq(sessions.userId, id), isNull(sessions.revokedAt)));
      await tx
        .update(agentPresence)
        .set({ online: false, lat: null, lng: null, location: null, locatedAt: null, updatedAt: new Date() })
        .where(eq(agentPresence.userId, id));
      await this.audit.record(tx, admin, {
        action: 'person.suspend',
        targetType: 'person',
        targetId: id,
        countryCode: user.countryCode,
        data: { note, closedErrands: live.map((e) => e.id) },
      });
      return { closed: closedResults };
    });
    // Boards drop the closed errands, and the customer hears they were cancelled.
    await this.errandsService.announce(closed);
    return { status: 'suspended' as const, closedErrands: closed.map((r) => r.after.id) };
  }

  async reactivate(admin: AdminContext, id: string, note: string) {
    return this.db.transaction(async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!user) throw notFound('person_not_found', 'Person not found');
      if (user.status === 'active') throw conflict('already_active', 'This account is already active');
      await tx.update(users).set({ status: 'active', updatedAt: new Date() }).where(eq(users.id, id));
      await this.audit.record(tx, admin, {
        action: 'person.reactivate',
        targetType: 'person',
        targetId: id,
        countryCode: user.countryCode,
        data: { note },
      });
      return { status: 'active' as const };
    });
  }
}
