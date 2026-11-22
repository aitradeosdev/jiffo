import { Inject, Injectable } from '@nestjs/common';
import { formatNaira, PRICE_FIELDS, pricesProblem, resolvePrices, type PriceOverride } from '@jiffo/shared';
import { badRequest, conflict, notFound } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { checkPlaceChange, lockPlaces, placeOf, type PlaceScope } from '../countries/place-overrides';
import { DB, type Db, type Tx } from '../db/database.module';
import { priceOverrides } from '../db/schema';
import { AuditService } from './audit.service';
import type { AdminContext } from './admin.types';

export type PriceChange = { scope: PlaceScope; id: string; basedOn: number; prices: PriceOverride; note: string };

const FIELD_LABEL: Record<(typeof PRICE_FIELDS)[number], string> = {
  baseFeeKobo: 'base fee',
  ratePerKmKobo: 'per km',
  minFeeKobo: 'minimum fee',
  serviceFeeBps: 'service fee',
  serviceFeeMinKobo: 'service fee at least',
  serviceFeeCapKobo: 'service fee at most',
};

/** A price as the panel shows it: naira, or a percentage for the service fee. */
export const priceText = (field: (typeof PRICE_FIELDS)[number], value: number | undefined) =>
  value === undefined ? 'as above' : field === 'serviceFeeBps' ? `${value / 100}%` : formatNaira(value);

/**
 * Prices per state, city and area (Settings, Places). A change is checked twice: when asked for, and when the
 * second admin approves, each time against the prices then, and for the place and every city and area below it.
 */
@Injectable()
export class PricesAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly countries: CountriesService,
  ) {}

  /**
   * Checks a change as if saved: made from the prices saved now, and leaving workable prices here and in every
   * city and area below. Returns the place and the prices it replaces.
   */
  check(input: PriceChange, db: Db | Tx = this.db) {
    return checkPlaceChange<PriceOverride>(
      db,
      priceOverrides,
      { ...input, data: input.prices },
      async (countryCode) => {
        // Read on the same connection: a save holds its transaction while it checks.
        const country = await this.countries.currentSettingsIfAny(countryCode, db);
        if (!country) throw notFound('settings_missing', `No settings saved for ${countryCode}`);
        return (chain) => pricesProblem(resolvePrices(country.settings, chain));
      },
      {
        changed: (version) =>
          conflict('prices_changed', 'These prices changed since you opened them. Reload and try again.', { version }),
        invalid: (where, problem) => badRequest('invalid_prices', `${where}: ${problem}`),
      },
    );
  }

  /** What a change does, for the person approving it. */
  async describe(input: PriceChange) {
    const { place, current } = await this.check(input);
    const changed = PRICE_FIELDS.filter((f) => current.data[f] !== input.prices[f]).map(
      (f) => `${FIELD_LABEL[f]} ${priceText(f, input.prices[f])}`,
    );
    return {
      place,
      summary: changed.length
        ? `Change prices for ${place.label}: ${changed.join(', ')}`
        : `Save the prices for ${place.label} unchanged`,
    };
  }

  /** Saves the next version of a place's prices, once approved. */
  async save(admin: AdminContext, input: PriceChange) {
    // The place's country, then its lock: one price change in a country at a time, whether a place's or the
    // country's settings they fall back to, as each is checked against the others' saved prices.
    const { countryCode } = await placeOf(this.db, input.scope, input.id);
    return this.db.transaction(async (tx) => {
      await lockPlaces(tx, countryCode);
      const { place, current } = await this.check(input, tx);
      const version = current.version + 1;
      await tx.insert(priceOverrides).values({
        scope: input.scope,
        scopeId: input.id,
        countryCode: place.countryCode,
        version,
        data: input.prices,
        createdBy: admin.adminId,
      });
      await this.audit.record(tx, admin, {
        action: 'prices.change',
        targetType: input.scope,
        targetId: input.id,
        countryCode: place.countryCode,
        data: {
          place: place.label,
          version,
          note: input.note,
          changes: PRICE_FIELDS.filter((f) => current.data[f] !== input.prices[f]).map((f) => ({
            field: f,
            from: current.data[f] ?? null,
            to: input.prices[f] ?? null,
          })),
        },
      });
      return { version, prices: input.prices };
    });
  }
}
