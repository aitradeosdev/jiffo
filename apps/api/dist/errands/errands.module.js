"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrandsModule = void 0;
const common_1 = require("@nestjs/common");
const chat_module_1 = require("../chat/chat.module");
const errand_notifier_1 = require("./errand-notifier");
const errands_controller_1 = require("./errands.controller");
const errands_service_1 = require("./errands.service");
let ErrandsModule = class ErrandsModule {
};
exports.ErrandsModule = ErrandsModule;
exports.ErrandsModule = ErrandsModule = __decorate([
    (0, common_1.Module)({
        imports: [chat_module_1.ChatModule],
        controllers: [errands_controller_1.ErrandsController],
        providers: [errands_service_1.ErrandsService, errand_notifier_1.ErrandNotifier],
    })
], ErrandsModule);
//# sourceMappingURL=errands.module.js.map