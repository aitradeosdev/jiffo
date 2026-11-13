import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { RECURRING_JOBS, type RecurringJobs } from '../timers/recurring-jobs';
import { DepositsService } from './deposits.service';
import { LedgerService } from './ledger.service';
import { MoneyController } from './money.controller';
import { PayoutsService } from './payouts.service';
import { ReconciliationService } from './reconciliation.service';
import { WalletService } from './wallet.service';
import { WebhooksController } from './webhooks.controller';

@Global()
@Module({
  controllers: [MoneyController, WebhooksController],
  providers: [LedgerService, WalletService, DepositsService, PayoutsService, ReconciliationService],
  exports: [LedgerService, WalletService, DepositsService, PayoutsService, ReconciliationService],
})
export class MoneyModule implements OnModuleInit {
  constructor(
    @Inject(RECURRING_JOBS) private readonly jobs: RecurringJobs,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly payouts: PayoutsService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  onModuleInit() {
    this.jobs.register('payouts.daily', this.config.PAYOUT_CRON, () => this.payouts.runDaily());
    this.jobs.register('payouts.retry', this.config.PAYOUT_RETRY_CRON, () => this.payouts.retryPending());
    this.jobs.register('reconcile.daily', this.config.RECONCILE_CRON, () => this.reconciliation.run());
  }
}
