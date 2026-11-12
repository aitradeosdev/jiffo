import { AppConfig } from '../config/app-config';
import type { AuthContext } from './auth.types';
export declare class TokensService {
    private readonly config;
    private readonly key;
    constructor(config: AppConfig);
    get accessTtlSeconds(): number;
    signAccess(auth: AuthContext): Promise<string>;
    /** Checks the signature and expiry only. AuthGuard also checks the session is still live. */
    verifyAccess(token: string): Promise<AuthContext>;
    /** A new refresh token and the hash stored for it. Only the hash is kept. */
    newRefreshToken(): {
        token: string;
        hash: string;
    };
}
