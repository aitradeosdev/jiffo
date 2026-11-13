import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt, lte } from 'drizzle-orm';
import {
  commissionBpsFor,
  holdsEarnings,
  splitFeeEscrow,
  type CommissionTier,
  type CountrySettings,
  type ErrandEvent,
} from '@jiffo/shared';
import { DB, type Db, type Tx } from '../db/database.module';
import { earningHolds, errands, journalEntries, ledgerAccounts, postings, type LedgerAccountType } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import { ApiError, conflict, notFound } from '../common/errors';
import type { AuthContext } from '../auth/auth.types';
import { InsufficientFunds, LedgerService, accountKey, transfer, type AccountRef } from './ledger.service';

type ErrandRow = typeof errands.$inferSelect;

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
  ) {}

  /**
   * The agent's tier sets their commission and when earnings can be withdrawn. Tiers are worked out
   * from the last 30 days once agent profiles exist; until then every agent is Bronze, which also
   * covers new agents.
   */
  async agentTier(_userId: string): Promise<CommissionTier> {
    return 'bronze';
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
      tier: CommissionTier;
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

    if (after.status === 'completed') return this.settle(tx, after, settings, currency, input.tier);

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

  /** Hand-off: the item money goes to the agent untouched; the fee escrow is shared out. */
  private async settle(tx: Tx, errand: ErrandRow, settings: CountrySettings, currency: string, tier: CommissionTier) {
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
      this.agentTier(errand.agentId),
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
    const { currency } = await this.countries.basics(auth.countryCode);
    if (auth.app === 'customer') {
      return { currency, balanceKobo: await this.ledger.balance(this.db, wallet(auth.userId), auth.countryCode) };
    }
    // Read only: earnings whose hold has ended count as available here, and are moved in the ledger by
    // the recurring job or when the agent withdraws.
    const [availableKobo, heldKobo, holds] = await Promise.all([
      this.ledger.balance(this.db, available(auth.userId), auth.countryCode),
      this.ledger.balance(this.db, held(auth.userId), auth.countryCode),
      this.db
        .select({ amountKobo: earningHolds.amountKobo, availableAt: earningHolds.availableAt })
        .from(earningHolds)
        .where(and(eq(earningHolds.userId, auth.userId), isNull(earningHolds.releasedAt)))
        .orderBy(asc(earningHolds.availableAt)),
    ]);
    const now = Date.now();
    const dueKobo = holds.filter((h) => h.availableAt.getTime() <= now).reduce((sum, h) => sum + h.amountKobo, 0);
    return {
      currency,
      availableKobo: availableKobo + dueKobo,
      heldKobo: heldKobo - dueKobo,
      tier: await this.agentTier(auth.userId),
      upcoming: holds.filter((h) => h.availableAt.getTime() > now).slice(0, 20),
    };
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
        errandId: journalEntries.errandId,
        createdAt: postings.createdAt,
      })
      .from(postings)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, postings.accountId))
      .innerJoin(journalEntries, eq(journalEntries.id, postings.journalId))
      .where(and(inArray(ledgerAccounts.key, keys), before ? lt(postings.id, before) : undefined))
      .orderBy(desc(postings.id))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      // Every person-facing account is owed by the platform, so a credit is money in.
      amountKobo: -r.amount,
      kind: r.kind,
      label: HISTORY_LABELS[r.kind] ?? r.kind,
      balance: r.accountType === 'agent_held' ? 'held' : 'available',
      errandId: r.errandId,
      createdAt: r.createdAt,
    }));
  }

  /** Sum of every posting: zero when the ledger balances. Used by reconciliation and tests. */
  trialBalance() {
    return this.ledger.trialBalance(this.db);
  }
}

export const MONEY_ACCOUNTS = { wallet, available, held, feeEscrow, itemEscrow, REVENUE };
