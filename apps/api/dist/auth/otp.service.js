"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OtpService = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const app_config_1 = require("../config/app-config");
const database_module_1 = require("../db/database.module");
const schema_1 = require("../db/schema");
const countries_service_1 = require("../countries/countries.service");
const messaging_1 = require("../adapters/messaging");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const HOUR_MS = 3_600_000;
/** One-time sign-in codes: 6 digits, stored only as an HMAC, short-lived, limited per number and per IP. */
let OtpService = class OtpService {
    db;
    config;
    messaging;
    countries;
    constructor(db, config, messaging, countries) {
        this.db = db;
        this.config = config;
        this.messaging = messaging;
        this.countries = countries;
    }
    hash(phone, code) {
        return (0, crypto_1.hmacSha256)(this.config.OTP_SECRET, `${phone}:${code}`);
    }
    async request(phone, country, ip) {
        const { limits } = (await this.countries.currentSettings(country)).settings;
        const code = (0, crypto_1.numericCode)(6);
        const now = Date.now();
        const challengeId = await this.db.transaction(async (tx) => {
            // One request at a time per number, so two quick taps cannot both pass the limits.
            await tx.execute((0, drizzle_orm_1.sql) `select pg_advisory_xact_lock(hashtext(${'otp:' + phone}))`);
            const hourAgo = new Date(now - HOUR_MS);
            const [latest] = await tx
                .select({ createdAt: schema_1.otpChallenges.createdAt })
                .from(schema_1.otpChallenges)
                .where((0, drizzle_orm_1.eq)(schema_1.otpChallenges.phone, phone))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.otpChallenges.createdAt))
                .limit(1);
            if (latest) {
                const waitMs = latest.createdAt.getTime() + limits.otpResendSeconds * 1000 - now;
                if (waitMs > 0) {
                    throw (0, errors_1.tooMany)('otp_resend_wait', 'Wait a moment before asking for another code', {
                        retryAfterSeconds: Math.ceil(waitMs / 1000),
                    });
                }
            }
            const [perPhone] = await tx
                .select({ n: (0, drizzle_orm_1.count)() })
                .from(schema_1.otpChallenges)
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.otpChallenges.phone, phone), (0, drizzle_orm_1.gt)(schema_1.otpChallenges.createdAt, hourAgo)));
            if ((perPhone?.n ?? 0) >= limits.otpPerHour) {
                throw (0, errors_1.tooMany)('otp_rate_limited', 'Too many codes for this number. Try again in an hour.');
            }
            if (ip) {
                const [perIp] = await tx
                    .select({ n: (0, drizzle_orm_1.count)() })
                    .from(schema_1.otpChallenges)
                    .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.otpChallenges.requestedIp, ip), (0, drizzle_orm_1.gt)(schema_1.otpChallenges.createdAt, hourAgo)));
                if ((perIp?.n ?? 0) >= this.config.OTP_PER_IP_PER_HOUR) {
                    throw (0, errors_1.tooMany)('otp_rate_limited', 'Too many codes requested. Try again later.');
                }
            }
            const [row] = await tx
                .insert(schema_1.otpChallenges)
                .values({
                phone,
                codeHash: this.hash(phone, code),
                requestedIp: ip,
                expiresAt: new Date(now + limits.otpTtlSeconds * 1000),
            })
                .returning({ id: schema_1.otpChallenges.id });
            return row.id;
        });
        try {
            await this.messaging.sendOtp(phone, code, limits.otpTtlSeconds);
        }
        catch (error) {
            // The code never reached the person, so it must not count against them.
            await this.db.delete(schema_1.otpChallenges).where((0, drizzle_orm_1.eq)(schema_1.otpChallenges.id, challengeId));
            throw error;
        }
        return { expiresInSeconds: limits.otpTtlSeconds, resendInSeconds: limits.otpResendSeconds };
    }
    /** Consumes the latest code for the number, or throws. Only the most recent code is ever accepted. */
    async verify(phone, country, code) {
        const { limits } = (await this.countries.currentSettings(country)).settings;
        const outcome = await this.db.transaction(async (tx) => {
            const [challenge] = await tx
                .select()
                .from(schema_1.otpChallenges)
                .where((0, drizzle_orm_1.eq)(schema_1.otpChallenges.phone, phone))
                .orderBy((0, drizzle_orm_1.desc)(schema_1.otpChallenges.createdAt))
                .limit(1)
                .for('update');
            if (!challenge || challenge.consumedAt || challenge.expiresAt.getTime() <= Date.now()) {
                return { ok: false, reason: 'expired' };
            }
            if (challenge.attempts >= limits.otpAttempts)
                return { ok: false, reason: 'locked' };
            if (!(0, crypto_1.safeEqual)(challenge.codeHash, this.hash(phone, code))) {
                const attempts = challenge.attempts + 1;
                await tx.update(schema_1.otpChallenges).set({ attempts }).where((0, drizzle_orm_1.eq)(schema_1.otpChallenges.id, challenge.id));
                return {
                    ok: false,
                    reason: 'wrong',
                    attemptsLeft: Math.max(0, limits.otpAttempts - attempts),
                };
            }
            await tx.update(schema_1.otpChallenges).set({ consumedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.otpChallenges.id, challenge.id));
            return { ok: true };
        });
        if (outcome.ok)
            return;
        if (outcome.reason === 'expired')
            throw (0, errors_1.badRequest)('otp_expired', 'This code has expired. Ask for a new one.');
        if (outcome.reason === 'locked')
            throw (0, errors_1.tooMany)('otp_attempts_exceeded', 'Too many wrong codes. Ask for a new one.');
        throw (0, errors_1.badRequest)('otp_invalid', 'That code is not right', { attemptsLeft: outcome.attemptsLeft });
    }
};
exports.OtpService = OtpService;
exports.OtpService = OtpService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DB)),
    __param(1, (0, common_1.Inject)(app_config_1.APP_CONFIG)),
    __param(2, (0, common_1.Inject)(messaging_1.MESSAGING)),
    __metadata("design:paramtypes", [Object, Object, Object, countries_service_1.CountriesService])
], OtpService);
//# sourceMappingURL=otp.service.js.map