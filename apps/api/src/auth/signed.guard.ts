import { applyDecorators, CanActivate, ExecutionContext, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthedRequest } from './auth.types';
import { DeviceSecurityService, SIGNED_HEADERS } from './device-security.service';

const SIGNED_KEY = 'jiffo:signed';

/**
 * A money action (docs/security-plan.md, A3, A5, A7): signed by the phone's own key over a single-use code
 * from the server, with the app PIN unless `pin: false` (setting the PIN itself). Put it after AuthGuard.
 */
export const Signed = (options: { pin?: boolean } = {}) =>
  applyDecorators(SetMetadata(SIGNED_KEY, { pin: options.pin !== false }), UseGuards(SignedGuard));

@Injectable()
export class SignedGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly security: DeviceSecurityService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthedRequest & { rawBody?: Buffer }>();
    const { pin } = this.reflector.get<{ pin: boolean }>(SIGNED_KEY, context.getHandler()) ?? { pin: true };
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
