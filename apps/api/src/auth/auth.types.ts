import type { Request } from 'express';
import type { AppName } from '../db/schema';

/** Who is calling: set on the request by AuthGuard. */
export interface AuthContext {
  userId: string;
  sessionId: string;
  deviceId: string;
  app: AppName;
}

export type AuthedRequest = Request & { auth?: AuthContext };
