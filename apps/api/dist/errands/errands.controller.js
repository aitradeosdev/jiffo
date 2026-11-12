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
exports.ErrandsController = void 0;
const common_1 = require("@nestjs/common");
const auth_guard_1 = require("../auth/auth.guard");
const zod_body_1 = require("../common/zod-body");
const params_1 = require("../common/params");
const errand_input_1 = require("./errand-input");
const errands_service_1 = require("./errands.service");
let ErrandsController = class ErrandsController {
    errands;
    constructor(errands) {
        this.errands = errands;
    }
    create(auth, body) {
        return this.errands.create(auth, body);
    }
    list(auth, q) {
        return this.errands.listMine(auth, q.before, q.limit);
    }
    board(auth, q) {
        return this.errands.board(auth, q);
    }
    get(auth, id) {
        return this.errands.get(id, auth);
    }
    events(auth, id) {
        return this.errands.events(id, auth);
    }
    pin(auth, id) {
        return this.errands.pin(id, auth);
    }
    transition(auth, id, body) {
        return this.errands.transition(id, auth, body);
    }
};
exports.ErrandsController = ErrandsController;
__decorate([
    (0, common_1.Post)(),
    (0, auth_guard_1.Apps)('customer'),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __param(1, (0, common_1.Body)(new zod_body_1.ZodBody(errand_input_1.CreateErrandBody))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], ErrandsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __param(1, (0, common_1.Query)(new zod_body_1.ZodBody(errand_input_1.ListQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], ErrandsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('board'),
    (0, auth_guard_1.Apps)('agent'),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __param(1, (0, common_1.Query)(new zod_body_1.ZodBody(errand_input_1.BoardQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], ErrandsController.prototype, "board", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __param(1, (0, common_1.Param)('id', params_1.ErrandId)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ErrandsController.prototype, "get", null);
__decorate([
    (0, common_1.Get)(':id/events'),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __param(1, (0, common_1.Param)('id', params_1.ErrandId)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ErrandsController.prototype, "events", null);
__decorate([
    (0, common_1.Get)(':id/pin'),
    (0, auth_guard_1.Apps)('customer'),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __param(1, (0, common_1.Param)('id', params_1.ErrandId)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ErrandsController.prototype, "pin", null);
__decorate([
    (0, common_1.Post)(':id/events'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, auth_guard_1.CurrentAuth)()),
    __param(1, (0, common_1.Param)('id', params_1.ErrandId)),
    __param(2, (0, common_1.Body)(new zod_body_1.ZodBody(errand_input_1.ErrandEventBody))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], ErrandsController.prototype, "transition", null);
exports.ErrandsController = ErrandsController = __decorate([
    (0, common_1.Controller)('errands'),
    (0, common_1.UseGuards)(auth_guard_1.AuthGuard),
    __metadata("design:paramtypes", [errands_service_1.ErrandsService])
], ErrandsController);
//# sourceMappingURL=errands.controller.js.map