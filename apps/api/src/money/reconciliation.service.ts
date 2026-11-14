import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq, inArray, lt, sum, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { countries, deposits, payouts, reconciliationRuns } from '../db/schema';
import { PAYMENTS, type PaymentsAdapter } from '../adapters/payments';
import { LedgerService } from './ledger.service';
import { ProvidersService } from '../providers/providers.service';
import { DepositsService } from './deposits.service';
import { FixedAccountsService } from './fixed-accounts.service';

const DAY_MS = 86_400_000;

/**
 * The daily check that the ledger's cash matches what the payment provider holds. Payouts the provider
 * has already taken from its balance, but not yet confirmed, are allowed for. Any difference is saved
 * for finance to look at in admin; nothing is corrected automatically.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(PAYMENTS) private readonly payments: PaymentsAdapter,
    private readonly ledger: LedgerService,
    private readonly deposits: DepositsService,
    private readonly providers: ProvidersService,
    private readonly fixedAccounts: FixedAccountsService,
  ) {}

  /**
   * What every payments provider still holding Jiffo's money reports, added up: the one in use, and any
   * that top-ups or payouts went through before admin switched. The ledger's cash is one number for all.
   */
  private async balances(countryCode: string, currency: string) {
    const used = await this.db.execute<{ provider: string }>(sql`
      select distinct provider from deposits where country_code = ${countryCode} and status = 'succeeded'
      union select distinct provider from payouts where country_code = ${countryCode} and provider is not null`);
    const names: string[] = [];
    let providerBalanceKobo = 0;
    for (const name of [...new Set([this.payments.name, ...used.rows.map((r) => r.provider)])].sort()) {
      const adapter = this.providers.named('payments', name);
      // No provider set up at all, or its keys were removed: its balance can't be read, and any money left
      // there shows as a difference.
      if (!adapter || adapter.name === 'none') {
        if (name !== 'none') this.logger.warn(`Reconciliation leaves out ${name}, which is no longer set up`);
        continue;
      }
      providerBalanceKobo += await adapter.balance(currency);
      names.push(name);
    }
    return { providerBalanceKobo, names };
  }

  async run() {
    await this.deposits.syncExpired();
    await this.fixedAccounts.refreshPending();
    const live = await this.db.select().from(countries).where(eq(countries.enabled, true));
    const results = [];
    for (const country of live) {
      const [{ providerBalanceKobo, names }, ledgerCashKobo, [transit], [pending], [stuck]] = await Promise.all([
        this.balances(country.code, country.currency),
        this.ledger.balance(this.db, { type: 'provider_cash' }, country.code),
        this.db
          .select({ total: sum(payouts.sendKobo) })
          .from(payouts)
          .where(and(eq(payouts.countryCode, country.code), eq(payouts.status, 'processing'))),
        this.db
          .select({ n: count() })
          .from(deposits)
          .where(
            and(
              eq(deposits.countryCode, country.code),
              eq(deposits.status, 'pending'),
              lt(deposits.expiresAt, new Date()),
            ),
          ),
        this.db
          .select({ n: count() })
          .from(payouts)
          .where(
            and(
              eq(payouts.countryCode, country.code),
              inArray(payouts.status, ['requested', 'processing']),
              lt(payouts.createdAt, new Date(Date.now() - DAY_MS)),
            ),
          ),
      ]);
      const inTransitKobo = Number(transit?.total ?? 0);
      const differenceKobo = providerBalanceKobo - (ledgerCashKobo - inTransitKobo);
      const [run] = await this.db
        .insert(reconciliationRuns)
        .values({
          countryCode: country.code,
          provider: names.join('+'),
          providerBalanceKobo,
          ledgerCashKobo,
          inTransitKobo,
          differenceKobo,
          pendingDeposits: Number(pending?.n ?? 0),
          stuckPayouts: Number(stuck?.n ?? 0),
        })
        .returning();
      if (differenceKobo !== 0) this.logger.warn(`Reconciliation gap in ${country.code}: ${differenceKobo} kobo`);
      results.push(run!);
    }
    return results;
  }
}
