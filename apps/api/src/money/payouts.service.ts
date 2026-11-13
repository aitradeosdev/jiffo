import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lt, sql, sum } from 'drizzle-orm';
import { formatNaira } from '@jiffo/shared';
import { DB, type Db } from '../db/database.module';
import { payoutAccounts, payouts, users } from '../db/schema';
import { PAYMENTS, PaymentsProviderError, type PaymentsAdapter } from '../adapters/payments';
import { ProvidersService } from '../providers/providers.service';
import { CountriesService } from '../countries/countries.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { AuthContext } from '../auth/auth.types';
import { conflict, unprocessable } from '../common/errors';
import { nameWords, plainName } from '../common/names';
import { LedgerService, transfer } from './ledger.service';
import { WalletService } from './wallet.service';
import { AgentsService } from '../agents/agents.service';
import { AgentApplicationService, matchesLegalName } from '../agents/application.service';

type PayoutRow = typeof payouts.$inferSelect;
const BANKS_TTL_MS = 24 * 3_600_000;
/** An instant withdrawal that didn't reach the provider is retried after a minute. */
const RETRY_AFTER_MS = 60_000;
/** A transfer with no news for this long is checked with the provider. */
const CHECK_AFTER_MS = 5 * 60_000;

const mask = (accountNumber: string) => `******${accountNumber.slice(-4)}`;

export const payoutView = (p: PayoutRow) => ({
  id: p.id,
  speed: p.speed,
  status: p.status,
  amountKobo: p.amountKobo,
  feeKobo: p.feeKobo,
  sendKobo: p.sendKobo,
  failureReason: p.failureReason,
  createdAt: p.createdAt,
  sentAt: p.sentAt,
  completedAt: p.completedAt,
});

