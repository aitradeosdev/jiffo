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
exports.ChatController = void 0;
const common_1 = require("@nestjs/common");
const zod_1 = require("zod");
const auth_guard_1 = require("../auth/auth.guard");
const zod_body_1 = require("../common/zod-body");
const params_1 = require("../common/params");
const chat_service_1 = require("./chat.service");
const SendBody = zod_1.z.object({
    body: zod_1.z.string().trim().min(1).max(2000),
    /** Set by the app per message, so a retried send never shows twice. */
    clientId: zod_1.z.string().min(1).max(64),
});
const ListQuery = zod_1.z.object({
    after: zod_1.z.coerce.number().int().positive().optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(200).default(50),
});
let ChatController = class ChatController {
    chat;
    constructor(chat) {
        this.chat = chat;
    }
    list(auth, id, query) {
        return this.chat.list(id, auth, query.after, query.limit);
    }
    send(auth, id, body) {
        return this.chat.send(id, auth, body);
    }
};
exports.ChatController = ChatController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __param(1, (0, common_1.Param)('id', params_1.ErrandId)),
    __param(2, (0, common_1.Query)(new zod_body_1.ZodBody(ListQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __param(1, (0, common_1.Param)('id', params_1.ErrandId)),
    __param(2, (0, common_1.Body)(new zod_body_1.ZodBody(SendBody))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], ChatController.prototype, "send", null);
exports.ChatController = ChatController = __decorate([
    (0, common_1.Controller)('errands/:id/messages'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __metadata("design:paramtypes", [chat_service_1.ChatService])
], ChatController);
//# sourceMappingURL=chat.controller.js.map