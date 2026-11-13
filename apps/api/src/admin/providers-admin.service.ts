import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  PROVIDER_CATEGORIES,
  PROVIDER_CATEGORY_INFO,
  PROVIDERS,
  providerInfo,
  secretHint,
  type ProviderCategory,
} from '@jiffo/shared';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { DB, type Db } from '../db/database.module';
import { admins, agentApplications, deposits, payouts, providerSettings } from '../db/schema';
import { badRequest, conflict, notFound } from '../common/errors';
import { BUILDERS, checkAdapter } from '../providers/builders';
import { ProvidersService, secretBinding } from '../providers/providers.service';
import { DEPOSIT_RECHECK_DAYS } from '../money/deposits.service';
import { AuditService } from './audit.service';
import type { AdminContext } from './admin.types';

type Row = typeof providerSettings.$inferSelect;

/** Building an adapter can fail on a malformed value (a JSON key file, say): said without the value. */
const buildError = (error: unknown) =>
  badRequest('invalid_provider_settings', `These settings don't work: ${(error as Error).message}`);

/**
 * The providers page: each provider's settings, saved with the secret fields encrypted, a Test button, and
 * switching one on per category. Secrets are never sent back, only their last characters, and never written
 * to the audit log, which records only which fields changed.
 */
@Injectable()
export class ProvidersAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly providers: ProvidersService,
    private readonly audit: AuditService,
  ) {}

  private info(category: string, provider: string) {
    const info = providerInfo(category, provider);
    if (!info || !BUILDERS[info.category][provider]) throw notFound('provider_not_found', 'No such provider');
    return info;
  }

  private complete(row: Row | undefined, category: ProviderCategory, provider: string) {
    if (!row) return false;
    return this.info(category, provider)
      .fields.filter((f) => f.required)
      .every((f) => (f.secret ? !!row.secretHints[f.key] : !!row.config[f.key]?.trim()));
  }

  async list() {
    const rows = await this.db
      .select({ row: providerSettings, updatedBy: admins.name })
      .from(providerSettings)
      .leftJoin(admins, eq(admins.id, providerSettings.updatedBy));
    const fallback = this.providers.envNames();
    return {
      live: this.config.NODE_ENV === 'production',
      categories: PROVIDER_CATEGORIES.map((category) => ({
        category,
        ...PROVIDER_CATEGORY_INFO[category],
        active: rows.find((r) => r.row.category === category && r.row.active)?.row.provider ?? null,
        /** Used while none is switched on: the environment's choice, a stand-in, or "none". */
        fallback: fallback[category],
        providers: PROVIDERS.filter((p) => p.category === category && BUILDERS[category][p.key]).map((p) => {
          const found = rows.find((r) => r.row.category === category && r.row.provider === p.key);
          const row = found?.row;
          return {
            key: p.key,
            name: p.name,
            about: p.about,
            fields: p.fields,
            // A callback address with a token exists once the settings are saved.
            webhookUrl:
              p.webhookPath && (!p.webhookPath.includes('{token}') || row?.callbackToken)
                ? `${this.config.PUBLIC_API_URL}${p.webhookPath.replace('{token}', row?.callbackToken ?? '')}`
                : null,
            hasCallbackToken: !!p.webhookPath?.includes('{token}'),
            webhookHint: p.webhookHint ?? null,
            saved: !!row,
            complete: this.complete(row, category, p.key),
            active: !!row?.active,
            config: row?.config ?? {},
            secretHints: row?.secretHints ?? {},
            updatedAt: row?.updatedAt ?? null,
            updatedBy: found?.updatedBy ?? null,
            lastTest: row?.lastTestAt
              ? {
                  at: row.lastTestAt,
                  ok: row.lastTestOk,
                  message: row.lastTestMessage,
                  current: row.lastTestAt >= row.updatedAt,
                }
              : null,
          };
        }),
      })),
    };
  }

  /**
   * Saves a provider's fields. A secret left empty keeps the one saved before. The settings must make a
   * working adapter (a key file that parses, say), but nothing is sent to the provider until Test.
   */
  async save(
    admin: AdminContext,
    category: ProviderCategory,
    provider: string,
    input: { config: Record<string, string>; secrets: Record<string, string> },
  ) {
    const info = this.info(category, provider);
    const fields = new Map(info.fields.map((f) => [f.key, f]));
    for (const key of [...Object.keys(input.config), ...Object.keys(input.secrets)]) {
      if (!fields.has(key)) throw badRequest('unknown_field', `${info.name} has no field ${key}`);
    }
    for (const key of Object.keys(input.config)) {
      if (fields.get(key)!.secret) throw badRequest('secret_in_config', `${fields.get(key)!.label} is secret`);
    }
    for (const key of Object.keys(input.secrets)) {
      if (!fields.get(key)!.secret) throw badRequest('not_secret', `${fields.get(key)!.label} isn't secret`);
    }

    return this.db
      .transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`providers:${category}`}))`);
        const [before] = await tx
          .select()
          .from(providerSettings)
          .where(and(eq(providerSettings.category, category), eq(providerSettings.provider, provider)));
        const binding = secretBinding(category, provider);
        // Keys saved under an earlier SECRETS_KEY can't be read: they are dropped, and must be typed again.
        let oldSecrets: Record<string, string> = {};
        if (before?.secrets) {
          try {
            oldSecrets = JSON.parse(this.providers.box.open(before.secrets, binding)) as Record<string, string>;
          } catch {
            oldSecrets = {};
          }
        }
        const config: Record<string, string> = {};
        for (const f of info.fields.filter((f) => !f.secret)) {
          const value = (input.config[f.key] ?? before?.config[f.key] ?? '').trim();
          if (value) config[f.key] = value;
        }
        const secrets = { ...oldSecrets };
        const changed: string[] = [];
        for (const [key, value] of Object.entries(input.secrets)) {
          const v = value.trim();
          if (v && v !== oldSecrets[key]) {
            secrets[key] = v;
            changed.push(key);
          }
        }
        for (const f of info.fields.filter((f) => !f.secret)) {
          if ((before?.config[f.key] ?? '') !== (config[f.key] ?? '')) changed.push(f.key);
        }
        const lost = Object.keys(before?.secretHints ?? {}).filter((k) => !(k in secrets));
        changed.push(...lost);
        if (before && changed.length === 0) return { changed };
        try {
          BUILDERS[category][provider]!({ ...config, ...secrets }, this.providers.context);
        } catch (error) {
          throw buildError(error);
        }
        const values = {
          config,
          secrets: Object.keys(secrets).length ? this.providers.box.seal(JSON.stringify(secrets), binding) : null,
          secretHints: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, secretHint(v)])),
          // A change means the last test no longer says anything about these settings.
          lastTestAt: null,
          lastTestOk: null,
          lastTestMessage: null,
          updatedBy: admin.adminId,
          updatedAt: new Date(),
        };
        if (before) {
          await tx.update(providerSettings).set(values).where(eq(providerSettings.id, before.id));
        } else {
          const callbackToken = info.webhookPath?.includes('{token}') ? randomBytes(16).toString('hex') : null;
          await tx.insert(providerSettings).values({ category, provider, callbackToken, ...values });
        }
        await this.audit.record(tx, admin, {
          action: 'provider.save',
          targetType: 'provider',
          targetId: `${category}:${provider}`,
          data: { category, provider, name: info.name, changed },
        });
        return { changed };
      })
      .finally(() => this.providers.reload());
  }

  /**
   * A new callback address for a provider that calls us, should the old one have leaked. The old one stops
   * working within 30 seconds, so the new one must be set in the provider's dashboard straight away.
   */
  async newCallbackToken(admin: AdminContext, category: ProviderCategory, provider: string) {
    const info = this.info(category, provider);
    if (!info.webhookPath?.includes('{token}')) throw badRequest('no_callback', `${info.name} has no callback address`);
    return this.db
      .transaction(async (tx) => {
        const [row] = await tx
          .update(providerSettings)
          .set({ callbackToken: randomBytes(16).toString('hex') })
          .where(and(eq(providerSettings.category, category), eq(providerSettings.provider, provider)))
          .returning({ id: providerSettings.id });
        if (!row) throw conflict('provider_not_saved', 'Save the settings first');
        await this.audit.record(tx, admin, {
          action: 'provider.callback',
          targetType: 'provider',
          targetId: `${category}:${provider}`,
          data: { category, provider, name: info.name },
        });
        return { renewed: true };
      })
      .finally(() => this.providers.reload());
  }

  /** Something read-only with the saved keys (a balance, a bucket), and keeps the answer. */
  async test(category: ProviderCategory, provider: string) {
    this.info(category, provider);
    await this.providers.reload();
    const [row] = await this.db
      .select()
      .from(providerSettings)
      .where(and(eq(providerSettings.category, category), eq(providerSettings.provider, provider)));
    if (!row) throw conflict('provider_not_saved', 'Save the settings first');
    let ok = false;
    let message: string;
    try {
      const adapter = this.providers.fromSettings(category, provider);
      if (!adapter) throw new Error('The saved settings could not be read');
      message = await checkAdapter(category, adapter);
      ok = true;
    } catch (error) {
      message = (error as Error).message || 'The provider refused';
    }
    message = message.slice(0, 300);
    // Kept only if the settings are still the ones tested: a save during the test needs a test of its own.
    const [kept] = await this.db
      .update(providerSettings)
      .set({ lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message })
      .where(and(eq(providerSettings.id, row.id), eq(providerSettings.updatedAt, row.updatedAt)))
      .returning({ id: providerSettings.id });
    if (!kept) return { ok: false, message: 'The settings changed during the test. Test again.' };
    return { ok, message };
  }

  /**
   * Switches a provider on for its category, or switches the category back to the environment's choice
   * with null. Only a provider whose saved settings passed the Test can be switched on.
   */
  async activate(admin: AdminContext, category: ProviderCategory, provider: string | null) {
    if (provider) this.info(category, provider);
    return this.db
      .transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`providers:${category}`}))`);
        const rows = await tx.select().from(providerSettings).where(eq(providerSettings.category, category));
        const from = rows.find((r) => r.active)?.provider ?? null;
        if (provider) {
          const row = rows.find((r) => r.provider === provider);
          if (!this.complete(row, category, provider)) {
            throw conflict('provider_incomplete', 'Fill in every required field and save first');
          }
          if (!row!.lastTestOk || !row!.lastTestAt || row!.lastTestAt < row!.updatedAt) {
            throw conflict('provider_not_tested', 'Test these settings, and switch on once the test passes');
          }
        }
        if (from === provider) return { active: provider };
        await tx.update(providerSettings).set({ active: false }).where(eq(providerSettings.category, category));
        if (provider) {
          await tx
            .update(providerSettings)
            .set({ active: true })
            .where(and(eq(providerSettings.category, category), eq(providerSettings.provider, provider)));
        }
        await this.audit.record(tx, admin, {
          action: 'provider.activate',
          targetType: 'provider',
          targetId: `${category}:${provider ?? 'none'}`,
          data: { category, from, to: provider },
        });
        return { active: provider };
      })
      .finally(() => this.providers.reload());
  }

  /**
   * Deletes a provider's saved settings and keys. Not while it is switched on, nor while something it
   * started (a top-up, a payout, an identity check) still needs it.
   */
  async remove(admin: AdminContext, category: ProviderCategory, provider: string) {
    const info = this.info(category, provider);
    return this.db
      .transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`providers:${category}`}))`);
        const [row] = await tx
          .select()
          .from(providerSettings)
          .where(and(eq(providerSettings.category, category), eq(providerSettings.provider, provider)));
        if (!row) throw notFound('provider_not_saved', 'Nothing is saved for this provider');
        if (row.active) throw conflict('provider_active', 'Switch another provider on first');
        if ((await this.stillNeeded(category, provider)) > 0) {
          throw conflict('provider_in_use', `${info.name} is still finishing things it started. Try again later.`);
        }
        await tx.delete(providerSettings).where(eq(providerSettings.id, row.id));
        await this.audit.record(tx, admin, {
          action: 'provider.remove',
          targetType: 'provider',
          targetId: `${category}:${provider}`,
          data: { category, provider, name: info.name },
        });
        return { removed: true };
      })
      .finally(() => this.providers.reload());
  }

  /** Things a provider started that still need it to finish. */
  private async stillNeeded(category: ProviderCategory, provider: string) {
    if (category === 'payments') {
      const [[d], [p]] = await Promise.all([
        this.db
          .select({ n: count() })
          .from(deposits)
          // Top-ups still being checked: one never paid stops being asked about a week after it expired.
          .where(
            and(
              eq(deposits.provider, provider),
              eq(deposits.status, 'pending'),
              gt(deposits.expiresAt, new Date(Date.now() - DEPOSIT_RECHECK_DAYS * 86_400_000)),
            ),
          ),
        this.db
          .select({ n: count() })
          .from(payouts)
          .where(and(eq(payouts.provider, provider), inArray(payouts.status, ['requested', 'processing']))),
      ]);
      return (d?.n ?? 0) + (p?.n ?? 0);
    }
    if (category === 'identity') {
      const [a] = await this.db
        .select({ n: count() })
        .from(agentApplications)
        .where(
          and(
            eq(agentApplications.status, 'checking'),
            sql`(${agentApplications.identityProvider} = ${provider} or ${agentApplications.addressProvider} = ${provider})`,
          ),
        );
      return a?.n ?? 0;
    }
    return 0;
  }
}
