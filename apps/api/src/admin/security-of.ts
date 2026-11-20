import { DEFAULT_SECURITY_SETTINGS } from '@jiffo/shared';
import type { CountriesService } from '../countries/countries.service';
import type { Db, Tx } from '../db/database.module';

/**
 * A country's Security settings, or the defaults when it has none or its stored version can't be read: a
 * broken version must not stop the change that fixes it.
 */
export async function securityOf(countries: CountriesService, countryCode: string, db?: Db | Tx) {
  try {
    const current = await countries.currentSettingsIfAny(countryCode, db);
    return current?.settings.security ?? DEFAULT_SECURITY_SETTINGS;
  } catch (error) {
    // Only a stored version that no longer reads; anything else (the database being down) is an error.
    // Checked by name: the settings schema may come from another copy of zod (@jiffo/shared's build).
    if (error instanceof Error && error.name === 'ZodError') return DEFAULT_SECURITY_SETTINGS;
    throw error;
  }
}
