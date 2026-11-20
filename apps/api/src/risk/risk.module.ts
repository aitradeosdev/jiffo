import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { RECURRING_JOBS, type RecurringJobs } from '../timers/recurring-jobs';
import { NetworksService } from './networks.service';
import { RiskFlagsService } from './risk-flags.service';

/** Fraud flags for the Risk and verification queues (docs/security-plan.md, E5, E6, I3). */
@Global()
@Module({
  providers: [RiskFlagsService, NetworksService],
  exports: [RiskFlagsService, NetworksService],
})
export class RiskModule implements OnModuleInit {
  constructor(
    @Inject(RECURRING_JOBS) private readonly jobs: RecurringJobs,
    private readonly networks: NetworksService,
  ) {}

  onModuleInit() {
    // Daily, forget the networks not used for 90 days.
    this.jobs.register('networks.prune', '41 3 * * *', () => this.networks.prune());
  }
}
