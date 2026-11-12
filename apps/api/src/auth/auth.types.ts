import type { Request } from 'express';
import type { AppName } from '../db/schema';

/** What the access token carries. */
export interface TokenClaims {
  userId: string;
  sessionId: string;
  deviceId: string;
  app: AppName;
}

/** Who is calling: set on the request by AuthGuard, from the token and the live session. */
export interface AuthContext extends TokenClaims {
  countryCode: string;
}

export type AuthedRequest = Request & { auth?: AuthContext };
