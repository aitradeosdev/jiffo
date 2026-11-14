import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNull, lt, or, sql, sum } from 'drizzle-orm';
import { formatNaira } from '@jiffo/shared';
import { DB, type Db } from '../db/database.module';
import { payoutAccounts, payouts, reconciliationRuns, users } from '../db/schema';
import {
  PAYMENTS,
  PaymentsProviderError,
  type PaymentsAdapter,
  type TransferApprovalRequest,
} from '../adapters/payments';
import { ProvidersService } from '../providers/providers.service';
import { CountriesService } from '../countries/countries.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { AuthContext } from '../auth/auth.types';
import { conflict, unprocessable } from '../common/errors';
import { AlertsService } from '../alerts/alerts.service';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { nameWords, plainName } from '../common/names';
import { LedgerService, transfer } from './ledger.service';
import { WalletService } from './wallet.service';
import { AgentsService } from '../agents/agents.service';
import { AgentApplicationService } from '../agents/application.service';
import { matchesLegalName } from '../common/names';

type PayoutRow = typeof payouts.$inferSelect;
const BANKS_TTL_MS = 24 * 3_600_000;
/** An instant withdrawal that didn't reach the provider is retried after a minute. */
const RETRY_AFTER_MS = 60_000;
/** A transfer with no news for this long is checked with the provider. */
const CHECK_AFTER_MS = 5 * 60_000;
/**
 * How long one run may hold a withdrawal while it hands it to the provider: longer than the slowest send
 * (bank list, recipient, transfer and a check, each with a 20 s timeout).
 */
const SEND_LEASE_MS = 10 * 60_000;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const mask = (accountNumber: string) => `******${accountNumber.slice(-4)}`;
/** A bank's name reduced for comparing lists from different providers: "GTBank Plc" and "gtbank" match. */
const bankKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b(plc|limited|ltd|bank|nigeria)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

/**
 * What an agent is told when a withdrawal fails. The provider's own words stay with support; the agent
 * hears only whether their bank details look like the cause, so they don't change a good account for
 * nothing (docs/security-plan.md, R8).
 */
const ACCOUNT_PROBLEM = /\b(account|nuban|beneficiary|recipient|name)\b/i;
const payoutFailure = (reason: string | null) =>
  reason && ACCOUNT_PROBLEM.test(reason)
    ? "The bank couldn't pay into your account. Check your bank account details, or contact support."
    : "The transfer didn't go through. The money is back in your balance: try again later, or contact support.";

