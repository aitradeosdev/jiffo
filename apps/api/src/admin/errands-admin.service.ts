import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AGENT_OUT_STATES, allowedEvents, commissionBpsFor, splitFeeEscrow, type ErrandState } from '@jiffo/shared';
import { DB, type Db } from '../db/database.module';
import {
  admins,
  agentProfiles,
  conversations,
  errandEvents,
  errandRatings,
  errandStops,
  errands,
  journalEntries,
  ledgerAccounts,
  messages,
  postings,
  uploads,
  users,
} from '../db/schema';
import { notFound } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { ADMIN_ERRAND_EVENTS, ErrandsService, type AdminErrandEvent } from '../errands/errands.service';
import { UploadsService } from '../files/uploads.service';
import { chargeableItemsKobo, WalletService, type DisputeSplit } from '../money/wallet.service';
import { AuditService } from './audit.service';
import { containing, cursorOf, exactTime, idPrefix, parseCursor, phoneDigits } from './list-helpers';
import type { AdminContext } from './admin.types';

/** The errand lists' filters, in the panel's words. */
export const ERRAND_FILTERS = ['all', 'waiting', 'live', 'disputed', 'completed', 'cancelled'] as const;
export type ErrandFilter = (typeof ERRAND_FILTERS)[number];

const STATUSES: Record<Exclude<ErrandFilter, 'all'>, readonly ErrandState[]> = {
  waiting: ['requested'],
  live: AGENT_OUT_STATES,
  disputed: ['disputed'],
  completed: ['completed'],
  cancelled: ['cancelled', 'expired'],
};

/** When the errand last went into dispute. */
const disputedSince = sql<Date>`(select max(e.created_at) from errand_events e
  where e.errand_id = "errands"."id" and e.to_status = 'disputed')`;

const customer = alias(users, 'customer');
const agent = alias(users, 'agent');

const customerFields = {
  id: customer.id,
  firstName: customer.firstName,
  lastName: customer.lastName,
  phone: customer.phone,
};
const agentFields = { id: agent.id, firstName: agent.firstName, lastName: agent.lastName, phone: agent.phone };

