import { Global, Module } from '@nestjs/common';
import { z } from 'zod';

const hexKey = (name: string) =>
  z.string().regex(/^[0-9a-f]{64}$/i, `${name} must be 32 bytes written as 64 hex characters`);

/** SECURITY_CONTACT's addresses, in order. */
export const contactsOf = (value: string | undefined) =>
  (value ?? '')
    // Split only where the next contact starts, so a comma inside a link stays in it.
    .split(/[\s,]+(?=mailto:|https:\/\/)/)
    .map((c) => c.trim().replace(/,+$/, ''))
    .filter(Boolean);

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    OTP_SECRET: z.string().min(32, 'OTP_SECRET must be at least 32 characters'),
    PIN_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'PIN_KEY must be 32 bytes written as 64 hex characters'),
    /**
     * Encrypts the providers' keys that admin enters in the panel. Keep it apart from the database: whoever
     * has both can read the keys. Changing it makes the stored keys unreadable, so they must be entered again.
     */
    SECRETS_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/i, 'SECRETS_KEY must be 32 bytes written as 64 hex characters')
      .optional(),
    /**
     * Each of these keys has one job (docs/security-plan.md, I5). Production requires each, all different;
     * in development each is derived from PIN_KEY, so nothing extra has to be set up. Changing one makes what
     * it protects unreadable: ID fingerprints stop matching, authenticators must be set up again, and
     * encrypted personal details can't be read.
     */
    ID_FINGERPRINT_KEY: hexKey('ID_FINGERPRINT_KEY').optional(),
    ADMIN_TOTP_KEY: hexKey('ADMIN_TOTP_KEY').optional(),
    FIELD_KEY: hexKey('FIELD_KEY').optional(),
    /** Signs admin sign-in steps, apart from the app's tokens (JWT_SECRET). */
    ADMIN_TOKEN_SECRET: z.string().min(32, 'ADMIN_TOKEN_SECRET must be at least 32 characters').optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    /** However often it is refreshed, a session ends this many days after sign-in, and the person signs in again. */
    SESSION_MAX_DAYS: z.coerce.number().int().positive().default(90),
    /**
     * Optional: the addresses Paystack sends webhooks and approval requests from, comma-separated (see
     * Paystack's docs). When set, calls from any other address are refused, on top of the signature check.
     */
    PAYSTACK_WEBHOOK_IPS: z.string().optional(),
    /**
     * Requests a minute for each class of route, over the defaults in common/rate-limit.ts, as
     * "class=number,…"; for example "paid=20,auth=10".
     */
    RATE_LIMITS: z.string().optional(),
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
    /**
     * The API's own address as the apps and providers reach it: webhook addresses, identity pages, security.txt
     * and development file links. Required in production, over https.
     */
    PUBLIC_API_URL: z.string().url().default('http://localhost:3000'),
    GOOGLE_MAPS_API_KEY: z.string().optional(),
    PAYMENTS_PROVIDER: z.enum(['paystack', 'fake']).default('fake'),
    /**
     * Identity checks for agents. "none" turns them off: agents can't send applications until a provider is
     * set up. Only the fake exists until the real provider's keys and SDK are in, and it never runs in
     * production.
     */
    IDENTITY_PROVIDER: z.enum(['fake', 'none']).default('fake'),
    /**
     * Masked calls between a customer and their agent. "none" turns them off. Only the fake exists until a
     * provider's keys are in, and it never runs in production.
     */
    CALLS_PROVIDER: z.enum(['fake', 'none']).default('fake'),
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
    /** How often the money held at the payments provider is checked against the low-balance alert. */
    BALANCE_CHECK_CRON: z.string().default('*/15 * * * *'),
    /** Errand timers (item lock, auto-release, unreachable, urgent expiry). memory is for tests only. */
    TIMER_PROVIDER: z.enum(['bullmq', 'memory']).default('bullmq'),
    REDIS_URL: z.string().url().default('redis://localhost:6379'),
    /** Code requests allowed from one IP address per hour, across all phone numbers. */
    OTP_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(30),
    /**
     * Sign-in codes one network address may ask for in a day. Higher than a number's limit: mobile networks
     * put many customers behind one shared address.
     */
    OTP_PER_IP_PER_DAY: z.coerce.number().int().positive().default(300),
    /** Load balancers in front of the API, so the client IP is read from X-Forwarded-For correctly. */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).optional(),
    CORS_ORIGINS: z.string().default('*'),
    /**
     * Where to report a security problem (docs/security-plan.md, S11), for security.txt and the reporting page:
     * mailto: or https: addresses, comma-separated. Required in production.
     */
    SECURITY_CONTACT: z
      .string()
      .optional()
      .refine(
        (v) => !v || contactsOf(v).every((c) => /^(mailto:[^\s@,<>"]+@[^\s@,<>"]+|https:\/\/[^\s,<>"]+)$/.test(c)),
        'SECURITY_CONTACT must be mailto: or https: addresses, separated by commas',
      ),
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
      // Providers may come from the environment or from the admin panel, so none is required here. In
      // production a category set in neither answers that it isn't set up; a stand-in is never used.
      need(env.TIMER_PROVIDER !== 'memory', 'TIMER_PROVIDER', 'must be bullmq in production');
      // Behind a load balancer, 0 would make every client share one IP and one sign-in limit.
      need(
        env.TRUST_PROXY_HOPS !== undefined,
        'TRUST_PROXY_HOPS',
        'must be set in production (load balancers in front)',
      );
      need(!!env.ADMIN_PANEL_SECRET, 'ADMIN_PANEL_SECRET', 'must be set in production');
      need(env.CORS_ORIGINS !== '*', 'CORS_ORIGINS', 'must list the allowed origins in production, not *');
      need(!!env.SECRETS_KEY, 'SECRETS_KEY', "must be set in production, to encrypt providers' keys");
      for (const name of ['ID_FINGERPRINT_KEY', 'ADMIN_TOTP_KEY', 'FIELD_KEY', 'ADMIN_TOKEN_SECRET'] as const) {
        need(!!env[name], name, 'must be set in production: each key has its own job');
      }
      const keys = [
        env.JWT_SECRET,
        env.OTP_SECRET,
        env.PIN_KEY,
        env.SECRETS_KEY,
        env.ID_FINGERPRINT_KEY,
        env.ADMIN_TOTP_KEY,
        env.FIELD_KEY,
        env.ADMIN_TOKEN_SECRET,
      ]
        .filter((k): k is string => !!k)
        .map((k) => k.toLowerCase());
      need(new Set(keys).size === keys.length, 'FIELD_KEY', 'and the other keys and secrets must all be different');
      need(!!env.ADMIN_URL, 'ADMIN_URL', 'must be set in production, or invite links point at localhost');
      need(
        contactsOf(env.SECURITY_CONTACT).length > 0,
        'SECURITY_CONTACT',
        'must be set in production, for security.txt',
      );
      // Webhook addresses, identity pages and security.txt are built from it.
      need(
        /^https:\/\//.test(env.PUBLIC_API_URL) && !/^https:\/\/(localhost|127\.|\[::1\])/.test(env.PUBLIC_API_URL),
        'PUBLIC_API_URL',
        "must be the API's public https address in production",
      );
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
