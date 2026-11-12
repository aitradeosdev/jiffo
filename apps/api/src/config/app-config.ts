import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
    PIN_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'PIN_KEY must be 32 bytes written as 64 hex characters'),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    DEFAULT_COUNTRY: z.string().length(2).default('NG'),
    MESSAGING_PROVIDER: z.enum(['console', 'memory', 'termii']).default('console'),
    TERMII_API_KEY: z.string().optional(),
    TERMII_SENDER_ID: z.string().optional(),
    TERMII_BASE_URL: z.string().url().default('https://api.ng.termii.com'),
    PUSH_PROVIDER: z.enum(['console', 'memory', 'fcm']).default('console'),
    FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
    CHAT_PROVIDER: z.enum(['builtin']).default('builtin'),
    /** Errand timers (item lock, auto-release, unreachable, urgent expiry). memory is for tests only. */
    TIMER_PROVIDER: z.enum(['bullmq', 'memory']).default('bullmq'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    /** Code requests allowed from one IP address per hour, across all phone numbers. */
    OTP_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(30),
    /** Load balancers in front of the API, so the client IP is read from X-Forwarded-For correctly. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    CORS_ORIGINS: z.string().default('*'),
    RUN_MIGRATIONS: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })
  .superRefine((env, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    if (env.MESSAGING_PROVIDER === 'termii') {
      need(!!env.TERMII_API_KEY, 'TERMII_API_KEY', 'required when MESSAGING_PROVIDER is termii');
      need(!!env.TERMII_SENDER_ID, 'TERMII_SENDER_ID', 'required when MESSAGING_PROVIDER is termii');
    }
    if (env.PUSH_PROVIDER === 'fcm') {
      need(!!env.FCM_SERVICE_ACCOUNT_JSON, 'FCM_SERVICE_ACCOUNT_JSON', 'required when PUSH_PROVIDER is fcm');
    }
    if (env.NODE_ENV === 'production') {
      need(
        env.MESSAGING_PROVIDER !== 'console' && env.MESSAGING_PROVIDER !== 'memory',
        'MESSAGING_PROVIDER',
        'must be a real provider in production',
      );
      need(
        env.PUSH_PROVIDER !== 'console' && env.PUSH_PROVIDER !== 'memory',
        'PUSH_PROVIDER',
        'must be a real provider in production',
      );
      need(env.TIMER_PROVIDER !== 'memory', 'TIMER_PROVIDER', 'must be bullmq in production');
    }
  });

export type AppConfig = z.infer<typeof EnvSchema>;
export const APP_CONFIG = Symbol('APP_CONFIG');

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  return parsed.data;
}

@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: () => loadConfig() }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
