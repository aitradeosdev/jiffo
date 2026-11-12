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
exports.PushController = void 0;
const common_1 = require("@nestjs/common");
const zod_1 = require("zod");
const auth_guard_1 = require("../auth/auth.guard");
const zod_body_1 = require("../common/zod-body");
const push_service_1 = require("./push.service");
const PushTokenBody = zod_1.z.object({ token: zod_1.z.string().min(10).max(4096).nullable() });
let PushController = class PushController {
    push;
    constructor(push) {
        this.push = push;
    }
    /** The app sends its push token after sign-in and whenever it changes; null switches push off. */
    async setToken(auth, body) {
        await this.push.setToken(auth.deviceId, body.token);
    }
};
exports.PushController = PushController;
__decorate([
    (0, common_1.Put)('push-token'),
    (0, common_1.HttpCode)(204),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __param(1, (0, common_1.Body)(new zod_body_1.ZodBody(PushTokenBody))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", Promise)
], PushController.prototype, "setToken", null);
exports.PushController = PushController = __decorate([
    (0, common_1.Controller)('devices/current'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __metadata("design:paramtypes", [push_service_1.PushService])
], PushController);
//# sourceMappingURL=push.controller.js.map