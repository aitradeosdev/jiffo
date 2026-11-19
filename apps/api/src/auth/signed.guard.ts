import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AgentSelfieService } from '../agents/agent-selfie.service';
import type { AuthedRequest } from './auth.types';
import { DeviceSecurityService, SIGNED_HEADERS } from './device-security.service';

const SIGNED_KEY = 'jiffo:signed';

interface SignedOptions {
  /** With the app PIN, unless false (setting the PIN itself). */
  pin?: boolean;
  /** A selfie this action needs first (P8), asked for before the single-use code is used. */
  selfie?: 'payout_change';
}

/**
 * A money action (docs/security-plan.md, A3, A5, A7): signed by the phone's own key over a single-use code
 * from the server, with the app PIN unless `pin: false` (setting the PIN itself). Put it after AuthGuard.
 */
export const Signed = (options: SignedOptions = {}) =>
  applyDecorators(
    SetMetadata(SIGNED_KEY, { pin: options.pin !== false, selfie: options.selfie ?? null }),
    UseGuards(SignedGuard),
  );

@Injectable()
export class SignedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly security: DeviceSecurityService,
    private readonly selfie: AgentSelfieService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthedRequest & { rawBody?: Buffer }>();
    const { pin, selfie } = this.reflector.get<{ pin: boolean; selfie: 'payout_change' | null }>(
      SIGNED_KEY,
      context.getHandler(),
    ) ?? { pin: true, selfie: null };
    // Before the code is used, so the app can take the selfie and send the same one again.
    if (selfie === 'payout_change' && req.auth!.app === 'agent')
      await this.selfie.assertFreshForPayoutChange(req.auth!);
    await this.security.verify(
      req.auth!,
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
