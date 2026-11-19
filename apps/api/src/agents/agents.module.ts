import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { RECURRING_JOBS, type RecurringJobs } from '../timers/recurring-jobs';
import { AgentApplicationController } from './application.controller';
import { AgentApplicationService } from './application.service';
import { AgentSelfieController } from './agent-selfie.controller';
import { AgentSelfieService } from './agent-selfie.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

@Global()
@Module({
  controllers: [AgentsController, PresenceController, AgentApplicationController, AgentSelfieController],
  providers: [AgentsService, PresenceService, AgentApplicationService, AgentSelfieService],
  exports: [AgentsService, PresenceService, AgentApplicationService, AgentSelfieService],
})
export class AgentsModule implements OnModuleInit {
  constructor(
    @Inject(RECURRING_JOBS) private readonly jobs: RecurringJobs,
    private readonly presence: PresenceService,
  ) {}

  onModuleInit() {
    // Every 10 minutes, delete positions that stopped being refreshed.
    this.jobs.register('presence.sweep', '*/10 * * * *', () => this.presence.sweep());
  }
}