/** Errands as support sees them: every errand, its whole history, and support's own actions. */
@Injectable()
export class ErrandsAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly errandsService: ErrandsService,
    private readonly wallet: WalletService,
    private readonly uploads: UploadsService,
    private readonly countries: CountriesService,
    private readonly audit: AuditService,
  ) {}

  /** Newest first, filtered by status and searched by errand id, phone number, name or description. */
  async list(query: { country: string; filter: ErrandFilter; q?: string; before?: string; limit: number }) {
    const cursor = parseCursor(query.before);
    const rows = await this.db
      .select({
        id: errands.id,
        createdAt: errands.createdAt,
        cursorAt: exactTime(errands.createdAt),
        status: errands.status,
        description: errands.description,
        categoryKey: errands.categoryKey,
        buy: errands.buy,
        urgent: errands.urgent,
        feeKobo: errands.feeKobo,
        serviceFeeKobo: errands.serviceFeeKobo,
        itemAmountKobo: errands.itemAmountKobo,
        stateCode: errands.stateCode,
        customer: customerFields,
        agent: agentFields,
      })
      .from(errands)
      .innerJoin(customer, eq(customer.id, errands.customerId))
      .leftJoin(agent, eq(agent.id, errands.agentId))
      .where(
        and(
          eq(errands.countryCode, query.country),
          query.filter === 'all' ? undefined : inArray(errands.status, [...STATUSES[query.filter]]),
          query.q ? this.search(query.q) : undefined,
          cursor
            ? sql`(${errands.createdAt}, ${errands.id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(errands.createdAt), desc(errands.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      errands: page.map(({ cursorAt: _, ...r }) => ({ ...r, agent: r.agent?.id ? r.agent : null })),
      next: rows.length > query.limit && last ? cursorOf(last) : null,
    };
  }

  private search(text: string): SQL | undefined {
    const like = containing(text);
    const phone = phoneDigits(text);
    const id = idPrefix(text);
    return or(
      ilike(errands.description, like),
      ilike(sql`coalesce(${customer.firstName}, '') || ' ' || coalesce(${customer.lastName}, '')`, like),
      ilike(sql`coalesce(${agent.firstName}, '') || ' ' || coalesce(${agent.lastName}, '')`, like),
      id ? ilike(sql`${errands.id}::text`, id) : undefined,
      phone ? ilike(customer.phone, `%${phone}%`) : undefined,
      phone ? ilike(agent.phone, `%${phone}%`) : undefined,
    );
  }

  /** Disputed errands, the one waiting longest first, with who opened it and why. */
  async disputes(country: string) {
    const rows = await this.db
      .select({
        id: errands.id,
        status: errands.status,
        description: errands.description,
        categoryKey: errands.categoryKey,
        buy: errands.buy,
        feeKobo: errands.feeKobo,
        serviceFeeKobo: errands.serviceFeeKobo,
        itemAmountKobo: errands.itemAmountKobo,
        customer: customerFields,
        agent: agentFields,
        since: disputedSince,
      })
      .from(errands)
      .innerJoin(customer, eq(customer.id, errands.customerId))
      .leftJoin(agent, eq(agent.id, errands.agentId))
      .where(and(eq(errands.countryCode, country), eq(errands.status, 'disputed')))
      // By when the dispute opened, not the last change to the errand.
      .orderBy(asc(disputedSince))
      .limit(200);
    if (rows.length === 0) return { disputes: [] };
    const opened = await this.db
      .select({
        errandId: errandEvents.errandId,
        event: errandEvents.event,
        actorRole: errandEvents.actorRole,
        data: errandEvents.data,
        createdAt: errandEvents.createdAt,
      })
      .from(errandEvents)
      .where(
        and(
          inArray(
            errandEvents.errandId,
            rows.map((r) => r.id),
          ),
          eq(errandEvents.toStatus, 'disputed'),
        ),
      )
      .orderBy(desc(errandEvents.id));
    const byErrand = new Map<string, (typeof opened)[number]>();
    for (const o of opened) if (!byErrand.has(o.errandId)) byErrand.set(o.errandId, o);
    return {
      disputes: rows.map((r) => {
        const o = byErrand.get(r.id);
        return {
          ...r,
          agent: r.agent?.id ? r.agent : null,
          since: r.since,
          openedBy: o ? (o.event === 'open_dispute' ? String(o.data.by ?? o.actorRole) : o.actorRole) : null,
          cause: o?.event ?? null,
          reason:
            typeof o?.data.reason === 'string' ? o.data.reason : typeof o?.data.note === 'string' ? o.data.note : null,
        };
      }),
    };
  }

  /** One errand in full, as evidence: people, route, timeline, chat, photos and every money movement. */
  async detail(id: string) {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, id));
    if (!errand) throw notFound('errand_not_found', 'Errand not found');
    const ids = [errand.customerId, ...(errand.agentId ? [errand.agentId] : [])];

    const [people, tier, stops, events, convos, files, journal, ratings, held, settings, customerBalanceKobo] =
      await Promise.all([
        this.db
          .select({
            id: users.id,
            firstName: users.firstName,
            lastName: users.lastName,
            phone: users.phone,
            status: users.status,
            createdAt: users.createdAt,
          })
          .from(users)
          .where(inArray(users.id, ids)),
        errand.agentId
          ? this.db
              .select({ tier: agentProfiles.tier })
              .from(agentProfiles)
              .where(eq(agentProfiles.userId, errand.agentId))
          : Promise.resolve([]),
        this.db
          .select({
            seq: errandStops.seq,
            kind: errandStops.kind,
            label: errandStops.label,
            address: errandStops.address,
            lat: errandStops.lat,
            lng: errandStops.lng,
          })
          .from(errandStops)
          .where(eq(errandStops.errandId, id))
          .orderBy(asc(errandStops.seq)),
        this.db
          .select({
            id: errandEvents.id,
            event: errandEvents.event,
            fromStatus: errandEvents.fromStatus,
            toStatus: errandEvents.toStatus,
            actorRole: errandEvents.actorRole,
            actorId: errandEvents.actorId,
            data: errandEvents.data,
            createdAt: errandEvents.createdAt,
          })
          .from(errandEvents)
          .where(eq(errandEvents.errandId, id))
          .orderBy(asc(errandEvents.id)),
        this.db
          .select({ id: conversations.id, agentId: conversations.agentId, closedAt: conversations.closedAt })
          .from(conversations)
          .where(eq(conversations.errandId, id))
          .orderBy(asc(conversations.createdAt)),
        this.db.select().from(uploads).where(eq(uploads.errandId, id)).orderBy(asc(uploads.createdAt)),
        this.db
          .select({
            id: journalEntries.id,
            kind: journalEntries.kind,
            data: journalEntries.data,
            createdAt: journalEntries.createdAt,
            accountType: ledgerAccounts.type,
            ownerId: ledgerAccounts.ownerId,
            amount: postings.amount,
          })
          .from(journalEntries)
          .innerJoin(postings, eq(postings.journalId, journalEntries.id))
          .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.accountId))
          .where(eq(journalEntries.errandId, id))
          .orderBy(asc(journalEntries.createdAt), asc(postings.id)),
        this.db.select().from(errandRatings).where(eq(errandRatings.errandId, id)),
        this.wallet.heldFor(id, errand.countryCode),
        this.countries.settingsAt(errand.countryCode, errand.settingsVersion),
        this.wallet.customerBalance(errand.customerId, errand.countryCode),
      ]);

    const chat = convos.length
      ? await this.db
          .select()
          .from(messages)
          .where(
            inArray(
              messages.conversationId,
              convos.map((c) => c.id),
            ),
          )
          .orderBy(asc(messages.id))
          .limit(1000)
      : [];
    const adminIds = [...new Set(events.filter((e) => e.actorRole === 'admin' && e.actorId).map((e) => e.actorId!))];
    const adminNames = new Map(
      adminIds.length
        ? (
            await this.db.select({ id: admins.id, name: admins.name }).from(admins).where(inArray(admins.id, adminIds))
          ).map((a) => [a.id, a.name])
        : [],
    );
    const byId = new Map(people.map((p) => [p.id, p]));
    // Every agent the errand has had, including ones who left, so their photos and chat still read as theirs.
    const agentIds = new Set([...convos.map((c) => c.agentId), ...(errand.agentId ? [errand.agentId] : [])]);
    const roleOf = (userId: string | null) =>
      userId === errand.customerId ? 'customer' : userId && agentIds.has(userId) ? 'agent' : null;
    const signed = async (key: string) => this.uploads.url(key);

    // The share-out a normal hand-off would make, as the starting point for settling a dispute.
    const standard = splitFeeEscrow({
      feeKobo: errand.feeKobo,
      serviceFeeKobo: errand.serviceFeeKobo,
      commissionBps: commissionBpsFor(settings.fees, errand.agentTier ?? 'bronze'),
    });

    const entries = new Map<
      string,
      { id: string; kind: string; data: Record<string, unknown>; createdAt: Date; postings: unknown[] }
    >();
    for (const j of journal) {
      const entry = entries.get(j.id) ?? { id: j.id, kind: j.kind, data: j.data, createdAt: j.createdAt, postings: [] };
      entry.postings.push({
        account: j.accountType,
        owner: j.accountType === 'fee_escrow' || j.accountType === 'item_escrow' ? 'errand' : roleOf(j.ownerId),
        // People's and errands' accounts are owed by the platform: a credit (negative) is money into them.
        amountKobo: -j.amount,
      });
      entries.set(j.id, entry);
    }

    const { pinCipher: _pin, pinHmac: _pinCheck, ...fields } = errand;
    return {
      errand: fields,
      customer: byId.get(errand.customerId) ?? null,
      agent: errand.agentId ? { ...byId.get(errand.agentId)!, tier: tier[0]?.tier ?? 'bronze' } : null,
      stops,
      events: events.map((e) => ({
        ...e,
        actorName:
          e.actorRole === 'admin'
            ? (adminNames.get(e.actorId ?? '') ?? 'Support')
            : e.actorId
              ? [byId.get(e.actorId)?.firstName, byId.get(e.actorId)?.lastName].filter(Boolean).join(' ') || null
              : null,
      })),
      chat: await Promise.all(
        chat.map(async (m) => ({
          id: m.id,
          conversationId: m.conversationId,
          senderRole: m.senderRole,
          kind: m.kind,
          body: m.body,
          photoUrl: m.kind === 'photo' && typeof m.data.key === 'string' ? await signed(m.data.key) : null,
          createdAt: m.createdAt,
        })),
      ),
      photos: await Promise.all(
        files.map(async (f) => ({
          purpose: f.purpose,
          from: roleOf(f.ownerId),
          url: await signed(f.key),
          createdAt: f.createdAt,
        })),
      ),
      money: {
        heldFeeKobo: held.feeKobo,
        heldItemsKobo: held.itemsKobo,
        customerBalanceKobo,
        standard: { agentKobo: standard.agentKobo, jiffoKobo: standard.serviceFeeKobo + standard.commissionKobo },
        /** What a settlement may take from the customer's wallet for items they never locked. */
        chargeableKobo: chargeableItemsKobo(errand, held.itemsKobo),
        journal: [...entries.values()],
      },
      ratings: ratings.map((r) => ({
        raterRole: r.raterRole,
        stars: r.stars,
        comment: r.comment,
        createdAt: r.createdAt,
      })),
      actions: allowedEvents(errand.status as ErrandState, {
        actor: 'admin',
        buy: errand.buy,
        pendingOffer: errand.pendingOfferKobo !== null,
      }).filter((e): e is AdminErrandEvent => (ADMIN_ERRAND_EVENTS as readonly string[]).includes(e)),
    };
  }

  /**
   * What settling a dispute would pay the agent, for the second-admin check (docs/security-plan.md, D4, E7):
   * a split's share to them, or for the standard way their share of the fee and the item money held.
   * Cancelling the standard way pays them nothing, and other actions move no money.
   */
  async agentPayout(id: string, input: { event: AdminErrandEvent; split?: DisputeSplit }) {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, id));
    if (!errand) throw notFound('errand_not_found', 'Errand not found');
    if (!input.event.startsWith('resolve_')) return { errand, toAgentKobo: 0 };
    if (input.split) {
      const s = input.split;
      return { errand, toAgentKobo: s.agentKobo + s.itemsToAgentKobo + s.chargeCustomerKobo };
    }
    if (input.event !== 'resolve_complete') return { errand, toAgentKobo: 0 };
    const [held, settings] = await Promise.all([
      this.wallet.heldFor(id, errand.countryCode),
      this.countries.settingsAt(errand.countryCode, errand.settingsVersion),
    ]);
    const standard = splitFeeEscrow({
      feeKobo: errand.feeKobo,
      serviceFeeKobo: errand.serviceFeeKobo,
      commissionBps: commissionBpsFor(settings.fees, errand.agentTier ?? 'bronze'),
    });
    return { errand, toAgentKobo: standard.agentKobo + held.itemsKobo };
  }

  /** Support's own action on an errand, recorded in the audit log in the same transaction. */
  act(
    admin: AdminContext,
    id: string,
    input: { event: AdminErrandEvent; version: number; note: string; split?: DisputeSplit },
  ) {
    return this.errandsService.adminTransition(id, admin.adminId, input, (tx, before, after) =>
      this.audit.record(tx, admin, {
        action: `errand.${input.event}`,
        targetType: 'errand',
        targetId: id,
        countryCode: after.countryCode,
        data: {
          note: input.note,
          from: before.status,
          to: after.status,
          ...(input.split ? { split: input.split } : {}),
        },
      }),
    );
  }
}
