import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, desc, eq, gt, lt } from 'drizzle-orm';
import { formatNaira } from '@jiffo/shared';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { deposits, users } from '../db/schema';
import { FakePaymentsAdapter, PAYMENTS, type PaymentsAdapter } from '../adapters/payments';
import { CountriesService } from '../countries/countries.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { AuthContext } from '../auth/auth.types';
import { notFound, tooMany, unprocessable } from '../common/errors';
import { nameWords, plainName } from '../common/names';
import { ENV_ADAPTERS, type Adapters } from '../providers/env-adapters';
import { ProvidersService } from '../providers/providers.service';
import { CustomerIdentityService } from '../identity/customer-identity.service';
import { LedgerService } from './ledger.service';

const MINUTE_MS = 60_000;
/** Open one-time account numbers a customer can have at once. */
const MAX_OPEN_DEPOSITS = 3;
/** Expired top-ups are checked again for this long, in case a transfer lands late. */
/** How long an unpaid top-up keeps being asked about after its account number expires. */
export const DEPOSIT_RECHECK_DAYS = 7;
type DepositRow = typeof deposits.$inferSelect;

export const depositView = (d: DepositRow) => ({
  id: d.id,
  status: d.status,
  /** The account number has closed. A transfer that still arrives is credited all the same. */
  expired: d.status === 'pending' && d.expiresAt.getTime() < Date.now(),
  amountKobo: d.amountKobo,
  paidKobo: d.paidKobo,
  accountNumber: d.accountNumber,
  accountName: d.accountName,
  bankName: d.bankName,
  expiresAt: d.expiresAt,
  createdAt: d.createdAt,
  completedAt: d.completedAt,
});

/** Loose match of the sender's bank name against the customer's profile name. */
function senderMatches(sender: string, firstName: string | null, lastName: string | null) {
  const words = nameWords(sender);
  const names = [firstName, lastName].filter((n): n is string => !!n).map(plainName);
  return names.length > 0 && names.some((n) => words.has(n));
}

