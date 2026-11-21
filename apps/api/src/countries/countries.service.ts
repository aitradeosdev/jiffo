import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { CountrySettingsSchema, withPrices, type CountrySettings, type Prices } from '@jiffo/shared';
import { DB, type Db, type Tx } from '../db/database.module';
import { categories, countries, settingsVersions, states } from '../db/schema';
import { notFound } from '../common/errors';

export interface VersionedSettings {
  version: number;
  settings: CountrySettings;
}

/**
 * The country adapter: everything that differs by country (currency, states, categories, fees, timers,
 * identity rules) is read through here, never hard-coded.
 */
@Injectable()
export class CountriesService {
  private readonly versions = new Map<string, Promise<CountrySettings>>();
  private readonly countryBasics = new Map<string, { currency: string; timezone: string }>();

  constructor(@Inject(DB) private readonly db: Db) {}

  /** A country's currency and time zone. They never change once set, so they are kept in memory. */
  async basics(code: string, db: Db | Tx = this.db): Promise<{ currency: string; timezone: string }> {
    let cached = this.countryBasics.get(code);
    if (!cached) {
      const [row] = await db
        .select({ currency: countries.currency, timezone: countries.timezone })
        .from(countries)
        .where(eq(countries.code, code));
      if (!row) throw notFound('country_not_available', 'Jiffo is not available in this country yet');
      cached = row;
      this.countryBasics.set(code, cached);
    }
    return cached;
  }

  async enabledCountry(code: string) {
    const [country] = await this.db.select().from(countries).where(eq(countries.code, code.toUpperCase()));
    if (!country || !country.enabled)
      throw notFound('country_not_available', 'Jiffo is not available in this country yet');
    return country;
  }

  async currentSettings(countryCode: string): Promise<VersionedSettings> {
    const current = await this.currentSettingsIfAny(countryCode);
    if (!current) throw notFound('settings_missing', `No settings saved for ${countryCode}`);
    return current;
  }

  /**
   * The current settings, or null for a country with none saved yet (so nothing runs there). Pass the caller's
   * transaction as `db` to read inside it: a transaction waiting on a second connection can stall a busy server.
   */
  async currentSettingsIfAny(countryCode: string, db: Db | Tx = this.db): Promise<VersionedSettings | null> {
    const [row] = await db
      .select({ version: settingsVersions.version })
      .from(settingsVersions)
      .where(eq(settingsVersions.countryCode, countryCode))
      .orderBy(desc(settingsVersions.version))
      .limit(1);
    return row ? { version: row.version, settings: await this.settingsAt(countryCode, row.version, db) } : null;
  }

  /**
   * The settings an errand was created under, so its timers and limits never change mid-errand.
   * A saved version never changes, so each one is read and checked once and then kept in memory.
   */
  settingsAt(countryCode: string, version: number, db: Db | Tx = this.db): Promise<CountrySettings> {
    const key = `${countryCode}:${version}`;
    let cached = this.versions.get(key);
    if (!cached) {
      cached = this.loadVersion(countryCode, version, db);
      this.versions.set(key, cached);
      cached.catch(() => this.versions.delete(key));
    }
    return cached;
  }

  private async loadVersion(countryCode: string, version: number, db: Db | Tx): Promise<CountrySettings> {
    const [row] = await db
      .select()
      .from(settingsVersions)
      .where(and(eq(settingsVersions.countryCode, countryCode), eq(settingsVersions.version, version)));
    if (!row) throw notFound('settings_missing', `No settings version ${version} for ${countryCode}`);
    return CountrySettingsSchema.parse(row.data);
  }

  /**
   * The settings an errand runs under: its country's version when it was sent, with the prices it was sent with
   * (its area's, Settings, Places). An errand from before area prices uses the country's.
   */
  async errandSettings(errand: { countryCode: string; settingsVersion: number; prices?: Prices | null }) {
    return withPrices(await this.settingsAt(errand.countryCode, errand.settingsVersion), errand.prices);
  }

  enabledStates(countryCode: string) {
    return this.db
      .select({ code: states.code, name: states.name, agentSignups: states.agentSignups })
      .from(states)
      .where(and(eq(states.countryCode, countryCode), eq(states.enabled, true)))
      .orderBy(asc(states.name));
  }

  activeCategories(countryCode: string) {
    return this.db
      .select({
        key: categories.key,
        name: categories.name,
        icon: categories.icon,
        description: categories.description,
        buyDefault: categories.buyDefault,
      })
      .from(categories)
      .where(and(eq(categories.countryCode, countryCode), eq(categories.active, true), isNull(categories.deletedAt)))
      .orderBy(asc(categories.sort), asc(categories.name));
  }

  async activeCategory(countryCode: string, key: string) {
    const [category] = await this.db
      .select()
      .from(categories)
      .where(
        and(
          eq(categories.countryCode, countryCode),
          eq(categories.key, key),
          eq(categories.active, true),
          isNull(categories.deletedAt),
        ),
      );
    return category;
  }
}
