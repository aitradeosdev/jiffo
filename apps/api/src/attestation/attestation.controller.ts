import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { z } from 'zod';
import { RateLimit } from '../common/rate-limit';
import { ZodBody } from '../common/zod-body';
import { APPS } from '../db/schema';
import { AttestationService } from './attestation.service';

const DeviceKey = z.string().min(8).max(128);
const ChallengeBody = z.object({ deviceKey: DeviceKey });
const AppleKeyBody = z.object({
  deviceKey: DeviceKey,
  app: z.enum(APPS),
  keyId: z.string().min(16).max(100),
  attestation: z.string().min(16).max(20_000),
  nonce: z.string().min(16).max(100),
});

/**
 * App attestation (docs/security-plan.md, MB3), asked for before sign-in too, so neither route needs a
 * session: a code for this install, and an iPhone's newly attested key.
 */
@Controller('attestation')
@RateLimit('auth')
export class AttestationController {
  constructor(private readonly attestation: AttestationService) {}

  /** A single-use code to make an attestation over, for this install. */
  @Post('challenge')
  @HttpCode(200)
  challenge(@Body(new ZodBody(ChallengeBody)) body: z.infer<typeof ChallengeBody>) {
    return this.attestation.challenge(body.deviceKey);
  }

  /** An App Attest key Apple attested over a code from `challenge`. */
  @Post('apple-key')
  @HttpCode(204)
  async appleKey(@Body(new ZodBody(AppleKeyBody)) body: z.infer<typeof AppleKeyBody>) {
    await this.attestation.registerAppleKey(body);
  }
}
