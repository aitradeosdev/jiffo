import { Global, Module } from '@nestjs/common';
import { AttestationController } from './attestation.controller';
import { AttestationService } from './attestation.service';

/** App attestation: Play Integrity and App Attest (docs/security-plan.md, MB3). */
@Global()
@Module({
  controllers: [AttestationController],
  providers: [AttestationService],
  exports: [AttestationService],
})
export class AttestationModule {}
