import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { safeEqual } from '../common/crypto';
import { forbidden, unauthorized } from '../common/errors';
import type { AdminRole } from '../db/schema';
import { AdminAuthService } from './admin-auth.service';
import { can, type Permission } from './permissions';
import type { AdminContext, AdminRequest, ClientInfo } from './admin.types';

export const PERMISSION_KEY = 'jiffo:admin-permission';
/**
 * The permission a route needs: every admin route names at least one, and 'read' is the least. With several,
 * any one will do, and the service checks which the request itself needs.
 */
export const Needs = (...permissions: [Permission, ...Permission[]]) => SetMetadata(PERMISSION_KEY, permissions);

/**
 * The admin's own IP and browser. The panel's server calls the API for the admin, so it passes them on in
 * headers; they are believed only alongside the shared panel secret. Otherwise the caller's own IP is used.
 */
export function clientOf(req: AdminRequest, config: AppConfig): ClientInfo {
  const secret = config.ADMIN_PANEL_SECRET;
  const presented = req.header('x-jiffo-panel');
  if (secret && presented && safeEqual(presented, secret)) {
    return {
      // Without the admin's IP, the panel's own counts instead, so the network limit still applies.
      ip: req.header('x-jiffo-client-ip')?.slice(0, 64) || req.ip || null,
      userAgent: req.header('x-jiffo-client-ua')?.slice(0, 300) || null,
    };
  }
  return { ip: req.ip ?? null, userAgent: req.header('user-agent')?.slice(0, 300) ?? null };
}

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized('missing_token', 'Sign in to continue');
    req.admin = await this.auth.authenticate(token, clientOf(req, this.config));

    const needed = this.reflector.getAllAndOverride<Permission[] | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // A route that forgot to say what it needs is closed, not open.
    if (!needed?.length || !needed.some((p) => can(req.admin!.role as AdminRole, p))) {
      throw forbidden('not_permitted', 'Your role does not allow this');
    }
    return true;
  }
}

/** The signed-in admin. Only valid on routes behind AdminGuard. */
export const CurrentAdmin = createParamDecorator((_: unknown, context: ExecutionContext): AdminContext => {
  const admin = context.switchToHttp().getRequest<AdminRequest>().admin;
  if (!admin) throw unauthorized('missing_token', 'Sign in to continue');
  return admin;
});
