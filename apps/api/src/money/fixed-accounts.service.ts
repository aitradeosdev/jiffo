import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gt, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { customerVerifications, fixedAccounts, users } from '../db/schema';
import { fixedOwnerRef, ownerOfFixedRef, type FixedAccountState, type PaymentsAdapter } from '../adapters/payments';
import type { AuthContext } from '../auth/auth.types';
import { conflict, tooMany, unavailable, unprocessable } from '../common/errors';
import { matchesLegalName } from '../common/names';
import { CountriesService } from '../countries/countries.service';
import { CustomerIdentityService } from '../identity/customer-identity.service';
import { ProvidersService } from '../providers/providers.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { LedgerService } from './ledger.service';

type FixedAccountRow = typeof fixedAccounts.$inferSelect;

/** A pending account is asked about again when it is opened, at most this often. */
const REFRESH_AFTER_MS = 15_000;
/** How long one request may hold an account while it asks the provider. */
const CHECK_LEASE_MS = 60_000;
/** A pending account with no reference from the provider (its answer was lost) can be asked for again after this. */
const LOST_AFTER_MS = 2 * 60_000;
/** An attempt the provider hasn't settled in this long is no longer asked about, and can be made again. */
const PENDING_DAYS = 7;
const DAY_MS = 86_400_000;

export interface IssueInput {
  bvn?: string;
  bankCode?: string;
  accountNumber?: string;
}

/** Refused tries count towards the day's limit (Settings, Security) for this long. */
const FAILURE_WINDOW_MS = 24 * 3_600_000;
const UNREACHABLE = "We couldn't reach the bank. Try again.";
/** What the customer is told when the provider refuses; its own words stay with support. */
const REFUSED = "We couldn't issue an account number with those details. Check them and try again, or contact support.";

export const fixedAccountView = (a: FixedAccountRow) => ({
  id: a.id,
  status: a.status,
  accountNumber: a.accountNumber,
  accountName: a.accountName,
  bankName: a.bankName,
  /** Why it couldn't be issued, in general terms: the provider's own words stay with support. */
  failureReason: a.status !== 'failed' ? null : a.failureReason === UNREACHABLE ? UNREACHABLE : REFUSED,
  activatedAt: a.activatedAt,
});

const supports = (p: PaymentsAdapter) => !!p.issueFixedAccount && !!p.fixedAccountState;

/**
 * A customer's own account number at the payments provider: issued once, and any transfer into it lands in
 * their wallet (see DepositsService.recordFixedPayment). What issuing one costs is booked to provider_fees
 * when it becomes active, so the money pages count it against revenue.
 */
