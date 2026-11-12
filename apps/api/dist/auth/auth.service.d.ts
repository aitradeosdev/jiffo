import { AppConfig } from '../config/app-config';
import { type Db } from '../db/database.module';
import { users, type AppName } from '../db/schema';
import { CountriesService } from '../countries/countries.service';
import { OtpService } from './otp.service';
import { TokensService } from './tokens.service';
import type { AuthContext } from './auth.types';
export interface DeviceInfo {
    key: string;
    platform: 'ios' | 'android' | 'web';
    name?: string | undefined;
}
export declare const publicUser: (u: typeof users.$inferSelect) => {
    id: string;
    phone: string;
    countryCode: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    createdAt: Date;
};
export declare class AuthService {
    private readonly db;
    private readonly config;
    private readonly countries;
    private readonly otp;
    private readonly tokens;
    constructor(db: Db, config: AppConfig, countries: CountriesService, otp: OtpService, tokens: TokensService);
    private resolvePhone;
    requestCode(phoneInput: string, ip: string | null): Promise<{
        expiresInSeconds: number;
        resendInSeconds: number;
        phone: string;
    }>;
    /** Signs in with a code. The same phone number is one account across both apps. */
    verifyCode(phoneInput: string, code: string, app: AppName, device: DeviceInfo): Promise<{
        user: {
            id: string;
            phone: string;
            countryCode: string;
            firstName: string | null;
            lastName: string | null;
            email: string | null;
            createdAt: Date;
        };
        isNewUser: boolean;
        accessToken: string;
        accessTokenExpiresIn: number;
        refreshToken: string;
    }>;
    /** Swaps a refresh token for a new pair. A token that was already used revokes the whole session. */
    refresh(refreshToken: string): Promise<{
        accessToken: string;
        accessTokenExpiresIn: number;
        refreshToken: string;
    } | undefined>;
    /** Ends this session and stops push notifications to this phone. */
    logout(auth: AuthContext): Promise<void>;
    /** Signs out every other phone, e.g. after the account owner reports a lost phone. */
    logoutOthers(auth: AuthContext): Promise<void>;
    private issue;
}
