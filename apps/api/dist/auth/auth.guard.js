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
exports.CurrentAuth = exports.AuthGuard = exports.SessionVerifier = exports.Apps = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../db/database.module");
const schema_1 = require("../db/schema");
const errors_1 = require("../common/errors");
const tokens_service_1 = require("./tokens.service");
const APPS_KEY = 'jiffo:apps';
/** Limits a route to sessions from these apps, e.g. @Apps('agent') for the job board. */
const Apps = (...apps) => (0, common_1.SetMetadata)(APPS_KEY, apps);
exports.Apps = Apps;
let SessionVerifier = class SessionVerifier {
    db;
    tokens;
    constructor(db, tokens) {
        this.db = db;
        this.tokens = tokens;
    }
    /** Checks the token and that its session is still live and the account active. */
    async verify(token) {
        const auth = await this.tokens.verifyAccess(token);
        const [row] = await this.db
            .select({ revokedAt: schema_1.sessions.revokedAt, expiresAt: schema_1.sessions.expiresAt, status: schema_1.users.status })
            .from(schema_1.sessions)
            .innerJoin(schema_1.users, (0, drizzle_orm_1.eq)(schema_1.users.id, schema_1.sessions.userId))
            .where((0, drizzle_orm_1.eq)(schema_1.sessions.id, auth.sessionId));
        if (!row || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
            throw (0, errors_1.unauthorized)('session_ended', 'Sign in again');
        }
        if (row.status !== 'active')
            throw (0, errors_1.forbidden)('account_suspended', 'This account is suspended. Contact support.');
        return auth;
    }
};
exports.SessionVerifier = SessionVerifier;
exports.SessionVerifier = SessionVerifier = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DB)),
    __metadata("design:paramtypes", [Object, tokens_service_1.TokensService])
], SessionVerifier);
let AuthGuard = class AuthGuard {
    verifier;
    reflector;
    constructor(verifier, reflector) {
        this.verifier = verifier;
        this.reflector = reflector;
    }
    async canActivate(context) {
        const req = context.switchToHttp().getRequest();
        const [scheme, token] = (req.headers.authorization ?? '').split(' ');
        if (scheme?.toLowerCase() !== 'bearer' || !token)
            throw (0, errors_1.unauthorized)('missing_token', 'Sign in to continue');
        req.auth = await this.verifier.verify(token);
        const apps = this.reflector.getAllAndOverride(APPS_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (apps && !apps.includes(req.auth.app))
            throw (0, errors_1.forbidden)('wrong_app', `Use the ${apps.join(' or ')} app for this`);
        return true;
    }
};
exports.AuthGuard = AuthGuard;
exports.AuthGuard = AuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [SessionVerifier,
        core_1.Reflector])
], AuthGuard);
/** The signed-in caller. Only valid on routes behind AuthGuard. */
exports.CurrentAuth = (0, common_1.createParamDecorator)((_, context) => {
    const auth = context.switchToHttp().getRequest().auth;
    if (!auth)
        throw (0, errors_1.unauthorized)('missing_token', 'Sign in to continue');
    return auth;
});
//# sourceMappingURL=auth.guard.js.map