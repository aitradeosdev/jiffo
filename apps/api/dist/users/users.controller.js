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
exports.UsersController = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const zod_1 = require("zod");
const database_module_1 = require("../db/database.module");
const schema_1 = require("../db/schema");
const auth_guard_1 = require("../auth/auth.guard");
const auth_service_1 = require("../auth/auth.service");
const zod_body_1 = require("../common/zod-body");
const errors_1 = require("../common/errors");
const Name = zod_1.z.string().trim().min(1).max(50);
const UpdateMeBody = zod_1.z
    .object({
    firstName: Name,
    lastName: Name,
    email: zod_1.z.string().trim().toLowerCase().email().max(254).nullable(),
})
    .partial()
    .refine((b) => Object.keys(b).length > 0, 'Nothing to update');
let UsersController = class UsersController {
    db;
    constructor(db) {
        this.db = db;
    }
    async me(auth) {
        const [user] = await this.db.select().from(schema_1.users).where((0, drizzle_orm_1.eq)(schema_1.users.id, auth.userId));
        if (!user)
            throw (0, errors_1.notFound)('user_not_found', 'Account not found');
        return (0, auth_service_1.publicUser)(user);
    }
    async update(auth, body) {
        const [user] = await this.db
            .update(schema_1.users)
            .set({ ...body, updatedAt: new Date() })
            .where((0, drizzle_orm_1.eq)(schema_1.users.id, auth.userId))
            .returning();
        if (!user)
            throw (0, errors_1.notFound)('user_not_found', 'Account not found');
        return (0, auth_service_1.publicUser)(user);
    }
};
exports.UsersController = UsersController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "me", null);
__decorate([
    (0, common_1.Patch)(),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __param(1, (0, common_1.Body)(new zod_body_1.ZodBody(UpdateMeBody))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", Promise)
], UsersController.prototype, "update", null);
exports.UsersController = UsersController = __decorate([
    (0, common_1.Controller)('me'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __param(0, (0, common_1.Inject)(database_module_1.DB)),
    __metadata("design:paramtypes", [Object])
], UsersController);
//# sourceMappingURL=users.controller.js.map