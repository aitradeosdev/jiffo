import { Global, Inject, Module, OnModuleInit } from '@nestjs/common';
import { RECURRING_JOBS, type RecurringJobs } from '../timers/recurring-jobs';
import { AgentApplicationController } from './application.controller';
import { AgentApplicationService } from './application.service';
import { AgentSelfieController } from './agent-selfie.controller';
import { AgentSelfieService } from './agent-selfie.service';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { PresenceController } from './presence.controller';
import { DestinationController } from './destination.controller';
import { DestinationService } from './destination.service';
import { PresenceService } from './presence.service';
import { TrailService } from './trail.service';

@Global()
@Module({
  controllers: [
    AgentsController,
    PresenceController,
    DestinationController,
    AgentApplicationController,
    AgentSelfieController,
  ],
  providers: [
    AgentsService,
    PresenceService,
    DestinationService,
    AgentApplicationService,
    AgentSelfieService,
    TrailService,
  ],
  exports: [AgentsService, PresenceService, AgentApplicationService, AgentSelfieService, TrailService],
})
export class AgentsModule implements OnModuleInit {
  constructor(
    @Inject(RECURRING_JOBS) private readonly jobs: RecurringJobs,
    private readonly presence: PresenceService,
    private readonly trail: TrailService,
  ) {}

  onModuleInit() {
    // Every 10 minutes, delete positions that stopped being refreshed.
    this.jobs.register('presence.sweep', '*/10 * * * *', () => this.presence.sweep());
    // Daily, delete trails older than each country's Settings, Security say, unless a dispute or open flag
    // still needs them (G4, X10).
    this.jobs.register('trail.prune', '53 3 * * *', () => this.trail.prune());
  }
}
