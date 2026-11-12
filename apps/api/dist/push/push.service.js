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
var PushService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushService = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const database_module_1 = require("../db/database.module");
const schema_1 = require("../db/schema");
const push_1 = require("../adapters/push");
let PushService = PushService_1 = class PushService {
    db;
    push;
    logger = new common_1.Logger(PushService_1.name);
    constructor(db, push) {
        this.db = db;
        this.push = push;
    }
    async setToken(deviceId, token) {
        // A token belongs to one install: if it moved to another account on the same phone, take it off the old one.
        if (token) {
            await this.db
                .update(schema_1.devices)
                .set({ pushToken: null, pushUpdatedAt: new Date() })
                .where((0, drizzle_orm_1.eq)(schema_1.devices.pushToken, token));
        }
        await this.db.update(schema_1.devices).set({ pushToken: token, pushUpdatedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.devices.id, deviceId));
    }
    /** Sends to every signed-in phone the person has for that app. Push failures never fail the caller. */
    async notifyUser(userId, app, notification) {
        try {
            const rows = await this.db
                .selectDistinct({ token: schema_1.devices.pushToken })
                .from(schema_1.devices)
                .innerJoin(schema_1.sessions, (0, drizzle_orm_1.eq)(schema_1.sessions.deviceId, schema_1.devices.id))
                .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.devices.userId, userId), (0, drizzle_orm_1.eq)(schema_1.devices.app, app), (0, drizzle_orm_1.isNotNull)(schema_1.devices.pushToken), (0, drizzle_orm_1.isNull)(schema_1.sessions.revokedAt), (0, drizzle_orm_1.gt)(schema_1.sessions.expiresAt, new Date())));
            const tokens = rows.map((r) => r.token);
            if (tokens.length === 0)
                return;
            const { invalidTokens } = await this.push.send(tokens, notification);
            if (invalidTokens.length > 0) {
                await this.db
                    .update(schema_1.devices)
                    .set({ pushToken: null, pushUpdatedAt: new Date() })
                    .where((0, drizzle_orm_1.inArray)(schema_1.devices.pushToken, invalidTokens));
            }
        }
        catch (error) {
            this.logger.warn(`Push to ${userId} failed: ${error.message}`);
        }
    }
};
exports.PushService = PushService;
exports.PushService = PushService = PushService_1 = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DB)),
    __param(1, (0, common_1.Inject)(push_1.PUSH)),
    __metadata("design:paramtypes", [Object, Object])
], PushService);
//# sourceMappingURL=push.service.js.map