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
exports.AuthService = exports.publicUser = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const app_config_1 = require("../config/app-config");
const database_module_1 = require("../db/database.module");
const schema_1 = require("../db/schema");
const countries_service_1 = require("../countries/countries.service");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const phone_1 = require("./phone");
const otp_service_1 = require("./otp.service");
const tokens_service_1 = require("./tokens.service");
const DAY_MS = 86_400_000;
const publicUser = (u) => ({
    id: u.id,
    phone: u.phone,
    countryCode: u.countryCode,
    firstName: u.firstName,
    lastName: u.lastName,
    email: u.email,
    createdAt: u.createdAt,
});
exports.publicUser = publicUser;
let AuthService = class AuthService {
    db;
    config;
    countries;
    otp;
    tokens;
    constructor(db, config, countries, otp, tokens) {
        this.db = db;
        this.config = config;
        this.countries = countries;
        this.otp = otp;
        this.tokens = tokens;
    }
    async resolvePhone(input) {
        const { e164, country } = (0, phone_1.normalisePhone)(input, this.config.DEFAULT_COUNTRY);
        await this.countries.enabledCountry(country);
        return { phone: e164, country };
    }
    async requestCode(phoneInput, ip) {
        const { phone, country } = await this.resolvePhone(phoneInput);
        return { phone, ...(await this.otp.request(phone, country, ip)) };
    }
    /** Signs in with a code. The same phone number is one account across both apps. */
    async verifyCode(phoneInput, code, app, device) {
        const { phone, country } = await this.resolvePhone(phoneInput);
        await this.otp.verify(phone, country, code);
        return this.db.transaction(async (tx) => {
            const inserted = await tx
                .insert(schema_1.users)
                .values({ phone, countryCode: country })
                .onConflictDoNothing({ target: schema_1.users.phone })
                .returning();
            const user = inserted[0] ?? (await tx.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.phone, phone)))[0];
            if (user.status !== 'active')
                throw (0, errors_1.forbidden)('account_suspended', 'This account is suspended. Contact support.');
            const [deviceRow] = await tx
                .insert(schema_1.devices)
                .values({ userId: user.id, deviceKey: device.key, app, platform: device.platform, name: device.name ?? null })
                .onConflictDoUpdate({
                target: [schema_1.devices.userId, schema_1.devices.deviceKey, schema_1.devices.app],
                set: { platform: device.platform, name: device.name ?? null, lastSeenAt: new Date() },
            })
                .returning();
            // Signing in again on the same phone replaces the old session there.
            await tx
                .update(schema_1.sessions)
                .set({ revokedAt: new Date(), revokedReason: 'replaced' })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sessions.deviceId, deviceRow.id), (0, drizzle_orm_1.isNull)(schema_1.sessions.revokedAt)));
            const [session] = await tx
                .insert(schema_1.sessions)
                .values({
                userId: user.id,
                deviceId: deviceRow.id,
                app,
                expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
            })
                .returning();
            const auth = { userId: user.id, sessionId: session.id, deviceId: deviceRow.id, app };
            return {
                ...(await this.issue(tx, auth)),
                user: (0, exports.publicUser)(user),
                isNewUser: inserted.length > 0,
            };
        });
    }
    /** Swaps a refresh token for a new pair. A token that was already used revokes the whole session. */
    async refresh(refreshToken) {
        const hash = (0, crypto_1.sha256)(refreshToken);
        const result = await this.db.transaction(async (tx) => {
            const [row] = await tx
                .select({ token: schema_1.refreshTokens, session: schema_1.sessions })
                .from(schema_1.refreshTokens)
                .innerJoin(schema_1.sessions, (0, drizzle_orm_1.eq)(schema_1.sessions.id, schema_1.refreshTokens.sessionId))
                .where((0, drizzle_orm_1.eq)(schema_1.refreshTokens.tokenHash, hash))
                .for('update');
            if (!row)
                return { error: 'invalid' };
            const { token, session } = row;
            if (session.revokedAt || session.expiresAt.getTime() <= Date.now())
                return { error: 'invalid' };
            if (token.usedAt) {
                await tx
                    .update(schema_1.sessions)
                    .set({ revokedAt: new Date(), revokedReason: 'refresh_reuse' })
                    .where((0, drizzle_orm_1.eq)(schema_1.sessions.id, session.id));
                return { error: 'reused' };
            }
            if (token.expiresAt.getTime() <= Date.now())
                return { error: 'invalid' };
            await tx.update(schema_1.refreshTokens).set({ usedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.refreshTokens.id, token.id));
            await tx
                .update(schema_1.sessions)
                .set({ expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * DAY_MS) })
                .where((0, drizzle_orm_1.eq)(schema_1.sessions.id, session.id));
            await tx.update(schema_1.devices).set({ lastSeenAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.devices.id, session.deviceId));
            const auth = {
                userId: session.userId,
                sessionId: session.id,
                deviceId: session.deviceId,
                app: session.app,
            };
            return { tokens: await this.issue(tx, auth) };
        });
        if ('tokens' in result)
            return result.tokens;
        if (result.error === 'reused') {
            throw (0, errors_1.unauthorized)('refresh_token_reused', 'This sign-in was used somewhere else. Sign in again.');
        }
        throw (0, errors_1.unauthorized)('invalid_refresh_token', 'Sign in again');
    }
    /** Ends this session and stops push notifications to this phone. */
    async logout(auth) {
        await this.db.transaction(async (tx) => {
            await tx
                .update(schema_1.sessions)
                .set({ revokedAt: new Date(), revokedReason: 'logout' })
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sessions.id, auth.sessionId), (0, drizzle_orm_1.isNull)(schema_1.sessions.revokedAt)));
            await tx.update(schema_1.devices).set({ pushToken: null, pushUpdatedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.devices.id, auth.deviceId));
        });
    }
    /** Signs out every other phone, e.g. after the account owner reports a lost phone. */
    async logoutOthers(auth) {
        await this.db
            .update(schema_1.sessions)
            .set({ revokedAt: new Date(), revokedReason: 'logout_others' })
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.sessions.userId, auth.userId), (0, drizzle_orm_1.ne)(schema_1.sessions.id, auth.sessionId), (0, drizzle_orm_1.isNull)(schema_1.sessions.revokedAt)));
    }
    async issue(tx, auth) {
        const refresh = this.tokens.newRefreshToken();
        await tx.insert(schema_1.refreshTokens).values({
            sessionId: auth.sessionId,
            tokenHash: refresh.hash,
            expiresAt: new Date(Date.now() + this.config.REFRESH_TOKEN_TTL_DAYS * DAY_MS),
        });
        return {
            accessToken: await this.tokens.signAccess(auth),
            accessTokenExpiresIn: this.tokens.accessTtlSeconds,
            refreshToken: refresh.token,
        };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DB)),
    __param(1, (0, common_1.Inject)(app_config_1.APP_CONFIG)),
    __metadata("design:paramtypes", [Object, Object, countries_service_1.CountriesService,
        otp_service_1.OtpService,
        tokens_service_1.TokensService])
], AuthService);
//# sourceMappingURL=auth.service.js.map