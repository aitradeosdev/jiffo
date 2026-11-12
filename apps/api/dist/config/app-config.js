"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigModule = exports.APP_CONFIG = void 0;
exports.loadConfig = loadConfig;
const common_1 = require("@nestjs/common");
const zod_1 = require("zod");
const EnvSchema = zod_1.z
    .object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    PORT: zod_1.z.coerce.number().int().positive().default(3000),
    DATABASE_URL: zod_1.z.string().url(),
    JWT_SECRET: zod_1.z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    OTP_SECRET: zod_1.z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
    PIN_KEY: zod_1.z.string().regex(/^[0-9a-f]{64}$/i, 'PIN_KEY must be 32 bytes written as 64 hex characters'),
    ACCESS_TOKEN_TTL_SECONDS: zod_1.z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: zod_1.z.coerce.number().int().positive().default(30),
    DEFAULT_COUNTRY: zod_1.z.string().length(2).default('NG'),
    MESSAGING_PROVIDER: zod_1.z.enum(['console', 'memory', 'termii']).default('console'),
    TERMII_API_KEY: zod_1.z.string().optional(),
    TERMII_SENDER_ID: zod_1.z.string().optional(),
    TERMII_BASE_URL: zod_1.z.string().url().default('https://api.ng.termii.com'),
    PUSH_PROVIDER: zod_1.z.enum(['console', 'memory', 'fcm']).default('console'),
    FCM_SERVICE_ACCOUNT_JSON: zod_1.z.string().optional(),
    CHAT_PROVIDER: zod_1.z.enum(['builtin']).default('builtin'),
    /** Errand timers (item lock, auto-release, unreachable, urgent expiry). memory is for tests only. */
    TIMER_PROVIDER: zod_1.z.enum(['bullmq', 'memory']).default('bullmq'),
    REDIS_URL: zod_1.z.string().url().default('redis://localhost:6379'),
    /** Code requests allowed from one IP address per hour, across all phone numbers. */
    OTP_PER_IP_PER_HOUR: zod_1.z.coerce.number().int().positive().default(30),
    /** Load balancers in front of the API, so the client IP is read from X-Forwarded-For correctly. */
    TRUST_PROXY_HOPS: zod_1.z.coerce.number().int().min(0).default(0),
    CORS_ORIGINS: zod_1.z.string().default('*'),
    RUN_MIGRATIONS: zod_1.z
        .enum(['true', 'false'])
        .default('false')
        .transform((v) => v === 'true'),
})
    .superRefine((env, ctx) => {
    const need = (ok, path, message) => {
        if (!ok)
            ctx.addIssue({ code: zod_1.z.ZodIssueCode.custom, path: [path], message });
    };
    if (env.MESSAGING_PROVIDER === 'termii') {
        need(!!env.TERMII_API_KEY, 'TERMII_API_KEY', 'required when MESSAGING_PROVIDER is termii');
        need(!!env.TERMII_SENDER_ID, 'TERMII_SENDER_ID', 'required when MESSAGING_PROVIDER is termii');
    }
    if (env.PUSH_PROVIDER === 'fcm') {
        need(!!env.FCM_SERVICE_ACCOUNT_JSON, 'FCM_SERVICE_ACCOUNT_JSON', 'required when PUSH_PROVIDER is fcm');
    }
    if (env.NODE_ENV === 'production') {
        need(env.MESSAGING_PROVIDER !== 'console' && env.MESSAGING_PROVIDER !== 'memory', 'MESSAGING_PROVIDER', 'must be a real provider in production');
        need(env.PUSH_PROVIDER !== 'console' && env.PUSH_PROVIDER !== 'memory', 'PUSH_PROVIDER', 'must be a real provider in production');
        need(env.TIMER_PROVIDER !== 'memory', 'TIMER_PROVIDER', 'must be bullmq in production');
    }
});
exports.APP_CONFIG = Symbol('APP_CONFIG');
function loadConfig(env = process.env) {
    const parsed = EnvSchema.safeParse(env);
    if (!parsed.success) {
        const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new Error(`Invalid environment: ${problems}`);
    }
    return parsed.data;
}
let ConfigModule = class ConfigModule {
};
exports.ConfigModule = ConfigModule;
exports.ConfigModule = ConfigModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        providers: [{ provide: exports.APP_CONFIG, useFactory: () => loadConfig() }],
        exports: [exports.APP_CONFIG],
    })
], ConfigModule);
//# sourceMappingURL=app-config.js.map