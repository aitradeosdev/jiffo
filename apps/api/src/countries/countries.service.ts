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
  constructor(@Inject(DB) private readonly db: Db) {}

  async enabledCountry(code: string) {
    const [country] = await this.db.select().from(countries).where(eq(countries.code, code.toUpperCase()));
    if (!country || !country.enabled)
      throw notFound('country_not_available', 'Jiffo is not available in this country yet');
    return country;
  }

  async currentSettings(countryCode: string): Promise<VersionedSettings> {
    const [row] = await this.db
      .select()
      .from(settingsVersions)
      .where(eq(settingsVersions.countryCode, countryCode))
      .orderBy(desc(settingsVersions.version))
      .limit(1);
    if (!row) throw notFound('settings_missing', `No settings saved for ${countryCode}`);
    return { version: row.version, settings: CountrySettingsSchema.parse(row.data) };
  }

  /** The settings an errand was created under, so its timers and limits never change mid-errand. */
  async settingsAt(countryCode: string, version: number): Promise<CountrySettings> {
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
