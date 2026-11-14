import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { RECURRING_JOBS, type RecurringJobs } from '../timers/recurring-jobs';
import { CustomerIdentityController } from './customer-identity.controller';
import { CustomerIdentityService } from './customer-identity.service';
import { IdentityChecksService } from './identity-checks.service';
import { IdentityProviderController } from './identity.controller';

/** Identity checks for customers and agents, and what identity providers reach. */
@Global()
@Module({
  controllers: [IdentityProviderController, CustomerIdentityController],
  providers: [IdentityChecksService, CustomerIdentityService],
  exports: [IdentityChecksService, CustomerIdentityService],
})
export class IdentityModule implements OnModuleInit {
  constructor(
    @Inject(RECURRING_JOBS) private readonly jobs: RecurringJobs,
    private readonly checks: IdentityChecksService,
  ) {}

  onModuleInit() {
    // Daily, forget attempts and webhook signatures older than any limit looks at.
    this.jobs.register('identity.prune', '23 3 * * *', () => this.checks.prune());
  }
}