@Injectable()
export class FixedAccountsService {
  private readonly logger = new Logger(FixedAccountsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly providers: ProvidersService,
    private readonly countries: CountriesService,
    private readonly customerIdentity: CustomerIdentityService,
    private readonly ledger: LedgerService,
    private readonly push: PushService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /**
   * The ways to add money on offer in a country now. There is always one: with own account numbers off, or
   * not issued by the provider in use, one-time account numbers are offered whatever the setting says.
   */
  async offer(countryCode: string) {
    const { settings } = await this.countries.currentSettings(countryCode);
    const payments = this.providers.current('payments');
    const fixed = settings.topUps.fixedAccount && supports(payments);
    return { settings, payments, fixed, oneTime: settings.topUps.oneTimeAccount || !fixed };
  }

  /** The ways to add money on offer, and the customer's own account number when they have one. */
  async view(auth: AuthContext) {
    const { payments, fixed, oneTime } = await this.offer(auth.countryCode);
    let account = await this.shown(auth.userId, payments.name, fixed);
    if (
      account?.status === 'pending' &&
      account.providerRef &&
      Date.now() - account.updatedAt.getTime() > REFRESH_AFTER_MS
    ) {
      const current = account;
      account =
        (await this.refresh(current, payments, false).catch((error: Error) => {
          this.logger.warn(`Could not check fixed account ${current.id}: ${error.message}`);
          return null;
        })) ?? current;
    }
    return {
      oneTimeAccount: oneTime,
      fixedAccount: {
        available: fixed,
        /** What the customer gives for one: their BVN, and with some providers a bank account in their name. */
        needs: payments.fixedAccountNeeds ?? 'nothing',
        account: account ? fixedAccountView(account) : null,
      },
    };
  }

  async issue(auth: AuthContext, input: IssueInput) {
    await this.customerIdentity.assertVerified(auth.userId);
    // One provider for the whole step, as with one-time top-ups.
    const { settings, payments } = await this.offer(auth.countryCode);
    if (!settings.topUps.fixedAccount) {
      throw conflict('fixed_accounts_off', 'Own account numbers are not on offer right now');
    }
    if (!payments.issueFixedAccount || !payments.fixedAccountState) {
      throw conflict('fixed_accounts_unsupported', 'Own account numbers are not on offer right now');
    }
    // One that works already, even at a provider admin has switched from, is the customer's account.
    const working = await this.working(auth.userId, payments.name);
    if (working) return fixedAccountView(working);
    const mine = await this.rowFor(auth.userId, payments.name);
    if (mine?.status === 'pending' && mine.providerRef && !this.stale(mine)) {
      return fixedAccountView(await this.refresh(mine, payments, false));
    }

    const needs = payments.fixedAccountNeeds ?? 'nothing';
    if (needs !== 'nothing' && !input.bvn) throw unprocessable('bvn_required', 'Enter your BVN');
    if (needs === 'bvn_and_bank' && (!input.bankCode || !input.accountNumber)) {
      throw unprocessable('bank_account_required', 'Choose your bank and enter your account number');
    }
    if (
      mine &&
      mine.failures >= settings.security.ownAccountTriesPerDay &&
      mine.lastFailureAt &&
      Date.now() - mine.lastFailureAt.getTime() < FAILURE_WINDOW_MS
    ) {
      throw tooMany('too_many_tries', 'Too many tries today. Try again tomorrow, or contact support.');
    }
    const [user] = await this.db
      .select({
        firstName: users.firstName,
        lastName: users.lastName,
        phone: users.phone,
        legalName: customerVerifications.legalName,
      })
      .from(users)
      .leftJoin(customerVerifications, eq(customerVerifications.userId, users.id))
      .where(eq(users.id, auth.userId));
    const firstName = user?.firstName;
    const lastName = user?.lastName;
    if (!user || !firstName || !lastName) {
      throw unprocessable('name_required', 'Add your first and last name to your profile first');
    }
    // The provider checks the BVN against the name sent: it must be the name on the verified ID, so an
    // invented one can't be tested. The profile's order is kept, as ID records vary in theirs.
    if (user.legalName && !matchesLegalName(`${firstName} ${lastName}`, user.legalName)) {
      throw unprocessable('name_not_on_id', 'Your name in the app must match the name on your ID. Update it first.');
    }

    // Claimed first, so two taps never ask twice. A new row, one that failed, or one the provider lost or
    // never settled becomes a new attempt, with its own reference, so a provider never sees one twice.
    const ownerRef = fixedOwnerRef(auth.userId);
    const now = new Date();
    const lease = new Date(now.getTime() + CHECK_LEASE_MS);
    const attempt = { ownerRef, status: 'pending' as const, requestedAt: now, checkingUntil: lease, updatedAt: now };
    const [claimed] = await this.db
      .insert(fixedAccounts)
      .values({ userId: auth.userId, countryCode: auth.countryCode, provider: payments.name, ...attempt })
      .onConflictDoUpdate({
        target: [fixedAccounts.userId, fixedAccounts.provider],
        set: { ...attempt, providerRef: null, failureReason: null },
        setWhere: or(
          eq(fixedAccounts.status, 'failed'),
          and(
            eq(fixedAccounts.status, 'pending'),
            or(isNull(fixedAccounts.checkingUntil), lt(fixedAccounts.checkingUntil, now)),
            or(
              and(
                isNull(fixedAccounts.providerRef),
                lt(fixedAccounts.updatedAt, new Date(now.getTime() - LOST_AFTER_MS)),
              ),
              lt(fixedAccounts.requestedAt, new Date(now.getTime() - PENDING_DAYS * DAY_MS)),
            ),
          ),
        ),
      })
      .returning();
    if (!claimed) return fixedAccountView((await this.rowFor(auth.userId, payments.name))!);

    let state: FixedAccountState;
    try {
      state = await payments.issueFixedAccount({
        ownerRef,
        email: `${auth.userId}@${this.config.PAYMENT_EMAIL_DOMAIN}`,
        firstName,
        lastName,
        phone: user.phone,
        bvn: input.bvn,
        bankCode: needs === 'bvn_and_bank' ? input.bankCode : undefined,
        accountNumber: needs === 'bvn_and_bank' ? input.accountNumber : undefined,
      });
    } catch (error) {
      // The provider may have issued it all the same. Trying again is a new attempt with a new reference,
      // and a transfer into an account from this one is still credited to the customer (findForPayment).
      this.logger.warn(`Issuing a fixed account at ${payments.name} failed: ${(error as Error).message}`);
      await this.db
        .update(fixedAccounts)
        .set({
          status: 'failed',
          failureReason: UNREACHABLE,
          checkingUntil: null,
          // Counted too: a provider error must not become a way round the day's tries.
          failures: sql`case when ${fixedAccounts.lastFailureAt} > now() - interval '1 day' then ${fixedAccounts.failures} + 1 else 1 end`,
          lastFailureAt: new Date(),
        })
        .where(eq(fixedAccounts.id, claimed.id));
      throw unavailable('provider_unavailable', "We couldn't reach the bank. Try again in a moment.");
    }
    return fixedAccountView(await this.apply(claimed, state, payments, false));
  }

  /**
   * A provider told us an account changed (identification passed or failed, account assigned). Throws while
   * another request is asking about it, so the provider delivers the event again.
   */
  async refreshByProviderRef(provider: string, providerRef: string) {
    const [row] = await this.db
      .select()
      .from(fixedAccounts)
      .where(and(eq(fixedAccounts.provider, provider), eq(fixedAccounts.providerRef, providerRef)));
    if (!row) {
      this.logger.warn(`Account event for unknown fixed account ${provider}:${providerRef}`);
      return null;
    }
    const payments = this.providers.named('payments', provider);
    if (!payments) throw new Error(`Fixed account ${row.id} is with ${provider}, which is no longer set up`);
    const after = await this.refresh(row, payments, true);
    if (after.status === 'pending' && after.checkingUntil && after.checkingUntil > new Date()) {
      throw new Error(`Fixed account ${row.id} is being checked; deliver again later`);
    }
    return after;
  }

  /** For reconciliation: accounts still being issued are asked about, in case a webhook was missed. */
  async refreshPending() {
    const now = Date.now();
    const rows = await this.db
      .select()
      .from(fixedAccounts)
      .where(
        and(
          eq(fixedAccounts.status, 'pending'),
          isNotNull(fixedAccounts.providerRef),
          lt(fixedAccounts.updatedAt, new Date(now - REFRESH_AFTER_MS)),
          gt(fixedAccounts.requestedAt, new Date(now - PENDING_DAYS * DAY_MS)),
        ),
      )
      .limit(500);
    for (const row of rows) {
      const payments = this.providers.named('payments', row.provider);
      if (!payments) continue;
      await this.refresh(row, payments, true).catch((error: Error) =>
        this.logger.warn(`Could not check fixed account ${row.id}: ${error.message}`),
      );
    }
  }

  /**
   * Whose account a transfer went to: by the provider's reference for the account, or by ours, which names
   * the customer, so a transfer into an account from an earlier attempt is still theirs.
   */
  async findForPayment(provider: string, refs: { providerRef?: string; ownerRef?: string }) {
    if (refs.providerRef) {
      const [row] = await this.db
        .select()
        .from(fixedAccounts)
        .where(and(eq(fixedAccounts.provider, provider), eq(fixedAccounts.providerRef, refs.providerRef)));
      if (row) return row;
    }
    const userId = ownerOfFixedRef(refs.ownerRef);
    return userId ? this.rowFor(userId, provider) : null;
  }

  private async rowFor(userId: string, provider: string) {
    const [row] = await this.db
      .select()
      .from(fixedAccounts)
      .where(and(eq(fixedAccounts.userId, userId), eq(fixedAccounts.provider, provider)));
    return row ?? null;
  }

  /** The customer's active account at a provider that is still set up, the one in use first. */
  private async working(userId: string, current: string) {
    const active = await this.db
      .select()
      .from(fixedAccounts)
      .where(and(eq(fixedAccounts.userId, userId), eq(fixedAccounts.status, 'active')))
      .orderBy(sql`${fixedAccounts.provider} = ${current} desc`, desc(fixedAccounts.activatedAt));
    return active.find((a) => this.providers.named('payments', a.provider)) ?? null;
  }

  /**
   * The account the app shows: one that takes transfers, which keeps working when admin stops offering new
   * ones or switches provider; else, while they are on offer, where the customer's request has got to.
   */
  private async shown(userId: string, current: string, offered: boolean) {
    return (await this.working(userId, current)) ?? (offered ? await this.rowFor(userId, current) : null);
  }

  private stale(row: FixedAccountRow) {
    return row.requestedAt.getTime() < Date.now() - PENDING_DAYS * DAY_MS;
  }

  /** Asks the provider about a pending account, unless another request is doing so now. */
  private async refresh(row: FixedAccountRow, payments: PaymentsAdapter, notify: boolean) {
    if (row.status !== 'pending' || !row.providerRef || !payments.fixedAccountState) return row;
    const now = new Date();
    const [held] = await this.db
      .update(fixedAccounts)
      .set({ checkingUntil: new Date(now.getTime() + CHECK_LEASE_MS), updatedAt: now })
      .where(
        and(
          eq(fixedAccounts.id, row.id),
          eq(fixedAccounts.status, 'pending'),
          or(isNull(fixedAccounts.checkingUntil), lt(fixedAccounts.checkingUntil, now)),
        ),
      )
      .returning();
    if (!held) return (await this.rowFor(row.userId, row.provider)) ?? row;
    let state: FixedAccountState;
    try {
      state = await payments.fixedAccountState(row.providerRef);
    } catch (error) {
      await this.db.update(fixedAccounts).set({ checkingUntil: null }).where(eq(fixedAccounts.id, row.id));
      throw error;
    }
    return this.apply(held, state, payments, notify);
  }

  /** Records where issuing has got to, and lets go of the account. The first time it is active, its cost is booked. */
  private async apply(row: FixedAccountRow, state: FixedAccountState, payments: PaymentsAdapter, notify: boolean) {
    const now = new Date();
    if (state.status !== 'active') {
      const [after] = await this.db
        .update(fixedAccounts)
        .set({
          status: state.status,
          providerRef: state.providerRef ?? row.providerRef,
          failureReason: state.status === 'failed' ? state.reason : null,
          // A refusal counts towards the day's tries; one more than a day after the last starts again at 1.
          ...(state.status === 'failed'
            ? {
                failures: sql`case when ${fixedAccounts.lastFailureAt} > now() - interval '1 day' then ${fixedAccounts.failures} + 1 else 1 end`,
                lastFailureAt: now,
              }
            : {}),
          checkingUntil: null,
          updatedAt: now,
        })
        // An account already active stays so, whatever a late answer says.
        .where(and(eq(fixedAccounts.id, row.id), eq(fixedAccounts.status, 'pending')))
        .returning();
      return after ?? (await this.rowFor(row.userId, row.provider))!;
    }

    const { currency } = await this.countries.basics(row.countryCode);
    const fee = payments.fixedAccountFeeKobo ?? 0;
    const activated = await this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(fixedAccounts).where(eq(fixedAccounts.id, row.id)).for('update');
      if (!locked) return null;
      const first = !locked.activatedAt;
      const [after] = await tx
        .update(fixedAccounts)
        .set({
          status: 'active',
          providerRef: state.providerRef,
          accountNumber: state.accountNumber,
          accountName: state.accountName,
          bankName: state.bankName,
          failureReason: null,
          failures: 0,
          checkingUntil: null,
          ...(first ? { activatedAt: now, issueFeeKobo: fee } : {}),
          updatedAt: now,
        })
        .where(eq(fixedAccounts.id, row.id))
        .returning();
      if (first) {
        // The fee set on the provider, taken from the balance it holds for Jiffo.
        await this.ledger.post(tx, {
          key: `fixed_account:${row.id}`,
          kind: 'fixed_account',
          countryCode: row.countryCode,
          currency,
          data: { provider: row.provider, fixedAccountId: row.id },
          movements: [{ debit: { type: 'provider_fees' }, credit: { type: 'provider_cash' }, amountKobo: fee }],
        });
      }
      return { row: after!, first };
    });
    if (!activated) return row;
    if (activated.first && notify) {
      this.realtime.toUser(row.userId, 'customer', 'wallet.updated', { reason: 'fixed_account' });
      await this.push.notifyUser(row.userId, 'customer', {
        title: 'Your account number is ready',
        body: `Transfer to ${state.accountNumber} (${state.bankName}) any time to add money.`,
        data: { type: 'wallet.fixed_account' },
      });
    }
    return activated.row;
  }
}
