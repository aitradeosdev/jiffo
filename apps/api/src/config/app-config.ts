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
    MAPS_PROVIDER: z.enum(['google', 'fake']).default('fake'),
    /** memory keeps files in the API process: development and tests only. */
    STORAGE_PROVIDER: z.enum(['s3', 'memory']).default('memory'),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().default('af-south-1'),
    /** For S3-compatible stores other than AWS. */
    S3_ENDPOINT: z.string().url().optional(),
    /** The API's own address as the apps reach it. Used for development file links. */
    PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
    GOOGLE_MAPS_API_KEY: z.string().optional(),
    PAYMENTS_PROVIDER: z.enum(['paystack', 'fake']).default('fake'),
    /**
     * Identity checks for agents. "none" turns them off: agents can't send applications until a provider is
     * set up. Only the fake exists until the real provider's keys and SDK are in, and it never runs in
     * production.
     */
    IDENTITY_PROVIDER: z.enum(['fake', 'none']).default('fake'),
    PAYSTACK_SECRET_KEY: z.string().optional(),
    PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'),
    /** The fake provider signs its webhooks with this, so the webhook endpoint runs as in production. */
    FAKE_PAYMENTS_SECRET: z.string().default('fake-payments-secret'),
    /** Development only: the fake provider settles each top-up this many seconds after it starts. 0 is off. */
    FAKE_PAYMENTS_AUTOPAY_SECONDS: z.coerce.number().int().min(0).default(0),
    /**
     * Paystack needs an email on every charge. Customers sign in by phone, so each gets an address
     * on this domain built from their account id. No personal details go in it. It must be a domain
     * Jiffo owns, since Paystack may send receipts to it.
     */
    PAYMENT_EMAIL_DOMAIN: z.string().default('customers.jiffoapp.com'),
    /** When the free daily withdrawals go out, and when the ledger is checked against the provider (UTC). */
    PAYOUT_CRON: z.string().default('0 15 * * *'),
    RECONCILE_CRON: z.string().default('30 23 * * *'),
    /** Releases due earnings, retries instant withdrawals and checks quiet transfers. */
    PAYOUT_RETRY_CRON: z.string().default('*/5 * * * *'),
    /** Errand timers (item lock, auto-release, unreachable, urgent expiry). memory is for tests only. */
    TIMER_PROVIDER: z.enum(['bullmq', 'memory']).default('bullmq'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    /** Code requests allowed from one IP address per hour, across all phone numbers. */
    OTP_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(30),
    /** Load balancers in front of the API, so the client IP is read from X-Forwarded-For correctly. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).optional(),
    CORS_ORIGINS: z.string().default('*'),
    /** Where the admin panel runs, for invite links. Locally it defaults to http://localhost:3001. */
    ADMIN_URL: z.string().url().optional(),
    /**
     * Shared with the admin panel's server, which calls the API on the admin's behalf. With it, the panel
     * passes on the admin's own IP address, so sign-in limits and the audit log see the person, not the panel.
     */
    ADMIN_PANEL_SECRET: z.string().min(32, 'ADMIN_PANEL_SECRET must be at least 32 characters').optional(),
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
    if (env.STORAGE_PROVIDER === 's3') {
      need(!!env.S3_BUCKET, 'S3_BUCKET', 'required when STORAGE_PROVIDER is s3');
    }
    if (env.MAPS_PROVIDER === 'google') {
      need(!!env.GOOGLE_MAPS_API_KEY, 'GOOGLE_MAPS_API_KEY', 'required when MAPS_PROVIDER is google');
    }
    if (env.PAYMENTS_PROVIDER === 'paystack') {
      need(!!env.PAYSTACK_SECRET_KEY, 'PAYSTACK_SECRET_KEY', 'required when PAYMENTS_PROVIDER is paystack');
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
      need(env.PAYMENTS_PROVIDER !== 'fake', 'PAYMENTS_PROVIDER', 'must be a real provider in production');
      need(env.MAPS_PROVIDER !== 'fake', 'MAPS_PROVIDER', 'must be a real provider in production');
      need(env.STORAGE_PROVIDER !== 'memory', 'STORAGE_PROVIDER', 'must be s3 in production');
      // Behind a load balancer, 0 would make every client share one IP and one sign-in limit.
      need(
        env.TRUST_PROXY_HOPS !== undefined,
        'TRUST_PROXY_HOPS',
        'must be set in production (load balancers in front)',
      );
      need(!!env.ADMIN_PANEL_SECRET, 'ADMIN_PANEL_SECRET', 'must be set in production');
      need(!!env.ADMIN_URL, 'ADMIN_URL', 'must be set in production, or invite links point at localhost');
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
