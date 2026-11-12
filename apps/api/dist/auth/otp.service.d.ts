import { AppConfig } from '../config/app-config';
import { type Db } from '../db/database.module';
import { CountriesService } from '../countries/countries.service';
import { type MessagingAdapter } from '../adapters/messaging';
/** One-time sign-in codes: 6 digits, stored only as an HMAC, short-lived, limited per number and per IP. */
export declare class OtpService {
    private readonly db;
    private readonly config;
    private readonly messaging;
    private readonly countries;
    constructor(db: Db, config: AppConfig, messaging: MessagingAdapter, countries: CountriesService);
    private hash;
    request(phone: string, country: string, ip: string | null): Promise<{
        expiresInSeconds: number;
        resendInSeconds: number;
    }>;
    /** Consumes the latest code for the number, or throws. Only the most recent code is ever accepted. */
    verify(phone: string, country: string, code: string): Promise<void>;
}
