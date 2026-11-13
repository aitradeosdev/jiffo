import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lt, lte, sql, type SQLWrapper } from 'drizzle-orm';
import {
  ERRAND_STATES,
  TERMINAL_STATES,
  commissionBpsFor,
  holdsEarnings,
  splitFeeEscrow,
  type AgentTier,
  type CountrySettings,
  type ErrandEvent,
} from '@jiffo/shared';
import { DB, type Db, type Tx } from '../db/database.module';
import { earningHolds, errands, journalEntries, ledgerAccounts, postings, type LedgerAccountType } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import { AgentsService } from '../agents/agents.service';
import { ApiError, conflict, notFound, unprocessable } from '../common/errors';
import type { AuthContext } from '../auth/auth.types';
import { InsufficientFunds, LedgerService, accountKey, transfer, type AccountRef } from './ledger.service';

type ErrandRow = typeof errands.$inferSelect;

/**
 * Item money the customer can be charged from their wallet when support settles: the amount the agent sent
 * with the receipt, on a purchase errand whose item amount was never locked (nothing is held for items).
 */
export const chargeableItemsKobo = (errand: { buy: boolean; itemAmountKobo: number | null }, heldItemsKobo: number) =>
  errand.buy && heldItemsKobo === 0 ? (errand.itemAmountKobo ?? 0) : 0;

/** How support shares out a disputed errand's money. Amounts in kobo; whatever is left goes back to the customer. */
export interface DisputeSplit {
  /** From the fee escrow, to the agent. */
  agentKobo: number;
  /** From the fee escrow, kept by Jiffo. */
  jiffoKobo: number;
  /** From the item escrow, to the agent. */
  itemsToAgentKobo: number;
  /** From the customer's wallet to the agent, for items bought but never locked. */
  chargeCustomerKobo: number;
}

const HOUR_MS = 3_600_000;

/** An agent tried to accept, but the customer's wallet no longer covers the fee and service fee. */
export class CustomerFundsLow extends ApiError {
  constructor() {
    super(409, 'customer_funds_low', "The customer's wallet can't cover this errand yet. Try another errand.");
  }
}
const wallet = (userId: string): AccountRef => ({ type: 'customer_wallet', ownerId: userId });
const available = (userId: string): AccountRef => ({ type: 'agent_available', ownerId: userId });
const held = (userId: string): AccountRef => ({ type: 'agent_held', ownerId: userId });
const feeEscrow = (errandId: string): AccountRef => ({ type: 'fee_escrow', ownerId: errandId });
const itemEscrow = (errandId: string): AccountRef => ({ type: 'item_escrow', ownerId: errandId });
const REVENUE: AccountRef = { type: 'platform_revenue' };

/** Between accept and the end of an errand, its money sits in escrow. */
const HOLDING_STATES = ERRAND_STATES.filter((s) => s !== 'requested' && !TERMINAL_STATES.has(s));

/** What each journal kind looks like in the wallet history. */
const HISTORY_LABELS: Record<string, string> = {
  deposit: 'Bank transfer top-up',
  fee_lock: 'Errand fee held',
  fee_adjust: 'Errand fee changed',
  fee_refund: 'Errand fee returned',
  items_lock: 'Item amount held',
  items_refund: 'Item amount returned',
  settle: 'Errand completed',
  tip: 'Tip',
  hold_release: 'Earnings now available',
  payout: 'Withdrawal',
  payout_reversed: 'Withdrawal returned',
};

