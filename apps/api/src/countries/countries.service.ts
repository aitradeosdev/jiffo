import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { CountrySettingsSchema, type CountrySettings } from '@jiffo/shared';
import { DB, type Db } from '../db/database.module';
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
  async basics(code: string): Promise<{ currency: string; timezone: string }> {
    let cached = this.countryBasics.get(code);
    if (!cached) {
      const [row] = await this.db
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
    const [row] = await this.db
      .select({ version: settingsVersions.version })
      .from(settingsVersions)
      .where(eq(settingsVersions.countryCode, countryCode))
      .orderBy(desc(settingsVersions.version))
      .limit(1);
    if (!row) throw notFound('settings_missing', `No settings saved for ${countryCode}`);
    return { version: row.version, settings: await this.settingsAt(countryCode, row.version) };
  }

  /**
   * The settings an errand was created under, so its timers and limits never change mid-errand.
   * A saved version never changes, so each one is read and checked once and then kept in memory.
   */
  settingsAt(countryCode: string, version: number): Promise<CountrySettings> {
    const key = `${countryCode}:${version}`;
    let cached = this.versions.get(key);
    if (!cached) {
      cached = this.loadVersion(countryCode, version);
      this.versions.set(key, cached);
      cached.catch(() => this.versions.delete(key));
    }
    return cached;
  }

  private async loadVersion(countryCode: string, version: number): Promise<CountrySettings> {
    const [row] = await this.db
      .select()
      .from(settingsVersions)
      .where(and(eq(settingsVersions.countryCode, countryCode), eq(settingsVersions.version, version)));
    if (!row) throw notFound('settings_missing', `No settings version ${version} for ${countryCode}`);
    return CountrySettingsSchema.parse(row.data);
  }

  enabledStates(countryCode: string) {
    return this.db
      .select({ code: states.code, name: states.name, agentSignups: states.agentSignups })
      .from(states)
      .where(and(eq(states.countryCode, countryCode), eq(states.enabled, true)))
      .orderBy(asc(states.name));
  }

  async enabledState(countryCode: string, code: string) {
    const [state] = await this.db
      .select()
      .from(states)
      .where(and(eq(states.countryCode, countryCode), eq(states.code, code), eq(states.enabled, true)));
    return state;
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
