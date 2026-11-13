import { Global, Module } from '@nestjs/common';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

@Global()
@Module({
  controllers: [AgentsController, PresenceController],
  providers: [AgentsService, PresenceService],
  exports: [AgentsService, PresenceService],
})
export class AgentsModule {}
