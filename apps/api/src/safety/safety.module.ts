import { Global, Module } from '@nestjs/common';
import { SafetyController } from './safety.controller';
import { SafetyService } from './safety.service';

/** The emergency button and the Safety queue (docs/security-plan.md, E9). */
@Global()
@Module({
  controllers: [SafetyController],
  providers: [SafetyService],
  exports: [SafetyService],
})
export class SafetyModule {}
