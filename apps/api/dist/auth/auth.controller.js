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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const zod_1 = require("zod");
const schema_1 = require("../db/schema");
const zod_body_1 = require("../common/zod-body");
const realtime_gateway_1 = require("../realtime/realtime.gateway");
const auth_service_1 = require("./auth.service");
const auth_guard_1 = require("./auth.guard");
const Phone = zod_1.z.string().trim().min(5).max(20);
const RequestCodeBody = zod_1.z.object({ phone: Phone });
const VerifyCodeBody = zod_1.z.object({
    phone: Phone,
    code: zod_1.z.string().regex(/^\d{6}$/, 'The code is 6 digits'),
    app: zod_1.z.enum(schema_1.APPS),
    device: zod_1.z.object({
        key: zod_1.z.string().min(8).max(128),
        platform: zod_1.z.enum(['ios', 'android', 'web']),
        name: zod_1.z.string().max(80).optional(),
    }),
});
const RefreshBody = zod_1.z.object({ refreshToken: zod_1.z.string().min(20).max(200) });
let AuthController = class AuthController {
    auth;
    realtime;
    constructor(auth, realtime) {
        this.auth = auth;
        this.realtime = realtime;
    }
    request(body, req) {
        return this.auth.requestCode(body.phone, req.ip ?? null);
    }
    verify(body) {
        return this.auth.verifyCode(body.phone, body.code, body.app, body.device);
    }
    refresh(body) {
        return this.auth.refresh(body.refreshToken);
    }
    async logout(auth) {
        await this.auth.logout(auth);
        this.realtime.disconnectWhere((s) => s.sessionId === auth.sessionId);
    }
    async logoutOthers(auth) {
        await this.auth.logoutOthers(auth);
        this.realtime.disconnectWhere((s) => s.userId === auth.userId && s.sessionId !== auth.sessionId);
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, common_1.Post)('otp/request'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)(new zod_body_1.ZodBody(RequestCodeBody))),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [void 0, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "request", null);
__decorate([
    (0, common_1.Post)('otp/verify'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)(new zod_body_1.ZodBody(VerifyCodeBody))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [void 0]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "verify", null);
__decorate([
    (0, common_1.Post)('refresh'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)(new zod_body_1.ZodBody(RefreshBody))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [void 0]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, common_1.Post)('logout'),
    (0, common_1.HttpCode)(204),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logout", null);
__decorate([
    (0, common_1.Post)('logout-others'),
    (0, common_1.HttpCode)(204),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "logoutOthers", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [auth_service_1.AuthService,
        realtime_gateway_1.RealtimeGateway])
], AuthController);
//# sourceMappingURL=auth.controller.js.map