/** Agents' payout accounts and withdrawals. Customers never withdraw in the app. */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);
  /** The bank list, per payments provider: each has its own codes. */
  private readonly banks = new Map<string, { at: number; list: Array<{ code: string; name: string }> }>();

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PAYMENTS) private readonly payments: PaymentsAdapter,
    private readonly ledger: LedgerService,
    private readonly wallet: WalletService,
    private readonly agents: AgentsService,
    private readonly applications: AgentApplicationService,
    private readonly countries: CountriesService,
    private readonly push: PushService,
    private readonly realtime: RealtimeGateway,
    private readonly providers: ProvidersService,
  ) {}

  async listBanks() {
    const name = this.payments.name;
    const cached = this.banks.get(name);
    if (cached && Date.now() - cached.at < BANKS_TTL_MS) return cached.list;
    const list = await this.payments.listBanks();
    this.banks.set(name, { at: Date.now(), list });
    return list;
  }

  /* ---------- Payout account ---------- */

  async currentAccount(userId: string) {
    const [account] = await this.db
      .select()
      .from(payoutAccounts)
      .where(and(eq(payoutAccounts.userId, userId), isNull(payoutAccounts.replacedAt)));
    return account ?? null;
  }

  async getAccount(auth: AuthContext) {
    const account = await this.currentAccount(auth.userId);
    return account
      ? {
          bankCode: account.bankCode,
          bankName: account.bankName,
          accountNumber: mask(account.accountNumber),
          accountName: account.accountName,
        }
      : null;
  }

  /**
   * Saves the agent's payout account. The bank's name for the account must be the agent's: once the
   * provider has checked their NIN, every word of it must be in the legal name on the NIN record;
   * before that, it must contain the first and last name in the app.
   */
  async setAccount(auth: AuthContext, bankCode: string, accountNumber: string) {
    const [me] = await this.db.select().from(users).where(eq(users.id, auth.userId));
    if (!me?.firstName || !me.lastName) throw conflict('profile_incomplete', 'Add your first and last name first');
    const bank = (await this.listBanks()).find((b) => b.code === bankCode);
    if (!bank) throw unprocessable('bank_not_supported', 'Choose a bank from the list');

    const legalName = await this.applications.legalName(auth.userId);
    let accountName: string;
    try {
      ({ accountName } = await this.payments.resolveAccount(
        bankCode,
        accountNumber,
        legalName ?? `${me.firstName} ${me.lastName}`,
      ));
    } catch (error) {
      if (error instanceof PaymentsProviderError)
        throw unprocessable('account_not_found', 'Check the account number and bank');
      throw error;
    }
    const held = nameWords(accountName);
    const own = legalName
      ? matchesLegalName(accountName, legalName)
      : held.has(plainName(me.firstName)) && held.has(plainName(me.lastName));
    if (!own) {
      throw unprocessable('account_name_mismatch', 'The account must be in your own name', { accountName });
    }

    const { recipientCode } = await this.payments.createRecipient({ name: accountName, bankCode, accountNumber });
    await this.db.transaction(async (tx) => {
      await tx
        .update(payoutAccounts)
        .set({ replacedAt: new Date() })
        .where(and(eq(payoutAccounts.userId, auth.userId), isNull(payoutAccounts.replacedAt)));
      await tx.insert(payoutAccounts).values({
        userId: auth.userId,
        provider: this.payments.name,
        bankCode,
        bankName: bank.name,
        accountNumber,
        accountName,
        recipientCode,
      });
    });
    return this.getAccount(auth);
  }

  /* ---------- Withdrawals ---------- */

  async request(auth: AuthContext, amountKobo: number, speed: 'instant' | 'scheduled') {
    const [{ settings }, { currency, timezone }, tier] = await Promise.all([
      this.countries.currentSettings(auth.countryCode),
      this.countries.basics(auth.countryCode),
      this.agents.tier(auth.userId),
    ]);
    const account = await this.currentAccount(auth.userId);
    if (!account) throw conflict('payout_account_missing', 'Add your bank account first');
    if (amountKobo < settings.limits.minWithdrawalKobo) {
      throw unprocessable('withdrawal_too_small', 'The amount is below the minimum withdrawal', {
        minWithdrawalKobo: settings.limits.minWithdrawalKobo,
      });
    }
    const feeKobo = speed === 'instant' ? settings.fees.instantWithdrawalFeeKobo : 0;
    if (amountKobo <= feeKobo)
      throw unprocessable('withdrawal_too_small', 'The amount must be more than the fee', { feeKobo });
    await this.wallet.releaseDue(auth.userId);

    const payout = await this.db.transaction(async (tx) => {
      // One withdrawal request at a time per agent, so the daily limit can't be raced.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'payout:' + auth.userId}))`);
      if (speed === 'scheduled') {
        const [queued] = await tx
          .select({ id: payouts.id })
          .from(payouts)
          .where(and(eq(payouts.userId, auth.userId), eq(payouts.speed, 'scheduled'), eq(payouts.status, 'requested')));
        if (queued) throw conflict('scheduled_withdrawal_exists', 'You already have a withdrawal going out today');
      }
      if (tier === 'bronze') {
        const startOfDay = sql`(date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone})`;
        const [today] = await tx
          .select({ total: sum(payouts.amountKobo) })
          .from(payouts)
          .where(
            and(
              eq(payouts.userId, auth.userId),
              gte(payouts.createdAt, startOfDay),
              inArray(payouts.status, ['requested', 'processing', 'succeeded']),
            ),
          );
        const used = Number(today?.total ?? 0);
        const limit = settings.limits.newAgentDailyWithdrawalKobo;
        if (used + amountKobo > limit) {
          throw unprocessable('daily_limit_reached', 'This is more than you can withdraw today', {
            remainingKobo: Math.max(0, limit - used),
          });
        }
      }

      const [row] = await tx
        .insert(payouts)
        .values({
          userId: auth.userId,
          countryCode: auth.countryCode,
          payoutAccountId: account.id,
          reference: `jp-${randomUUID()}`,
          speed,
          amountKobo,
          feeKobo,
          sendKobo: amountKobo - feeKobo,
        })
        .returning();
      await this.ledger.post(tx, {
        key: `payout:${row!.id}:request`,
        kind: 'payout',
        countryCode: auth.countryCode,
        currency,
        data: { speed, feeKobo },
        movements: [
          transfer({ type: 'agent_available', ownerId: auth.userId }, { type: 'payouts_in_transit' }, row!.sendKobo),
          transfer({ type: 'agent_available', ownerId: auth.userId }, { type: 'platform_revenue' }, feeKobo),
        ],
      });
      return row!;
    });

    this.realtime.toUser(auth.userId, 'agent', 'wallet.updated', { reason: 'payout', payoutId: payout.id });
    if (speed === 'instant') return payoutView((await this.send(payout.id)) ?? payout);
    return payoutView(payout);
  }

  async list(auth: AuthContext, limit: number) {
    const rows = await this.db
      .select()
      .from(payouts)
      .where(eq(payouts.userId, auth.userId))
      .orderBy(desc(payouts.createdAt))
      .limit(limit);
    return rows.map(payoutView);
  }

  /** Hands a requested payout to the provider. The reference makes a retry safe: the bank pays once. */
  async send(payoutId: string): Promise<PayoutRow | null> {
    const [payout] = await this.db.select().from(payouts).where(eq(payouts.id, payoutId));
    if (!payout || payout.status !== 'requested') return payout ?? null;
    // A payout tried before keeps the provider it was first sent to: asking another about it means nothing.
    const via = payout.provider
      ? this.providers.named('payments', payout.provider)
      : this.providers.current('payments');
    if (!via) return this.fail(payout.id, `${payout.provider} is no longer set up`);
    let account: typeof payoutAccounts.$inferSelect;
    try {
      account = await this.recipientWith(via, payout.payoutAccountId);
    } catch (error) {
      if (error instanceof PaymentsProviderError && error.status >= 400 && error.status < 500) {
        return this.fail(payout.id, error.message);
      }
      this.logger.warn(`Payout ${payout.id} not sent yet: ${(error as Error).message}`);
      return payout;
    }
    if (!payout.provider) {
      await this.db.update(payouts).set({ provider: via.name }).where(eq(payouts.id, payout.id));
    }

    let result: Awaited<ReturnType<PaymentsAdapter['transfer']>>;
    try {
      result = await via.transfer({
        reference: payout.reference,
        amountKobo: payout.sendKobo,
        recipientCode: account.recipientCode,
        reason: 'Jiffo earnings',
      });
    } catch (error) {
      // The provider may have taken the transfer and only the answer was lost. A retry would then be
      // refused as a duplicate reference, so ask about this reference before giving up.
      const known = await via.verifyTransfer(payout.reference).catch(() => null);
      // The provider never took it and said why (bad recipient, no balance, transfers off): give the money back.
      if (!known && error instanceof PaymentsProviderError && error.status >= 400 && error.status < 500) {
        return this.fail(payout.id, error.message);
      }
      if (!known) {
        // Left as requested: the daily run tries again with the same reference, so the bank pays once.
        this.logger.warn(`Payout ${payout.id} not sent yet: ${(error as Error).message}`);
        return payout;
      }
      result = { status: known.status, transferCode: null, reason: known.reason, feeKobo: known.feeKobo };
    }
    const [sent] = await this.db
      .update(payouts)
      .set({ status: 'processing', sentAt: new Date(), providerTransferCode: result.transferCode })
      .where(and(eq(payouts.id, payout.id), eq(payouts.status, 'requested')))
      .returning();
    if (result.status === 'success') return this.succeed(payout.id, result.feeKobo ?? 0);
    if (result.status === 'failed') return this.fail(payout.id, result.reason ?? 'failed');
    return sent ?? payout;
  }

  /**
   * The agent's payout account as a recipient with this provider. An account added while another provider
   * was in use is registered with this one first, from the bank details already checked.
   */
  private async recipientWith(via: PaymentsAdapter, accountId: string) {
    const [account] = await this.db.select().from(payoutAccounts).where(eq(payoutAccounts.id, accountId));
    if (!account) throw new Error(`Payout account ${accountId} not found`);
    if (account.provider === via.name) return account;
    const { recipientCode } = await via.createRecipient({
      name: account.accountName,
      bankCode: account.bankCode,
      accountNumber: account.accountNumber,
    });
    const [moved] = await this.db
      .update(payoutAccounts)
      .set({ provider: via.name, recipientCode })
      .where(eq(payoutAccounts.id, account.id))
      .returning();
    return moved!;
  }

  /** A transfer webhook arrived: ask the provider for the real status and settle the payout. */
  async sync(reference: string) {
    const [payout] = await this.db.select().from(payouts).where(eq(payouts.reference, reference));
    if (!payout) {
      this.logger.warn(`Transfer for unknown payout reference ${reference}`);
      return null;
    }
    const via = this.providers.named('payments', payout.provider ?? this.payments.name);
    if (!via) throw new Error(`Payout ${reference} went through ${payout.provider}, which is no longer set up`);
    const { status, reason, feeKobo } = await via.verifyTransfer(reference);
    if (status === 'success') return this.succeed(payout.id, feeKobo ?? 0);
    if (status === 'failed') return this.fail(payout.id, reason ?? 'failed');
    return payout;
  }

  /** The bank paid. The provider's own transfer fee, when it reports one, is booked so reconciliation stays exact. */
  private async succeed(payoutId: string, providerFeeKobo: number) {
    const done = await this.db.transaction(async (tx) => {
      const [payout] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).for('update');
      if (!payout || payout.status === 'succeeded' || payout.status === 'failed') return null;
      const { currency } = await this.countries.basics(payout.countryCode);
      await this.ledger.post(tx, {
        key: `payout:${payout.id}:sent`,
        kind: 'payout_sent',
        countryCode: payout.countryCode,
        currency,
        movements: [
          { debit: { type: 'payouts_in_transit' }, credit: { type: 'provider_cash' }, amountKobo: payout.sendKobo },
          { debit: { type: 'provider_fees' }, credit: { type: 'provider_cash' }, amountKobo: providerFeeKobo },
        ],
      });
      const [row] = await tx
        .update(payouts)
        .set({ status: 'succeeded', completedAt: new Date() })
        .where(eq(payouts.id, payout.id))
        .returning();
      return row!;
    });
    if (done) {
      await this.push.notifyUser(done.userId, 'agent', {
        title: 'Withdrawal sent',
        body: `${formatNaira(done.sendKobo)} is on its way to your bank.`,
        data: { type: 'wallet.payout', payoutId: done.id },
      });
    }
    return done ?? (await this.db.select().from(payouts).where(eq(payouts.id, payoutId)))[0] ?? null;
  }

  /** The bank refused the transfer: the full amount, fee included, goes back to the agent's balance. */
  private async fail(payoutId: string, reason: string) {
    const done = await this.db.transaction(async (tx) => {
      const [payout] = await tx.select().from(payouts).where(eq(payouts.id, payoutId)).for('update');
      if (!payout || payout.status === 'failed') return null;
      const { currency } = await this.countries.basics(payout.countryCode);
      const agent = { type: 'agent_available' as const, ownerId: payout.userId };
      // A transfer the bank reverses after it succeeded comes back out of cash, not the in-transit account.
      const source =
        payout.status === 'succeeded' ? { type: 'provider_cash' as const } : { type: 'payouts_in_transit' as const };
      await this.ledger.post(tx, {
        key: `payout:${payout.id}:reversed`,
        kind: 'payout_reversed',
        countryCode: payout.countryCode,
        currency,
        data: { reason },
        movements: [
          { debit: source, credit: agent, amountKobo: payout.sendKobo },
          transfer({ type: 'platform_revenue' }, agent, payout.feeKobo),
        ],
      });
      const [row] = await tx
        .update(payouts)
        .set({ status: 'failed', failureReason: reason, completedAt: new Date() })
        .where(eq(payouts.id, payout.id))
        .returning();
      return row!;
    });
    if (done) {
      this.realtime.toUser(done.userId, 'agent', 'wallet.updated', { reason: 'payout_failed', payoutId: done.id });
      await this.push.notifyUser(done.userId, 'agent', {
        title: 'Withdrawal failed',
        body: `${formatNaira(done.amountKobo)} is back in your balance. Check your bank details and try again.`,
        data: { type: 'wallet.payout', payoutId: done.id },
      });
    }
    return done ?? (await this.db.select().from(payouts).where(eq(payouts.id, payoutId)))[0] ?? null;
  }

  /** The daily run: sends the free scheduled withdrawals, then catches up on anything else. */
  async runDaily() {
    const scheduled = await this.db
      .select({ id: payouts.id })
      .from(payouts)
      .where(and(eq(payouts.status, 'requested'), eq(payouts.speed, 'scheduled')))
      .limit(5_000);
    for (const p of scheduled) await this.send(p.id);
    return { scheduled: scheduled.length, ...(await this.retryPending()) };
  }

  /**
   * Every few minutes: releases held earnings that are due, retries instant withdrawals that never
   * reached the provider, and asks again about transfers that went quiet.
   */
  async retryPending() {
    const released = await this.wallet.releaseDue();
    const instant = await this.db
      .select({ id: payouts.id })
      .from(payouts)
      .where(
        and(
          eq(payouts.status, 'requested'),
          eq(payouts.speed, 'instant'),
          lt(payouts.createdAt, new Date(Date.now() - RETRY_AFTER_MS)),
        ),
      )
      .limit(1_000);
    for (const p of instant) await this.send(p.id);
    const stuck = await this.db
      .select({ reference: payouts.reference })
      .from(payouts)
      .where(and(eq(payouts.status, 'processing'), lt(payouts.sentAt, new Date(Date.now() - CHECK_AFTER_MS))))
      .limit(1_000);
    for (const p of stuck) {
      try {
        await this.sync(p.reference);
      } catch (error) {
        this.logger.warn(`Could not check payout ${p.reference}: ${(error as Error).message}`);
      }
    }
    return { released, retried: instant.length, checked: stuck.length };
  }
}
