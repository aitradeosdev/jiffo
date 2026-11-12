import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify, SignJWT } from 'jose';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { APPS, type AppName } from '../db/schema';
import { randomToken, sha256 } from '../common/crypto';
import { unauthorized } from '../common/errors';
import type { AuthContext } from './auth.types';

const ISSUER = 'jiffo';
const AUDIENCE = 'jiffo-api';

@Injectable()
export class TokensService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.JWT_SECRET);
  }

  get accessTtlSeconds() {
    return this.config.ACCESS_TOKEN_TTL_SECONDS;
  }

  signAccess(auth: AuthContext): Promise<string> {
    return new SignJWT({ sid: auth.sessionId, did: auth.deviceId, app: auth.app })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(auth.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  /** Checks the signature and expiry only. AuthGuard also checks the session is still live. */
  async verifyAccess(token: string): Promise<AuthContext> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      const app = payload.app as AppName;
      if (!payload.sub || typeof payload.sid !== 'string' || typeof payload.did !== 'string' || !APPS.includes(app)) {
        throw new Error('Missing claims');
      }
      return { userId: payload.sub, sessionId: payload.sid, deviceId: payload.did, app };
    } catch {
      throw unauthorized('invalid_token', 'Sign in again');
    }
  }

  /** A new refresh token and the hash stored for it. Only the hash is kept. */
  newRefreshToken() {
    const token = randomToken();
    return { token, hash: sha256(token) };
  }
}