export const payoutView = (p: PayoutRow) => ({
  id: p.id,
  speed: p.speed,
  status: p.status,
  amountKobo: p.amountKobo,
  feeKobo: p.feeKobo,
  sendKobo: p.sendKobo,
  failureReason: p.status === 'failed' ? payoutFailure(p.failureReason) : null,
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
    private readonly alerts: AlertsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async listBanks() {
    return this.banksOf(this.providers.current('payments'));
  }

  private async banksOf(payments: PaymentsAdapter) {
    const cached = this.banks.get(payments.name);
    if (cached && Date.now() - cached.at < BANKS_TTL_MS) return cached.list;
    const list = await payments.listBanks();
    this.banks.set(payments.name, { at: Date.now(), list });
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
    // One provider for the whole step, so the account is recorded with the provider that registered it.
    const payments = this.providers.current('payments');
    const bank = (await this.banksOf(payments)).find((b) => b.code === bankCode);
    if (!bank) throw unprocessable('bank_not_supported', 'Choose a bank from the list');

    const legalName = await this.applications.legalName(auth.userId);
    let accountName: string;
    try {
      ({ accountName } = await payments.resolveAccount(
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

    const { recipientCode } = await payments.createRecipient({ name: accountName, bankCode, accountNumber });
    await this.db.transaction(async (tx) => {
      await tx
        .update(payoutAccounts)
        .set({ replacedAt: new Date() })
        .where(and(eq(payoutAccounts.userId, auth.userId), isNull(payoutAccounts.replacedAt)));
      await tx.insert(payoutAccounts).values({
        userId: auth.userId,
        provider: payments.name,
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

  /**
   * A withdrawal from the agent's available balance. `requestKey` is the app's key for this request: a
   * repeat with it returns the same withdrawal, and the key can't be used for another one.
   */
  async request(auth: AuthContext, amountKobo: number, speed: 'instant' | 'scheduled', requestKey: string) {
    // A repeat of a request already made returns that withdrawal, whatever has changed since (a pause,
    // a new minimum): the money already left the balance, and a failure here would invite a second try.
    const earlier = await this.repeatOf(this.db, auth.userId, requestKey, amountKobo, speed);
    if (earlier) return payoutView(earlier);
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
    if (speed === 'instant' && (await this.instantPaused(auth.countryCode))) {
      throw conflict('instant_paused', 'Instant withdrawals are paused for a check. Choose the daily withdrawal.');
    }
    await this.wallet.releaseDue(auth.userId);

    const { payout, repeat } = await this.db.transaction(async (tx) => {
      // One withdrawal request at a time per agent, so the daily limits can't be raced.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'payout:' + auth.userId}))`);
      const same = await this.repeatOf(tx, auth.userId, requestKey, amountKobo, speed);
      if (same) return { payout: same, repeat: true };
      if (speed === 'scheduled') {
        const [queued] = await tx
          .select({ id: payouts.id })
          .from(payouts)
          .where(and(eq(payouts.userId, auth.userId), eq(payouts.speed, 'scheduled'), eq(payouts.status, 'requested')));
        if (queued) throw conflict('scheduled_withdrawal_exists', 'You already have a withdrawal going out today');
      }
      if (tier === 'bronze') {
        const used = await this.todayTotal(tx, timezone, eq(payouts.userId, auth.userId));
        const limit = settings.limits.newAgentDailyWithdrawalKobo;
        if (used + amountKobo > limit) {
          throw unprocessable('daily_limit_reached', 'This is more than you can withdraw today', {
            remainingKobo: Math.max(0, limit - used),
          });
        }
      }

      if (speed === 'instant') {
        const { instantWithdrawalAgentDailyKobo: agentCap, instantWithdrawalPlatformDailyKobo: platformCap } =
          settings.security;
        const mine = await this.todayTotal(tx, timezone, eq(payouts.userId, auth.userId), 'instant');
        if (mine + amountKobo > agentCap) {
          throw unprocessable('instant_limit_reached', 'This is more than you can withdraw instantly today', {
            remainingKobo: Math.max(0, agentCap - mine),
          });
        }
        // Everyone's instant withdrawals in the country, one request at a time.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'payout-instant:' + auth.countryCode}))`);
        const everyone = await this.todayTotal(tx, timezone, eq(payouts.countryCode, auth.countryCode), 'instant');
        if (everyone + amountKobo > platformCap) {
          throw unprocessable(
            'instant_unavailable',
            "Instant withdrawals have reached today's limit. Choose the daily withdrawal.",
          );
        }
      }

      const [row] = await tx
        .insert(payouts)
        .values({
          userId: auth.userId,
          countryCode: auth.countryCode,
          payoutAccountId: account.id,
          reference: `jp-${randomUUID()}`,
          requestKey,
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
      return { payout: row!, repeat: false };
    });

    if (repeat) return payoutView(payout);
    this.realtime.toUser(auth.userId, 'agent', 'wallet.updated', { reason: 'payout', payoutId: payout.id });
    if (speed === 'instant') return payoutView((await this.send(payout.id)) ?? payout);
    return payoutView(payout);
  }

  /** The withdrawal made with this request key, if any. The key used for another withdrawal is refused. */
  private async repeatOf(db: Db | Tx, userId: string, requestKey: string, amountKobo: number, speed: string) {
    const [same] = await db
      .select()
      .from(payouts)
      .where(and(eq(payouts.userId, userId), eq(payouts.requestKey, requestKey)));
    if (!same) return null;
    if (same.amountKobo !== amountKobo || same.speed !== speed) {
      throw conflict('request_reused', 'This request was already used for another withdrawal');
    }
    return same;
  }

  /** Withdrawals made today (local time) and still standing, by an agent or in a country; optionally one speed. */
  private async todayTotal(tx: Tx, timezone: string, who: ReturnType<typeof eq>, speed?: 'instant') {
    const startOfDay = sql`(date_trunc('day', now() at time zone ${timezone}) at time zone ${timezone})`;
    const [row] = await tx
      .select({ total: sum(payouts.amountKobo) })
      .from(payouts)
      .where(
        and(
          who,
          speed ? eq(payouts.speed, speed) : undefined,
          gte(payouts.createdAt, startOfDay),
          inArray(payouts.status, ['requested', 'processing', 'succeeded']),
        ),
      );
    return Number(row?.total ?? 0);
  }

  /** A nightly-check shortfall that finance hasn't cleared stops instant withdrawals in the country. */
  async instantPaused(countryCode: string) {
    const [run] = await this.db
      .select({ id: reconciliationRuns.id })
      .from(reconciliationRuns)
      .where(
        and(
          eq(reconciliationRuns.countryCode, countryCode),
          eq(reconciliationRuns.pausesInstant, true),
          isNull(reconciliationRuns.clearedAt),
        ),
      )
      .limit(1);
    return !!run;
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

  /**
   * Hands a requested payout to the provider. It is claimed first, so two runs never send it at once; the
   * reference makes a retry safe, so the bank pays once.
   */
  async send(payoutId: string): Promise<PayoutRow | null> {
    const now = new Date();
    const lease = new Date(now.getTime() + SEND_LEASE_MS);
    const [claimed] = await this.db
      .update(payouts)
      .set({ sendingUntil: lease })
      .where(
        and(
          eq(payouts.id, payoutId),
          eq(payouts.status, 'requested'),
          or(isNull(payouts.sendingUntil), lt(payouts.sendingUntil, now)),
        ),
      )
      .returning();
    if (!claimed) return (await this.db.select().from(payouts).where(eq(payouts.id, payoutId)))[0] ?? null;
    try {
      return await this.sendClaimed(claimed);
    } finally {
      // Only this run's claim is let go: a run that took over after it ran out keeps its own.
      await this.db
        .update(payouts)
        .set({ sendingUntil: null })
        .where(and(eq(payouts.id, payoutId), eq(payouts.sendingUntil, lease)));
    }
  }

  private async sendClaimed(payout: PayoutRow): Promise<PayoutRow | null> {
    // A suspended agent's withdrawals wait: they go out if support reactivates them.
    const [owner] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, payout.userId));
    if (owner?.status !== 'active') {
      this.logger.warn(`Payout ${payout.id} waits: its agent is suspended`);
      return payout;
    }
    if (payout.speed === 'instant' && (await this.instantPaused(payout.countryCode))) return payout;
    // A payout tried before keeps the provider it was first sent to: asking another about it means nothing.
    const via = payout.provider
      ? this.providers.named('payments', payout.provider)
      : this.providers.current('payments');
    // Its provider can't be reached from here now (keys removed or unreadable). It may already have taken
    // the transfer, so nothing is refunded: the payout waits, and is tried again once it is set up.
    if (!via) {
      this.logger.warn(`Payout ${payout.id} waits: ${payout.provider} is not set up`);
      return payout;
    }
    let account: typeof payoutAccounts.$inferSelect;
    try {
      account = await this.recipientWith(via, payout.payoutAccountId);
    } catch (error) {
      // Refused before it was ever handed over: nothing can have been paid, so the money goes back.
      const refused = error instanceof PaymentsProviderError && error.status >= 400 && error.status < 500;
      if (refused && payout.attempts === 0) return this.fail(payout.id, (error as Error).message);
      // Refused after an earlier try was handed over: that try may have been paid, so a person decides.
      if (refused) await this.unclear(payout, via.name, (error as Error).message);
      this.logger.warn(`Payout ${payout.id} not sent yet: ${(error as Error).message}`);
      return payout;
    }
    if (!payout.provider) {
      await this.db.update(payouts).set({ provider: via.name }).where(eq(payouts.id, payout.id));
    }
    const [counted] = await this.db
      .update(payouts)
      .set({ attempts: sql`${payouts.attempts} + 1` })
      .where(eq(payouts.id, payout.id))
      .returning({ attempts: payouts.attempts });
    const attempt = counted?.attempts ?? 1;

    let result: Awaited<ReturnType<PaymentsAdapter['transfer']>>;
    try {
      result = await via.transfer({
        reference: payout.reference,
        amountKobo: payout.sendKobo,
        recipientCode: account.recipientCode,
        bankCode: account.bankCode,
        accountNumber: account.accountNumber,
        reason: 'Jiffo earnings',
      });
    } catch (error) {
      // The provider may have taken the transfer and only the answer was lost. A retry would then be
      // refused as a duplicate reference, so ask about this reference before giving up.
      const known = await via.verifyTransfer(payout.reference).catch(() => null);
      const refused = error instanceof PaymentsProviderError && error.status >= 400 && error.status < 500;
      // Refused outright on the first try, and unknown to the provider: it never took it, so the money goes
      // back. After an earlier try, a refusal may only mean that try's transfer exists: never given back.
      if (!known && refused && attempt === 1) return this.fail(payout.id, (error as Error).message);
      if (!known) {
        if (refused) await this.unclear(payout, via.name, (error as Error).message);
        // Left as requested: it is tried again with the same reference, so the bank pays once.
        this.logger.warn(`Payout ${payout.id} not sent yet: ${(error as Error).message}`);
        return payout;
      }
      result = { status: known.status, transferCode: null, reason: known.reason, feeKobo: known.feeKobo };
    }
    if (result.reason === 'otp') await this.otpAsked(payout, via.name);
    const [sent] = await this.db
      .update(payouts)
      .set({ status: 'processing', sentAt: new Date(), providerTransferCode: result.transferCode })
      .where(and(eq(payouts.id, payout.id), eq(payouts.status, 'requested')))
      .returning();
    if (result.status === 'success') return this.succeed(payout.id, result.feeKobo ?? 0);
    if (result.status === 'failed') return this.fail(payout.id, result.reason ?? 'failed');
    return sent ?? payout;
  }

  /** A withdrawal that may or may not have been paid: a person checks at the provider before anything moves. */
  private async unclear(payout: PayoutRow, provider: string, reason: string) {
    await this.alerts.raise({
      countryCode: payout.countryCode,
      kind: 'payout_unclear',
      dedupeKey: payout.id,
      message: `Withdrawal ${payout.reference} was refused on a retry and ${provider} doesn't show it yet. Check it at the provider before anything is given back.`,
      data: { payoutId: payout.id, reference: payout.reference, reason },
    });
  }

  /**
   * Transfer OTP is on at the provider: the transfer waits for a code. It isn't given back, as it can still
   * be finalised by hand; a person finishes it in the dashboard or turns OTP off.
   */
  private async otpAsked(payout: PayoutRow, provider: string) {
    await this.alerts.raise({
      countryCode: payout.countryCode,
      kind: 'transfer_otp_on',
      dedupeKey: payout.id,
      message: `${provider} is holding withdrawal ${payout.reference} for an OTP. Finalise it in the dashboard, and turn transfer OTP off so withdrawals go out.`,
      data: { payoutId: payout.id, reference: payout.reference },
    });
  }

  /**
   * The provider asks, before it moves money, whether a transfer is one of ours (Paystack's transfer
   * approval URL). Approved only for a withdrawal being sent or in progress, for its exact amount and the
   * agent's checked recipient, while the agent is active. Database reads only: it must answer fast.
   */
  async approve(provider: string, ask: TransferApprovalRequest) {
    const [row] = await this.db
      .select({ payout: payouts, recipientCode: payoutAccounts.recipientCode, owner: users.status })
      .from(payouts)
      .innerJoin(payoutAccounts, eq(payoutAccounts.id, payouts.payoutAccountId))
      .innerJoin(users, eq(users.id, payouts.userId))
      .where(eq(payouts.reference, ask.reference));
    const reason = await this.approvalProblem(provider, ask, row);
    if (!reason) return { approved: true as const };
    await this.alerts.raise({
      countryCode: row?.payout.countryCode ?? this.config.DEFAULT_COUNTRY,
      kind: 'payout_rejected',
      dedupeKey: ask.reference,
      message: `${provider} asked to approve transfer ${ask.reference}, and it was refused: ${reason}.`,
      data: { ...ask, reason },
    });
    return { approved: false as const, reason };
  }

  private async approvalProblem(
    provider: string,
    ask: TransferApprovalRequest,
    row: { payout: PayoutRow; recipientCode: string; owner: string } | undefined,
  ) {
    if (!row) return 'no such withdrawal';
    const { payout } = row;
    if (payout.provider !== provider) return `it goes through ${payout.provider ?? 'no provider'}`;
    const sending = payout.status === 'requested' && !!payout.sendingUntil && payout.sendingUntil > new Date();
    if (payout.status !== 'processing' && !sending) {
      return payout.status === 'requested' ? 'it is not being sent' : `it is ${payout.status}`;
    }
    // The reference and amount identify the withdrawal; a recipient, when the request names one, must match.
    if (!Number.isSafeInteger(ask.amountKobo)) return 'the request names no amount';
    if (payout.sendKobo !== ask.amountKobo) return `the amount is ${ask.amountKobo}, not ${payout.sendKobo}`;
    if (ask.recipientCode && ask.recipientCode !== row.recipientCode) return "the recipient isn't the agent's account";
    if (row.owner !== 'active') return 'the agent is suspended';
    if (payout.speed === 'instant' && (await this.instantPaused(payout.countryCode))) {
      return 'instant withdrawals are paused';
    }
    return null;
  }

  /**
   * The agent's payout account as a recipient with this provider. An account added while another provider
   * was in use is registered with this one first, from the bank details already checked.
   */
  private async recipientWith(via: PaymentsAdapter, accountId: string) {
    const [account] = await this.db.select().from(payoutAccounts).where(eq(payoutAccounts.id, accountId));
    if (!account) throw new Error(`Payout account ${accountId} not found`);
    if (account.provider === via.name) return account;
    // Each provider has its own bank codes: the bank is found on this one's list by name, then by code.
    const banks = await this.banksOf(via);
    const bank =
      banks.find((b) => bankKey(b.name) === bankKey(account.bankName)) ??
      banks.find((b) => b.code === account.bankCode);
    if (!bank) {
      throw new PaymentsProviderError(
        422,
        `${account.bankName} isn't on the list of the payments provider now in use. Add your bank account again.`,
      );
    }
    const { recipientCode } = await via.createRecipient({
      name: account.accountName,
      bankCode: bank.code,
      accountNumber: account.accountNumber,
    });
    const [moved] = await this.db
      .update(payoutAccounts)
      .set({ provider: via.name, recipientCode, bankCode: bank.code })
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
    const { status, reason, feeKobo } = await via.verifyTransfer(reference, payout.providerTransferCode);
    if (reason === 'otp') await this.otpAsked(payout, via.name);
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
        body: `${formatNaira(done.amountKobo)} is back in your balance. ${
          ACCOUNT_PROBLEM.test(reason) ? 'Check your bank details and try again.' : 'Try again later.'
        }`,
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
