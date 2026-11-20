import { Global, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { RECURRING_JOBS, type RecurringJobs } from '../timers/recurring-jobs';
import { CloudRangesService } from './cloud-ranges.service';
import { NetworksService } from './networks.service';
import { SignInRiskService } from './sign-in-risk.service';
import { RiskFlagsService } from './risk-flags.service';

/** Fraud flags for the Risk and verification queues (docs/security-plan.md, E5, E6, I3). */
@Global()
@Module({
  providers: [RiskFlagsService, NetworksService, CloudRangesService, SignInRiskService],
  exports: [RiskFlagsService, NetworksService, CloudRangesService, SignInRiskService],
})
export class RiskModule implements OnModuleInit {
  constructor(
    @Inject(RECURRING_JOBS) private readonly jobs: RecurringJobs,
    private readonly networks: NetworksService,
    private readonly cloud: CloudRangesService,
  ) {}

  onModuleInit() {
    // Daily, forget the networks not used for 90 days.
    this.jobs.register('networks.prune', '41 3 * * *', () => this.networks.prune());
    // Daily, the cloud providers' published address ranges (A10).
    this.jobs.register('cloud_ranges.refresh', '17 4 * * *', () => this.cloud.refresh());
  }
}
