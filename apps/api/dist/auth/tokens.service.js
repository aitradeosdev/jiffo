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
exports.TokensService = void 0;
const common_1 = require("@nestjs/common");
const jose_1 = require("jose");
const app_config_1 = require("../config/app-config");
const schema_1 = require("../db/schema");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const ISSUER = 'jiffo';
const AUDIENCE = 'jiffo-api';
let TokensService = class TokensService {
    config;
    key;
    constructor(config) {
        this.config = config;
        this.key = new TextEncoder().encode(config.JWT_SECRET);
    }
    get accessTtlSeconds() {
        return this.config.ACCESS_TOKEN_TTL_SECONDS;
    }
    signAccess(auth) {
        return new jose_1.SignJWT({ sid: auth.sessionId, did: auth.deviceId, app: auth.app })
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject(auth.userId)
            .setIssuer(ISSUER)
            .setAudience(AUDIENCE)
            .setIssuedAt()
            .setExpirationTime(`${this.config.ACCESS_TOKEN_TTL_SECONDS}s`)
            .sign(this.key);
    }
    /** Checks the signature and expiry only. AuthGuard also checks the session is still live. */
    async verifyAccess(token) {
        try {
            const { payload } = await (0, jose_1.jwtVerify)(token, this.key, {
                issuer: ISSUER,
                audience: AUDIENCE,
                algorithms: ['HS256'],
            });
            const app = payload.app;
            if (!payload.sub || typeof payload.sid !== 'string' || typeof payload.did !== 'string' || !schema_1.APPS.includes(app)) {
                throw new Error('Missing claims');
            }
            return { userId: payload.sub, sessionId: payload.sid, deviceId: payload.did, app };
        }
        catch {
            throw (0, errors_1.unauthorized)('invalid_token', 'Sign in again');
        }
    }
    /** A new refresh token and the hash stored for it. Only the hash is kept. */
    newRefreshToken() {
        const token = (0, crypto_1.randomToken)();
        return { token, hash: (0, crypto_1.sha256)(token) };
    }
};
exports.TokensService = TokensService;
exports.TokensService = TokensService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(app_config_1.APP_CONFIG)),
    __metadata("design:paramtypes", [Object])
], TokensService);
//# sourceMappingURL=tokens.service.js.map