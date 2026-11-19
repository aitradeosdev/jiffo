import { Global, Module } from '@nestjs/common';
import { RiskFlagsService } from './risk-flags.service';

/** Fraud flags for the Risk and verification queues (docs/security-plan.md, E5, E6, I3). */
@Global()
@Module({
  providers: [RiskFlagsService],
  exports: [RiskFlagsService],
})
export class RiskModule {}
