import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, count, eq, inArray, lt, sum } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { countries, deposits, payouts, reconciliationRuns } from '../db/schema';
import { PAYMENTS, type PaymentsAdapter } from '../adapters/payments';
import { LedgerService } from './ledger.service';
import { DepositsService } from './deposits.service';

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
  ) {}

  async run() {
    await this.deposits.syncExpired();
    const live = await this.db.select().from(countries).where(eq(countries.enabled, true));
    const results = [];
    for (const country of live) {
      const [providerBalanceKobo, ledgerCashKobo, [transit], [pending], [stuck]] = await Promise.all([
        this.payments.balance(country.currency),
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
          provider: this.payments.name,
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