/** Top-ups by bank transfer to a one-time account number. The wallet is credited only after the provider confirms. */
@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENTS) private readonly payments: PaymentsAdapter,
    private readonly ledger: LedgerService,
    private readonly countries: CountriesService,
    private readonly push: PushService,
    private readonly realtime: RealtimeGateway,
    @Inject(ENV_ADAPTERS) env: Adapters,
    private readonly providers: ProvidersService,
    private readonly customerIdentity: CustomerIdentityService,
  ) {
    // The fake bank of development settles top-ups by itself; it then tells this service, as a webhook would.
    if (env.payments instanceof FakePaymentsAdapter) {
      env.payments.onAutoPaid = (reference) => {
        this.sync(reference).catch((error: Error) =>
          this.logger.warn(`Auto-pay of ${reference} failed: ${error.message}`),
        );
      };
    }
  }

  async create(auth: AuthContext, amountKobo: number) {
    // Money comes in only from verified customers.
    await this.customerIdentity.assertVerified(auth.userId);
    const { settings } = await this.countries.currentSettings(auth.countryCode);
    const { minDepositKobo, maxDepositKobo } = settings.limits;
    if (amountKobo < minDepositKobo || (maxDepositKobo !== null && amountKobo > maxDepositKobo)) {
      throw unprocessable('deposit_amount_out_of_range', 'Choose a different amount', {
        minDepositKobo,
        maxDepositKobo,
      });
    }
    const [open] = await this.db
      .select({ n: count() })
      .from(deposits)
      .where(and(eq(deposits.userId, auth.userId), eq(deposits.status, 'pending'), gt(deposits.expiresAt, new Date())));
    if ((open?.n ?? 0) >= MAX_OPEN_DEPOSITS) {
      throw tooMany('too_many_open_deposits', 'Finish or wait out your open top-ups first');
    }
    const reference = `jd-${randomUUID()}`;
    const expiresAt = new Date(Date.now() + settings.timers.depositAccountMinutes * MINUTE_MS);
    // One provider for the whole step: a switch in between must not record another than the one used.
    const payments = this.providers.current('payments');
    const account = await payments.createTransferDeposit({
      reference,
      amountKobo,
      email: `${auth.userId}@${this.config.PAYMENT_EMAIL_DOMAIN}`,
      expiresAt,
    });
    const [row] = await this.db
      .insert(deposits)
      .values({
        userId: auth.userId,
        countryCode: auth.countryCode,
        provider: payments.name,
        reference,
        amountKobo,
        accountNumber: account.accountNumber,
        accountName: account.accountName,
        bankName: account.bankName,
        expiresAt: account.expiresAt,
      })
      .returning();
    return depositView(row!);
  }

  async list(auth: AuthContext, limit: number) {
    const rows = await this.db
      .select()
      .from(deposits)
      .where(eq(deposits.userId, auth.userId))
      .orderBy(desc(deposits.createdAt))
      .limit(limit);
    return rows.map(depositView);
  }

  /** Reading a pending deposit also asks the provider, so a missed webhook never strands a top-up. */
  async get(auth: AuthContext, id: string) {
    const [row] = await this.db
      .select()
      .from(deposits)
      .where(and(eq(deposits.id, id), eq(deposits.userId, auth.userId)));
    if (!row) throw notFound('deposit_not_found', 'Top-up not found');
    if (row.status !== 'pending') return depositView(row);
    try {
      return depositView((await this.sync(row.reference)) ?? row);
    } catch (error) {
      // The provider can't be reached: show what we have, so the customer still sees where to pay.
      this.logger.warn(`Could not check deposit ${row.reference}: ${(error as Error).message}`);
      return depositView(row);
    }
  }

  /** Checks a deposit with the provider and credits the wallet once if the money arrived. */
  async sync(reference: string): Promise<DepositRow | null> {
    const [deposit] = await this.db.select().from(deposits).where(eq(deposits.reference, reference));
    if (!deposit) {
      this.logger.warn(`Payment for unknown deposit reference ${reference}`);
      return null;
    }
    if (deposit.status !== 'pending') return deposit;

    // Asked of the provider that issued the account number, even if admin has switched since.
    const issuer = this.providers.named('payments', deposit.provider);
    if (!issuer) throw new Error(`Deposit ${reference} is with ${deposit.provider}, which is no longer set up`);
    const status = await issuer.verifyDeposit(reference);
    const { currency } = await this.countries.basics(deposit.countryCode);
    // Not paid yet, or the provider calls the charge abandoned or failed. It stays pending, never failed:
    // a transfer that lands later must still be credited.
    if (status.status !== 'success') return deposit;
    if (status.currency !== currency)
      throw new Error(`Deposit ${reference} arrived in ${status.currency}, expected ${currency}`);

    const [customer] = await this.db
      .select({ firstName: users.firstName, lastName: users.lastName })
      .from(users)
      .where(eq(users.id, deposit.userId));
    const mismatch =
      !!status.senderName && !senderMatches(status.senderName, customer?.firstName ?? null, customer?.lastName ?? null);

    const credited = await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(deposits).where(eq(deposits.id, deposit.id)).for('update');
      if (!locked || locked.status !== 'pending') return null;
      await this.ledger.post(tx, {
        key: `deposit:${deposit.id}`,
        kind: 'deposit',
        countryCode: deposit.countryCode,
        currency,
        data: { reference, provider: deposit.provider },
        movements: [
          {
            debit: { type: 'provider_cash' },
            credit: { type: 'customer_wallet', ownerId: deposit.userId },
            amountKobo: status.amountKobo,
          },
          { debit: { type: 'provider_fees' }, credit: { type: 'provider_cash' }, amountKobo: status.feesKobo },
        ],
      });
      const [row] = await tx
        .update(deposits)
        .set({
          status: 'succeeded',
          paidKobo: status.amountKobo,
          feesKobo: status.feesKobo,
          senderName: status.senderName,
          senderBank: status.senderBank,
          senderMismatch: mismatch,
          completedAt: new Date(),
        })
        .where(eq(deposits.id, deposit.id))
        .returning();
      return row!;
    });
    if (!credited) return (await this.db.select().from(deposits).where(eq(deposits.id, deposit.id)))[0] ?? null;

    this.realtime.toUser(deposit.userId, 'customer', 'wallet.updated', { reason: 'deposit', depositId: deposit.id });
    await this.push.notifyUser(deposit.userId, 'customer', {
      title: 'Top-up received',
      body: `${formatNaira(status.amountKobo)} is in your Jiffo wallet.`,
      data: { type: 'wallet.deposit', depositId: deposit.id },
    });
    return credited;
  }

  /** For reconciliation: pending deposits whose account number has expired are checked again. */
  async syncExpired() {
    const stale = await this.db
      .select({ reference: deposits.reference })
      .from(deposits)
      .where(
        and(
          eq(deposits.status, 'pending'),
          lt(deposits.expiresAt, new Date()),
          gt(deposits.expiresAt, new Date(Date.now() - DEPOSIT_RECHECK_DAYS * 86_400_000)),
        ),
      )
      .limit(500);
    let stillPending = 0;
    for (const d of stale) {
      try {
        // Never marked failed here: a late transfer must still be credited when it lands.
        if ((await this.sync(d.reference))?.status === 'pending') stillPending += 1;
      } catch (error) {
        this.logger.warn(`Could not check deposit ${d.reference}: ${(error as Error).message}`);
      }
    }
    return stillPending;
  }
}
