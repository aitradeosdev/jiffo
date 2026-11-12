"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimersModule = void 0;
const common_1 = require("@nestjs/common");
const app_config_1 = require("../config/app-config");
const errand_timers_1 = require("./errand-timers");
let TimersModule = class TimersModule {
};
exports.TimersModule = TimersModule;
exports.TimersModule = TimersModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            {
                provide: errand_timers_1.ERRAND_TIMERS,
                inject: [app_config_1.APP_CONFIG],
                useFactory: (c) => c.TIMER_PROVIDER === 'memory' ? new errand_timers_1.MemoryErrandTimers() : new errand_timers_1.BullMqErrandTimers(c),
            },
        ],
        exports: [errand_timers_1.ERRAND_TIMERS],
    })
], TimersModule);
//# sourceMappingURL=timers.module.js.map