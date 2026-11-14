import { CanActivate, createParamDecorator, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq, inArray } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { sessions, users, type AppName } from '../db/schema';
import { forbidden, unauthorized } from '../common/errors';
import { TokensService } from './tokens.service';
import type { AuthContext, AuthedRequest, TokenClaims } from './auth.types';

export const APPS_KEY = 'jiffo:apps';
/** How many sessions one re-check reads at a time, well inside Postgres's limit on query parameters. */
const CHECK_BATCH = 1000;

/** A session still counts while it isn't revoked or expired. */
const sessionLive = (s: { revokedAt: Date | null; expiresAt: Date }) =>
  !s.revokedAt && s.expiresAt.getTime() > Date.now();
/** Limits a route to sessions from these apps, e.g. @Apps('agent') for the job board. */
export const Apps = (...apps: AppName[]) => SetMetadata(APPS_KEY, apps);

@Injectable()
export class SessionVerifier {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly tokens: TokensService,
  ) {}

  /** Checks the token and that its session is still live and the account active. */
  async verify(token: string, verified?: TokenClaims): Promise<AuthContext> {
    // Claims the rate limiter already checked for this request are used as they are.
    const auth = verified ?? (await this.tokens.verifyAccess(token));
    const [row] = await this.db
      .select({
        revokedAt: sessions.revokedAt,
        expiresAt: sessions.expiresAt,
        status: users.status,
        countryCode: users.countryCode,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, auth.sessionId));
    if (!row || !sessionLive(row)) throw unauthorized('session_ended', 'Sign in again');
    if (row.status !== 'active') throw forbidden('account_suspended', 'This account is suspended. Contact support.');
    return { ...auth, countryCode: row.countryCode };
  }

  /** Which of these sessions would still pass verify(): for re-checking connections opened earlier. */
  async liveSessions(ids: string[]): Promise<Set<string>> {
    const live = new Set<string>();
    for (let i = 0; i < ids.length; i += CHECK_BATCH) {
      const rows = await this.db
        .select({ id: sessions.id, revokedAt: sessions.revokedAt, expiresAt: sessions.expiresAt, status: users.status })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(inArray(sessions.id, ids.slice(i, i + CHECK_BATCH)));
      for (const row of rows) if (sessionLive(row) && row.status === 'active') live.add(row.id);
    }
    return live;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly verifier: SessionVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized('missing_token', 'Sign in to continue');
    req.auth = await this.verifier.verify(token, (req as AuthedRequest & { accessClaims?: TokenClaims }).accessClaims);

    const apps = this.reflector.getAllAndOverride<AppName[] | undefined>(APPS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (apps && !apps.includes(req.auth.app)) throw forbidden('wrong_app', `Use the ${apps.join(' or ')} app for this`);
    return true;
  }
}

/** The signed-in caller. Only valid on routes behind AuthGuard. */
export const CurrentAuth = createParamDecorator((_: unknown, context: ExecutionContext): AuthContext => {
  const auth = context.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw unauthorized('missing_token', 'Sign in to continue');
  return auth;
});
