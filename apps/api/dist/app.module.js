"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const adapters_module_1 = require("./adapters/adapters.module");
const auth_module_1 = require("./auth/auth.module");
const chat_module_1 = require("./chat/chat.module");
const app_config_1 = require("./config/app-config");
const countries_module_1 = require("./countries/countries.module");
const database_module_1 = require("./db/database.module");
const errands_module_1 = require("./errands/errands.module");
const health_controller_1 = require("./health/health.controller");
const push_module_1 = require("./push/push.module");
const realtime_module_1 = require("./realtime/realtime.module");
const timers_module_1 = require("./timers/timers.module");
const users_module_1 = require("./users/users.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            app_config_1.ConfigModule,
            database_module_1.DatabaseModule,
            adapters_module_1.AdaptersModule,
            timers_module_1.TimersModule,
            countries_module_1.CountriesModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            push_module_1.PushModule,
            realtime_module_1.RealtimeModule,
            chat_module_1.ChatModule,
            errands_module_1.ErrandsModule,
        ],
        controllers: [health_controller_1.HealthController],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map