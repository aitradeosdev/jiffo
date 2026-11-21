import { Global, Module } from '@nestjs/common';
import { AgentLocations } from './agent-locations';
import { MatchingRedis } from './matching-redis';
import { TravelTimesService } from './travel-times';

/** Matching's live state: where online agents are, and how long they take to reach a pickup. */
@Global()
@Module({
  providers: [MatchingRedis, AgentLocations, TravelTimesService],
  exports: [MatchingRedis, AgentLocations, TravelTimesService],
})
export class MatchingModule {}
