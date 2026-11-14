import { createHmac, hkdfSync } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { ProviderContext } from '../adapters/identity-providers';
import { PROVIDER_CATEGORIES, type ProviderCategory } from '@jiffo/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { providerSettings } from '../db/schema';
import { BUILDERS } from './builders';
import { ENV_ADAPTERS, type Adapters } from './env-adapters';
import { SecretBox, secretsKeyFrom } from './secret-box';

type Row = typeof providerSettings.$inferSelect;

/** How often each API process reads the settings again, so a change in the panel reaches all of them. */
const RELOAD_EVERY_MS = 30_000;

/** The stored secrets of a provider are bound to it: they decrypt only for that category and provider. */
export const secretBinding = (category: string, provider: string) => `provider:${category}:${provider}`;

/**
 * Which provider each service uses, from admin's settings in the panel. Reads them into memory at start and
 * every 30 seconds (and at once after a change here), so choosing an adapter never waits on the database.
 * A category with no provider switched on uses the environment's choice.
 */
/** How long a link to a provider's page that this API serves works after the check starts. */
export const HOSTED_LINK_TTL_MS = 60 * 60_000;

@Injectable()
export class ProvidersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProvidersService.name);
  readonly box: SecretBox;
  private rows = new Map<string, Row>();
  private active = new Map<ProviderCategory, string>();
  /** Built adapters, kept while their settings are unchanged, with why one couldn't be built. */
  private readonly built = new Map<string, { stamp: number; adapter: unknown | null; problem?: string }>();
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(ENV_ADAPTERS) private readonly env: Adapters,
  ) {
    const master = secretsKeyFrom(config);
    this.box = new SecretBox(master);
    const linkKey = Buffer.from(hkdfSync('sha256', Buffer.from(master, 'hex'), Buffer.alloc(0), 'jiffo links', 32));
    const publicApiUrl = config.PUBLIC_API_URL.replace(/\/$/, '');
    const sign = (text: string) => createHmac('sha256', linkKey).update(text).digest('hex').slice(0, 32);
    this.context = {
      publicApiUrl,
      sign,
      hostedLink: (provider, reference) => {
        const expires = String(Date.now() + HOSTED_LINK_TTL_MS);
        const query = new URLSearchParams({
          ref: reference,
          exp: expires,
          sig: sign(`${provider}:${reference}:${expires}`),
        });
        return `${publicApiUrl}/v1/identity/hosted/${provider}?${query.toString()}`;
      },
      production: config.NODE_ENV === 'production',
    };
  }

  /** What adapters get from the API: its public address, and signing for the links they hand out. */
  readonly context: ProviderContext;

  async onModuleInit() {
    await this.reload();
    this.timer = setInterval(() => {
      this.reload().catch((error: unknown) => this.logger.warn(`Reading provider settings failed: ${String(error)}`));
    }, RELOAD_EVERY_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async reload() {
    const rows = await this.db.select().from(providerSettings);
    this.rows = new Map(rows.map((r) => [`${r.category}:${r.provider}`, r]));
    this.active = new Map(
      rows.filter((r) => r.active).map((r) => [r.category as ProviderCategory, r.provider] as const),
    );
  }

  /** The provider switched on for a category, or null when the environment's choice is used. */
  activeProvider(category: ProviderCategory) {
    return this.active.get(category) ?? null;
  }

  /** The adapter in use for a category now. */
  current<C extends ProviderCategory>(category: C): Adapters[C] {
    const name = this.active.get(category);
    if (name) {
      const adapter = this.fromSettings(category, name);
      if (adapter) return adapter;
    }
    return this.env[category];
  }

  /**
   * A provider's adapter by name, for something started with it (a top-up, a transfer, an identity check)
   * even after admin switched to another. Null when that provider isn't set up any more.
   */
  named<C extends ProviderCategory>(category: C, name: string): Adapters[C] | null {
    // The same keys current() uses for this provider: the panel's once it is switched on there, else the
    // environment's when it names this provider, else the panel's saved ones.
    if (this.active.get(category) === name) {
      return this.fromSettings(category, name) ?? (this.env[category].name === name ? this.env[category] : null);
    }
    if (this.env[category].name === name) return this.env[category];
    return this.fromSettings(category, name);
  }

  /** The adapter made from a provider's saved settings, or null if they are missing or can't be read. */
  fromSettings<C extends ProviderCategory>(category: C, name: string): Adapters[C] | null {
    const row = this.rows.get(`${category}:${name}`);
    const build = BUILDERS[category][name];
    if (!row || !build) return null;
    const key = `${category}:${name}`;
    const stamp = row.updatedAt.getTime();
    // A failure is kept too, so settings that can't be read are tried and logged once, not on every call.
    const cached = this.built.get(key);
    if (cached?.stamp === stamp) return cached.adapter as Adapters[C] | null;
    try {
      const adapter = build(this.values(row), this.context);
      this.built.set(key, { stamp, adapter });
      return adapter;
    } catch (error) {
      this.logger.error(`Provider ${key} could not be set up: ${String(error)}`);
      this.built.set(key, { stamp, adapter: null, problem: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  /** Why a provider's saved settings can't be used now, for the panel; null when they can, or none are saved. */
  problemOf(category: ProviderCategory, name: string): string | null {
    this.fromSettings(category, name);
    return this.built.get(`${category}:${name}`)?.problem ?? null;
  }

  /** All of a provider's fields, the secret ones decrypted. Only for building its adapter. */
  values(row: Row): Record<string, string> {
    const secrets = row.secrets
      ? (JSON.parse(this.box.open(row.secrets, secretBinding(row.category, row.provider))) as Record<string, string>)
      : {};
    return { ...row.config, ...secrets };
  }

  /** The secret part of a provider's callback address, or null before its settings are saved. */
  callbackToken(category: string, provider: string) {
    return this.rows.get(`${category}:${provider}`)?.callbackToken ?? null;
  }

  /** What the environment uses for each category, for the panel to show when nothing is switched on. */
  envNames() {
    return Object.fromEntries(PROVIDER_CATEGORIES.map((c) => [c, this.env[c].name])) as Record<
      ProviderCategory,
      string
    >;
  }
}
