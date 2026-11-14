import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, gt, lt } from 'drizzle-orm';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { fixedAccounts, users } from '../db/schema';
import type { FixedAccountState, PaymentsAdapter } from '../adapters/payments';
import type { AuthContext } from '../auth/auth.types';
import { conflict, unavailable, unprocessable } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { CustomerIdentityService } from '../identity/customer-identity.service';
import { ProvidersService } from '../providers/providers.service';
import { PushService } from '../push/push.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { LedgerService } from './ledger.service';

type FixedAccountRow = typeof fixedAccounts.$inferSelect;

/** A pending account is asked about again when it is opened, at most this often. */
const REFRESH_AFTER_MS = 15_000;
/** Pending accounts are asked about by reconciliation for this long, then left to the customer to retry. */
const PENDING_RECHECK_DAYS = 7;

export interface IssueInput {
  bvn?: string;
  bankCode?: string;
  accountNumber?: string;
}

export const fixedAccountView = (a: FixedAccountRow) => ({
  id: a.id,
  status: a.status,
  accountNumber: a.accountNumber,
  accountName: a.accountName,
  bankName: a.bankName,
  /** Why the provider couldn't issue it, in its words. */
  failureReason: a.status === 'failed' ? a.failureReason : null,
  activatedAt: a.activatedAt,
});

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

  /** The ways to add money on offer, and the customer's own account number when they have one. */
  async view(auth: AuthContext) {
    const { settings } = await this.countries.currentSettings(auth.countryCode);
    const payments = this.providers.current('payments');
    const supported = !!payments.issueFixedAccount && !!payments.fixedAccountState;
    const available = settings.topUps.fixedAccount && supported;
    let account = available ? await this.rowFor(auth.userId, payments.name) : null;
    if (
      account?.status === 'pending' &&
      account.providerRef &&
      Date.now() - account.updatedAt.getTime() > REFRESH_AFTER_MS
    ) {
      account =
        (await this.refresh(account, payments, false).catch((error: Error) => {
          this.logger.warn(`Could not check fixed account ${account!.id}: ${error.message}`);
          return null;
        })) ?? account;
    }
    return {
      oneTimeAccount: settings.topUps.oneTimeAccount,
      fixedAccount: {
        available,
        /** What the customer gives for one: their BVN, and with some providers a bank account in their name. */
        needs: payments.fixedAccountNeeds ?? 'nothing',
        account: account ? fixedAccountView(account) : null,
      },
    };
  }

  async issue(auth: AuthContext, input: IssueInput) {
    await this.customerIdentity.assertVerified(auth.userId);
    const { settings } = await this.countries.currentSettings(auth.countryCode);
    if (!settings.topUps.fixedAccount) {
      throw conflict('fixed_accounts_off', 'Own account numbers are not on offer right now');
    }
    // One provider for the whole step, as with one-time top-ups.
    const payments = this.providers.current('payments');
    if (!payments.issueFixedAccount || !payments.fixedAccountState) {
      throw conflict('fixed_accounts_unsupported', 'Own account numbers are not on offer right now');
    }
    const needs = payments.fixedAccountNeeds ?? 'nothing';
    if (needs !== 'nothing' && !input.bvn) throw unprocessable('bvn_required', 'Enter your BVN');
    if (needs === 'bvn_and_bank' && (!input.bankCode || !input.accountNumber)) {
      throw unprocessable('bank_account_required', 'Choose your bank and enter your account number');
    }
    const [user] = await this.db
      .select({ firstName: users.firstName, lastName: users.lastName, phone: users.phone })
      .from(users)
      .where(eq(users.id, auth.userId));
    if (!user?.firstName || !user.lastName) {
      throw unprocessable('name_required', 'Add your first and last name to your profile first');
    }

    // Claimed first, so two taps never issue twice: a new row, or one that failed before, becomes pending.
    const ownerRef = `jva-${auth.userId}`;
    const [claimed] = await this.db
      .insert(fixedAccounts)
      .values({
        userId: auth.userId,
        countryCode: auth.countryCode,
        provider: payments.name,
        ownerRef,
        status: 'pending',
      })
      .onConflictDoUpdate({
        target: [fixedAccounts.userId, fixedAccounts.provider],
        set: { status: 'pending', failureReason: null, updatedAt: new Date() },
        setWhere: eq(fixedAccounts.status, 'failed'),
      })
      .returning();
    if (!claimed) return fixedAccountView((await this.rowFor(auth.userId, payments.name))!);

    let state: FixedAccountState;
    try {
      state = await payments.issueFixedAccount({
        ownerRef,
        email: `${auth.userId}@${this.config.PAYMENT_EMAIL_DOMAIN}`,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        bvn: input.bvn,
        bankCode: needs === 'bvn_and_bank' ? input.bankCode : undefined,
        accountNumber: needs === 'bvn_and_bank' ? input.accountNumber : undefined,
      });
    } catch (error) {
      this.logger.warn(`Issuing a fixed account at ${payments.name} failed: ${(error as Error).message}`);
      await this.db
        .update(fixedAccounts)
        .set({ status: 'failed', failureReason: "We couldn't reach the bank. Try again.", updatedAt: new Date() })
        .where(eq(fixedAccounts.id, claimed.id));
      throw unavailable('provider_unavailable', "We couldn't reach the bank. Try again in a moment.");
    }
    return fixedAccountView(await this.apply(claimed, state, payments, false));
  }

  /** A provider told us an account changed (identification passed or failed, account assigned). */
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
    return this.refresh(row, payments, true);
  }

  /** For reconciliation: accounts still being issued are asked about, in case a webhook was missed. */
  async refreshPending() {
    const rows = await this.db
      .select()
      .from(fixedAccounts)
      .where(
        and(
          eq(fixedAccounts.status, 'pending'),
          lt(fixedAccounts.updatedAt, new Date(Date.now() - REFRESH_AFTER_MS)),
          gt(fixedAccounts.createdAt, new Date(Date.now() - PENDING_RECHECK_DAYS * 86_400_000)),
        ),
      )
      .limit(500);
    for (const row of rows) {
      const payments = this.providers.named('payments', row.provider);
      if (!payments || !row.providerRef) continue;
      await this.refresh(row, payments, true).catch((error: Error) =>
        this.logger.warn(`Could not check fixed account ${row.id}: ${error.message}`),
      );
    }
  }

  /** Whose account a transfer went to, by the provider's reference or ours. */
  async findForPayment(provider: string, refs: { providerRef?: string; ownerRef?: string }) {
    const match = refs.providerRef
      ? eq(fixedAccounts.providerRef, refs.providerRef)
      : refs.ownerRef
        ? eq(fixedAccounts.ownerRef, refs.ownerRef)
        : null;
    if (!match) return null;
    const [row] = await this.db
      .select()
      .from(fixedAccounts)
      .where(and(eq(fixedAccounts.provider, provider), match));
    return row ?? null;
  }

  private async rowFor(userId: string, provider: string) {
    const [row] = await this.db
      .select()
      .from(fixedAccounts)
      .where(and(eq(fixedAccounts.userId, userId), eq(fixedAccounts.provider, provider)));
    return row ?? null;
  }

  private async refresh(row: FixedAccountRow, payments: PaymentsAdapter, notify: boolean) {
    if (row.status !== 'pending' || !row.providerRef || !payments.fixedAccountState) return row;
    return this.apply(row, await payments.fixedAccountState(row.providerRef), payments, notify);
  }

  /** Records where issuing has got to. The first time an account is active, its cost is booked. */
  private async apply(row: FixedAccountRow, state: FixedAccountState, payments: PaymentsAdapter, notify: boolean) {
    const now = new Date();
    if (state.status !== 'active') {
      const [after] = await this.db
        .update(fixedAccounts)
        .set({
          status: state.status,
          providerRef: state.providerRef ?? row.providerRef,
          failureReason: state.status === 'failed' ? state.reason : null,
          updatedAt: now,
        })
        // An account already active stays so, whatever a late event says.
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
          ...(first ? { activatedAt: now, issueFeeKobo: fee } : {}),
          updatedAt: now,
        })
        .where(eq(fixedAccounts.id, row.id))
        .returning();
      if (first) {
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
