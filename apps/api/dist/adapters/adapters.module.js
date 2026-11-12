"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdaptersModule = void 0;
const common_1 = require("@nestjs/common");
const app_config_1 = require("../config/app-config");
const database_module_1 = require("../db/database.module");
const builtin_chat_adapter_1 = require("../chat/builtin-chat.adapter");
const chat_1 = require("./chat");
const messaging_1 = require("./messaging");
const push_1 = require("./push");
/**
 * Picks one implementation per port from the environment. Admin-selected providers (identity, payments)
 * build on the same ports later.
 */
let AdaptersModule = class AdaptersModule {
};
exports.AdaptersModule = AdaptersModule;
exports.AdaptersModule = AdaptersModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [
            {
                provide: messaging_1.MESSAGING,
                inject: [app_config_1.APP_CONFIG],
                useFactory: (c) => {
                    switch (c.MESSAGING_PROVIDER) {
                        case 'termii':
                            return new messaging_1.TermiiMessagingAdapter(c.TERMII_API_KEY, c.TERMII_SENDER_ID, c.TERMII_BASE_URL);
                        case 'memory':
                            return new messaging_1.MemoryMessagingAdapter();
                        default:
                            return new messaging_1.ConsoleMessagingAdapter();
                    }
                },
            },
            {
                provide: push_1.PUSH,
                inject: [app_config_1.APP_CONFIG],
                useFactory: (c) => {
                    switch (c.PUSH_PROVIDER) {
                        case 'fcm':
                            return new push_1.FcmPushAdapter(c.FCM_SERVICE_ACCOUNT_JSON);
                        case 'memory':
                            return new push_1.MemoryPushAdapter();
                        default:
                            return new push_1.ConsolePushAdapter();
                    }
                },
            },
            {
                provide: chat_1.CHAT,
                inject: [database_module_1.DB],
                useFactory: (db) => new builtin_chat_adapter_1.BuiltinChatAdapter(db),
            },
        ],
        exports: [messaging_1.MESSAGING, push_1.PUSH, chat_1.CHAT],
    })
], AdaptersModule);
//# sourceMappingURL=adapters.module.js.map