@Injectable()
export class WalletService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly countries: CountriesService,
    private readonly agents: AgentsService,
  ) {}

  /** What is held for one errand right now: the fee with its service fee, and locked item money. */
  async heldFor(errandId: string, countryCode: string) {
    const [feeKobo, itemsKobo] = await Promise.all([
      this.ledger.balance(this.db, feeEscrow(errandId), countryCode),
      this.ledger.balance(this.db, itemEscrow(errandId), countryCode),
    ]);
    return { feeKobo, itemsKobo };
  }

  async customerBalance(userId: string, countryCode: string) {
    return this.ledger.balance(this.db, wallet(userId), countryCode);
  }

  /* ---------- Errand money ---------- */

  /**
   * Moves the errand's money for a state change, inside the errand's own transaction: the fee escrow
   * on accept and price changes, item escrow when the customer locks the item amount, refunds when an
   * agent leaves or the errand ends unfinished, and the share-out at hand-off.
   */
  async onErrandTransition(
    tx: Tx,
    input: {
      before: ErrandRow;
      after: ErrandRow;
      event: ErrandEvent;
      settings: CountrySettings;
      currency: string;
      tier: AgentTier;
    },
  ) {
    const { before, after, event, settings, currency } = input;
    const base = { countryCode: after.countryCode, currency, errandId: after.id };
    const key = (what: string) => `errand:${after.id}:${what}:${after.version}`;
    const customer = wallet(after.customerId);

    if (event === 'accept') {
      try {
        await this.ledger.post(tx, {
          ...base,
          key: key('fee_lock'),
          kind: 'fee_lock',
          movements: [transfer(customer, feeEscrow(after.id), after.feeKobo + after.serviceFeeKobo)],
        });
      } catch (error) {
        if (error instanceof InsufficientFunds) throw new CustomerFundsLow();
        throw error;
      }
      return;
    }

    if (event === 'accept_offer') {
      const change = after.feeKobo + after.serviceFeeKobo - (before.feeKobo + before.serviceFeeKobo);
      await this.ledger.post(tx, {
        ...base,
        key: key('fee_adjust'),
        kind: 'fee_adjust',
        data: { fromKobo: before.feeKobo, toKobo: after.feeKobo },
        movements: [
          change > 0
            ? transfer(customer, feeEscrow(after.id), change)
            : transfer(feeEscrow(after.id), customer, -change),
        ],
      });
      return;
    }

    if (event === 'lock_item_amount') {
      await this.ledger.post(tx, {
        ...base,
        key: key('items_lock'),
        kind: 'items_lock',
        movements: [transfer(customer, itemEscrow(after.id), after.itemAmountKobo ?? 0)],
      });
      return;
    }

    // The tier recorded when the agent accepted, so a later change by admin never alters this errand.
    if (after.status === 'completed') return this.settle(tx, after, settings, currency, after.agentTier ?? input.tier);

    // The agent left before starting, or the errand ended unfinished: whatever is held goes back.
    const agentLeft = after.status === 'requested' && before.status === 'accepted';
    if (agentLeft || after.status === 'cancelled' || after.status === 'expired') {
      const [fee, items] = await Promise.all([
        this.ledger.balance(tx, feeEscrow(after.id), after.countryCode),
        this.ledger.balance(tx, itemEscrow(after.id), after.countryCode),
      ]);
      if (fee + items === 0) return;
      await this.ledger.post(tx, {
        ...base,
        key: key('refund'),
        kind: items > 0 ? 'items_refund' : 'fee_refund',
        movements: [transfer(feeEscrow(after.id), customer, fee), transfer(itemEscrow(after.id), customer, items)],
      });
    }
  }

  /**
   * Support settles a dispute by hand: the fee escrow goes to the agent, to Jiffo and back to the customer in
   * the amounts given; the item escrow to the agent or back; and, when the customer never locked the item
   * amount, up to that amount can be taken from their wallet for the agent. Posted under the errand's settle
   * key, so the agent's earnings and the receipts read it like any other settlement.
   */
  async resolveDispute(
    tx: Tx,
    errand: ErrandRow,
    split: DisputeSplit,
    ctx: { settings: CountrySettings; currency: string; tier: AgentTier },
  ) {
    const { currency, tier } = ctx;
    const [fee, items] = await Promise.all([
      this.ledger.balance(tx, feeEscrow(errand.id), errand.countryCode),
      this.ledger.balance(tx, itemEscrow(errand.id), errand.countryCode),
    ]);
    const refundKobo = fee - split.agentKobo - split.jiffoKobo;
    const itemsRefundKobo = items - split.itemsToAgentKobo;
    if (refundKobo < 0) {
      throw unprocessable('split_too_large', 'The agent and Jiffo shares are more than the fee held', {
        heldKobo: fee,
      });
    }
    if (itemsRefundKobo < 0) {
      throw unprocessable('items_too_large', 'More than the item money held', { heldKobo: items });
    }
    const chargeable = chargeableItemsKobo(errand, items);
    if (split.chargeCustomerKobo > chargeable) {
      throw unprocessable(
        'charge_not_allowed',
        "The customer's wallet can only be charged up to the item amount they never locked",
        { chargeableKobo: chargeable },
      );
    }
    const agentId = errand.agentId;
    if (!agentId && split.agentKobo + split.itemsToAgentKobo + split.chargeCustomerKobo > 0) {
      throw unprocessable('no_agent', 'This errand has no agent to pay');
    }
    const hold = holdsEarnings(tier);
    const customer = wallet(errand.customerId);
    try {
      await this.ledger.post(tx, {
        key: `errand:${errand.id}:settle`,
        kind: 'settle',
        countryCode: errand.countryCode,
        currency,
        errandId: errand.id,
        data: {
          tier,
          agentKobo: split.agentKobo,
          // Jiffo's share counts as the service fee first, then as commission, as at a normal hand-off.
          serviceFeeKobo: Math.min(split.jiffoKobo, errand.serviceFeeKobo),
          commissionKobo: split.jiffoKobo - Math.min(split.jiffoKobo, errand.serviceFeeKobo),
          itemsKobo: split.itemsToAgentKobo + split.chargeCustomerKobo,
          resolution: { refundKobo, itemsRefundKobo, chargeCustomerKobo: split.chargeCustomerKobo },
        },
        movements: agentId
          ? [
              transfer(feeEscrow(errand.id), hold ? held(agentId) : available(agentId), split.agentKobo),
              transfer(feeEscrow(errand.id), REVENUE, split.jiffoKobo),
              transfer(feeEscrow(errand.id), customer, refundKobo),
              transfer(itemEscrow(errand.id), available(agentId), split.itemsToAgentKobo),
              transfer(itemEscrow(errand.id), customer, itemsRefundKobo),
              transfer(customer, available(agentId), split.chargeCustomerKobo),
            ]
          : [
              transfer(feeEscrow(errand.id), REVENUE, split.jiffoKobo),
              transfer(feeEscrow(errand.id), customer, refundKobo),
              transfer(itemEscrow(errand.id), customer, itemsRefundKobo),
            ],
      });
    } catch (error) {
      if (error instanceof InsufficientFunds) {
        throw conflict('customer_funds_low', "The customer's wallet doesn't hold that much. Charge less.");
      }
      throw error;
    }
    if (agentId && hold && split.agentKobo > 0) {
      await tx.insert(earningHolds).values({
        userId: agentId,
        countryCode: errand.countryCode,
        errandId: errand.id,
        amountKobo: split.agentKobo,
        availableAt: new Date(Date.now() + ctx.settings.timers.bronzePayoutHoldHours * HOUR_MS),
      });
    }
    return { refundKobo, itemsRefundKobo };
  }

  /** Hand-off: the item money goes to the agent untouched; the fee escrow is shared out. */
  private async settle(tx: Tx, errand: ErrandRow, settings: CountrySettings, currency: string, tier: AgentTier) {
    const agentId = errand.agentId!;
    const [fee, items] = await Promise.all([
      this.ledger.balance(tx, feeEscrow(errand.id), errand.countryCode),
      this.ledger.balance(tx, itemEscrow(errand.id), errand.countryCode),
    ]);
    const split = splitFeeEscrow({
      feeKobo: errand.feeKobo,
      serviceFeeKobo: errand.serviceFeeKobo,
      commissionBps: commissionBpsFor(settings.fees, tier),
    });
    if (split.escrowKobo !== fee) {
      throw new Error(`Fee escrow for ${errand.id} holds ${fee} but the errand needs ${split.escrowKobo}`);
    }
    const hold = holdsEarnings(tier);
    await this.ledger.post(tx, {
      key: `errand:${errand.id}:settle`,
      kind: 'settle',
      countryCode: errand.countryCode,
      currency,
      errandId: errand.id,
      data: { tier, ...split, itemsKobo: items },
      movements: [
        transfer(itemEscrow(errand.id), available(agentId), items),
        transfer(feeEscrow(errand.id), REVENUE, split.serviceFeeKobo + split.commissionKobo),
        transfer(feeEscrow(errand.id), hold ? held(agentId) : available(agentId), split.agentKobo),
      ],
    });
    if (hold && split.agentKobo > 0) {
      await tx.insert(earningHolds).values({
        userId: agentId,
        countryCode: errand.countryCode,
        errandId: errand.id,
        amountKobo: split.agentKobo,
        availableAt: new Date(Date.now() + settings.timers.bronzePayoutHoldHours * HOUR_MS),
      });
    }
  }

  /** A tip after completion goes wholly to the agent, on the same timing as their earnings. */
  async tip(auth: AuthContext, errandId: string, amountKobo: number) {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, errandId));
    if (!errand || errand.customerId !== auth.userId) throw notFound('errand_not_found', 'Errand not found');
    if (errand.status !== 'completed' || !errand.agentId)
      throw conflict('tip_not_available', 'You can tip once the errand is complete');
    const [settings, { currency }, tier] = await Promise.all([
      this.countries.settingsAt(errand.countryCode, errand.settingsVersion),
      this.countries.basics(errand.countryCode),
      errand.agentTier ?? this.agents.tier(errand.agentId),
    ]);
    const hold = holdsEarnings(tier);
    const agentId = errand.agentId;

    const posted = await this.db.transaction(async (tx) => {
      const done = await this.ledger.post(tx, {
        key: `errand:${errand.id}:tip`,
        kind: 'tip',
        countryCode: errand.countryCode,
        currency,
        errandId: errand.id,
        movements: [transfer(wallet(auth.userId), hold ? held(agentId) : available(agentId), amountKobo)],
      });
      if (done && hold) {
        await tx.insert(earningHolds).values({
          userId: agentId,
          countryCode: errand.countryCode,
          errandId: errand.id,
          amountKobo,
          availableAt: new Date(Date.now() + settings.timers.bronzePayoutHoldHours * HOUR_MS),
        });
      }
      return done;
    });
    if (!posted) throw conflict('already_tipped', 'You already tipped on this errand');
    return { agentId, amountKobo };
  }

  /* ---------- Held earnings ---------- */

  /** Moves the agent's held earnings that are now due into their available balance. */
  async releaseDue(userId?: string) {
    const due = await this.db
      .select()
      .from(earningHolds)
      .where(
        and(
          isNull(earningHolds.releasedAt),
          lte(earningHolds.availableAt, new Date()),
          userId ? eq(earningHolds.userId, userId) : undefined,
        ),
      )
      .orderBy(asc(earningHolds.availableAt))
      .limit(500);
    let released = 0;
    for (const hold of due) {
      const { currency } = await this.countries.basics(hold.countryCode);
      await this.db.transaction(async (tx) => {
        const [locked] = await tx
          .select()
          .from(earningHolds)
          .where(and(eq(earningHolds.id, hold.id), isNull(earningHolds.releasedAt)))
          .for('update', { skipLocked: true });
        if (!locked) return;
        await this.ledger.post(tx, {
          key: `hold:${hold.id}:release`,
          kind: 'hold_release',
          countryCode: hold.countryCode,
          currency,
          errandId: hold.errandId,
          movements: [transfer(held(hold.userId), available(hold.userId), hold.amountKobo)],
        });
        await tx.update(earningHolds).set({ releasedAt: new Date() }).where(eq(earningHolds.id, hold.id));
        released += 1;
      });
    }
    return released;
  }

  /* ---------- Reading ---------- */

  async summary(auth: AuthContext) {
    const { currency, timezone } = await this.countries.basics(auth.countryCode);
    if (auth.app === 'customer') {
      const [balanceKobo, holding] = await Promise.all([
        this.ledger.balance(this.db, wallet(auth.userId), auth.countryCode),
        this.holding(auth),
      ]);
      return { currency, balanceKobo, heldKobo: holding.reduce((sum, h) => sum + h.heldKobo, 0), holding };
    }
    // Read only: earnings whose hold has ended count as available here, and are moved in the ledger by
    // the recurring job or when the agent withdraws.
    const [availableKobo, heldKobo, holds, week] = await Promise.all([
      this.ledger.balance(this.db, available(auth.userId), auth.countryCode),
      this.ledger.balance(this.db, held(auth.userId), auth.countryCode),
      this.db
        .select({ amountKobo: earningHolds.amountKobo, availableAt: earningHolds.availableAt })
        .from(earningHolds)
        .where(and(eq(earningHolds.userId, auth.userId), isNull(earningHolds.releasedAt)))
        .orderBy(asc(earningHolds.availableAt)),
      this.week(auth, timezone),
    ]);
    // Today is the last of the seven days, so both read the same way.
    const todayKobo = week[week.length - 1]?.earnedKobo ?? 0;
    const now = Date.now();
    const dueKobo = holds.filter((h) => h.availableAt.getTime() <= now).reduce((sum, h) => sum + h.amountKobo, 0);
    return {
      currency,
      availableKobo: availableKobo + dueKobo,
      heldKobo: heldKobo - dueKobo,
      todayKobo,
      week,
      tier: await this.agents.tier(auth.userId),
      upcoming: holds.filter((h) => h.availableAt.getTime() > now).slice(0, 20),
    };
  }

  /**
   * How finished errands paid the agent: their fee share, the commission, item money paid back and any
   * tip, from the settlement and tip entries.
   */
  async settlements(errandIds: string[]) {
    const out = new Map<
      string,
      {
        agentKobo: number;
        commissionKobo: number;
        itemsKobo: number;
        tipKobo: number;
        tier: string | null;
        /** Settled by support, which may have shared the fee differently. */
        bySupport: boolean;
      }
    >();
    if (errandIds.length === 0) return out;
    const keys = errandIds.flatMap((id) => [`errand:${id}:settle`, `errand:${id}:tip`]);
    const rows = await this.db
      .select({
        errandId: journalEntries.errandId,
        kind: journalEntries.kind,
        data: journalEntries.data,
        // Both postings of a tip move the same amount.
        // Only a tip needs its amount from the postings (both move the same amount). Spelled out with
        // table names: inside a select list the columns would otherwise be unqualified.
        amount: sql<string>`case when "journal_entries"."kind" = 'tip'
          then (select coalesce(max(abs(p.amount)), 0) from postings p where p.journal_id = "journal_entries"."id")
          else 0 end`,
      })
      .from(journalEntries)
      .where(inArray(journalEntries.key, keys));
    for (const r of rows) {
      if (!r.errandId) continue;
      const entry = out.get(r.errandId) ?? {
        agentKobo: 0,
        commissionKobo: 0,
        itemsKobo: 0,
        tipKobo: 0,
        tier: null,
        bySupport: false,
      };
      if (r.kind === 'settle') {
        entry.agentKobo = Number(r.data.agentKobo ?? 0);
        entry.commissionKobo = Number(r.data.commissionKobo ?? 0);
        entry.itemsKobo = Number(r.data.itemsKobo ?? 0);
        entry.tier = typeof r.data.tier === 'string' ? r.data.tier : null;
        entry.bySupport = !!r.data.resolution;
      } else {
        entry.tipKobo = Number(r.amount);
      }
      out.set(r.errandId, entry);
    }
    return out;
  }

  /**
   * The agent's earnings for each of the last 7 days in the country's time zone: their share of each
   * fee (as recorded when the errand settled) and tips. Item money paid back is their own money, not
   * earnings.
   */
  private async week(auth: AuthContext, timezone: string) {
    const keys = (['agent_available', 'agent_held'] as const).map((type) =>
      accountKey({ type, ownerId: auth.userId }, auth.countryCode),
    );
    // Grouped by position (1, the day): the time zone is a parameter, so a repeated expression would differ.
    const day = (col: SQLWrapper) => sql<string>`to_char(${col} at time zone ${timezone}, 'YYYY-MM-DD')`;
    const since = sql`date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone} - interval '6 days'`;
    const [fees, tips] = await Promise.all([
      this.db
        .select({
          day: day(journalEntries.createdAt),
          total: sql<string>`sum((${journalEntries.data}->>'agentKobo')::bigint)`,
        })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.kind, 'settle'),
            gte(journalEntries.createdAt, since),
            sql`exists (select 1 from ${postings} join ${ledgerAccounts} on ${ledgerAccounts.id} = ${postings.accountId}
              where ${postings.journalId} = ${journalEntries.id} and ${inArray(ledgerAccounts.key, keys)})`,
          ),
        )
        .groupBy(sql`1`),
      this.db
        .select({ day: day(postings.createdAt), total: sql<string>`sum(-${postings.amount})` })
        .from(postings)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.accountId))
        .innerJoin(journalEntries, eq(journalEntries.id, postings.journalId))
        .where(and(inArray(ledgerAccounts.key, keys), eq(journalEntries.kind, 'tip'), gte(postings.createdAt, since)))
        .groupBy(sql`1`),
    ]);
    const totals = new Map<string, number>();
    for (const r of [...fees, ...tips]) totals.set(r.day, (totals.get(r.day) ?? 0) + Number(r.total));
    // Today's date where the country is, as YYYY-MM-DD.
    const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short' }).format(new Date());
    const [y, m, d] = todayKey.split('-').map(Number) as [number, number, number];
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(Date.UTC(y, m - 1, d - 6 + i)).toISOString().slice(0, 10);
      return { date, earnedKobo: totals.get(date) ?? 0 };
    });
  }

  /** The customer's errands that have money held in escrow now, with how much. */
  private async holding(auth: AuthContext) {
    const running = await this.db
      .select({ id: errands.id, description: errands.description })
      .from(errands)
      .where(
        and(
          eq(errands.customerId, auth.userId),
          eq(errands.countryCode, auth.countryCode),
          inArray(errands.status, HOLDING_STATES),
        ),
      );
    if (running.length === 0) return [];
    const accounts = await this.db
      .select({ key: ledgerAccounts.key, balance: ledgerAccounts.balance })
      .from(ledgerAccounts)
      .where(
        inArray(
          ledgerAccounts.key,
          running.flatMap((e) => [
            accountKey(feeEscrow(e.id), auth.countryCode),
            accountKey(itemEscrow(e.id), auth.countryCode),
          ]),
        ),
      );
    const balance = new Map(accounts.map((a) => [a.key, a.balance]));
    return running
      .map((e) => ({
        errandId: e.id,
        description: e.description,
        heldKobo:
          (balance.get(accountKey(feeEscrow(e.id), auth.countryCode)) ?? 0) +
          (balance.get(accountKey(itemEscrow(e.id), auth.countryCode)) ?? 0),
      }))
      .filter((h) => h.heldKobo > 0);
  }

  /** The person's money movements, newest first. Amounts are positive for money in, negative for money out. */
  async history(auth: AuthContext, before: number | undefined, limit: number) {
    const types: LedgerAccountType[] =
      auth.app === 'customer' ? ['customer_wallet'] : ['agent_available', 'agent_held'];
    const keys = types.map((type) => accountKey({ type, ownerId: auth.userId }, auth.countryCode));
    const rows = await this.db
      .select({
        id: postings.id,
        amount: postings.amount,
        accountType: ledgerAccounts.type,
        kind: journalEntries.kind,
        // Settled by support rather than at the hand-off.
        resolved: sql<boolean>`${journalEntries.data} ? 'resolution'`,
        errandId: journalEntries.errandId,
        errandDescription: errands.description,
        createdAt: postings.createdAt,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.accountId))
      .innerJoin(journalEntries, eq(journalEntries.id, postings.journalId))
      .leftJoin(errands, eq(errands.id, journalEntries.errandId))
      .where(and(inArray(ledgerAccounts.key, keys), before ? lt(postings.id, before) : undefined))
      .orderBy(desc(postings.id))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      // Every person-facing account is owed by the platform, so a credit is money in.
      amountKobo: -r.amount,
      kind: r.kind,
      label: r.resolved ? 'Settled by Jiffo support' : (HISTORY_LABELS[r.kind] ?? r.kind),
      balance: r.accountType === 'agent_held' ? 'held' : 'available',
      errandId: r.errandId,
      /** What the errand was for, so a movement reads as more than its kind. */
      detail: r.errandDescription,
      createdAt: r.createdAt,
    }));
  }

  /** Sum of every posting: zero when the ledger balances. Used by reconciliation and tests. */
  trialBalance() {
    return this.ledger.trialBalance(this.db);
  }
}

export const MONEY_ACCOUNTS = { wallet, available, held, feeEscrow, itemEscrow, REVENUE };
