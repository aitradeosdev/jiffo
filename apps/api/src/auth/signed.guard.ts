import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AgentSelfieService } from '../agents/agent-selfie.service';
import { AttestationService } from '../attestation/attestation.service';
import type { AttestPurpose } from '../attestation/attestation.types';
import { evidenceOf } from '../attestation/evidence';
import type { AuthedRequest } from './auth.types';
import { DeviceSecurityService, SIGNED_HEADERS } from './device-security.service';

const SIGNED_KEY = 'jiffo:signed';

interface SignedOptions {
  /** With the app PIN, unless false (setting the PIN itself). */
  pin?: boolean;
  /** A selfie this action needs first (P8), asked for before the single-use code is used. */
  selfie?: 'payout_change';
  /** The app check this action needs (MB3), as Settings, Security says. */
  attest?: AttestPurpose;
}

interface SignedMeta {
  pin: boolean;
  selfie: 'payout_change' | null;
  attest: AttestPurpose | null;
}

/**
 * A money action (docs/security-plan.md, A3, A5, A7): signed by the phone's own key over a single-use code
 * from the server, with the app PIN unless `pin: false` (setting the PIN itself). Put it after AuthGuard.
 */
export const Signed = (options: SignedOptions = {}) =>
  applyDecorators(
    SetMetadata(SIGNED_KEY, {
      pin: options.pin !== false,
      selfie: options.selfie ?? null,
      attest: options.attest ?? null,
    } satisfies SignedMeta),
    UseGuards(SignedGuard),
  );

@Injectable()
export class SignedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly security: DeviceSecurityService,
    private readonly selfie: AgentSelfieService,
    private readonly attestation: AttestationService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthedRequest & { rawBody?: Buffer }>();
    const auth = req.auth!;
    const { pin, selfie, attest } = this.reflector.get<SignedMeta>(SIGNED_KEY, context.getHandler()) ?? {
      pin: true,
      selfie: null,
      attest: null,
    };
    // Before the code is used, so the app can take the selfie and send the same one again.
    if (selfie === 'payout_change' && auth.app === 'agent') await this.selfie.assertFreshForPayoutChange(auth);
    if (attest) {
      const device = await this.security.deviceOf(auth);
      const verdict = await this.attestation.enforce({
        purpose: attest,
        deviceKey: device.deviceKey,
        platform: device.platform,
        app: auth.app,
        userId: auth.userId,
        countryCode: auth.countryCode,
        ...evidenceOf(req),
      });
      // A phone the app check doubts: a selfie first, rather than refusing everyone on such a phone.
      if (verdict === 'doubtful' && auth.app === 'agent') await this.selfie.assertFreshForDevice(auth);
    }
    await this.security.verify(
      auth,
      {
        method: req.method,
        path: req.originalUrl,
        body: req.rawBody,
        nonce: req.header(SIGNED_HEADERS.nonce),
        signature: req.header(SIGNED_HEADERS.signature),
      },
      pin ? req.header(SIGNED_HEADERS.pin) : false,
    );
    return true;
  }
}
