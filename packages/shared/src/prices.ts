import { z } from 'zod';
import type { CountrySettings } from './settings';

const kobo = z.number().int().nonnegative().max(100_000_000_00);
const bps = z.number().int().min(0).max(10_000);

/**
 * What a state, city or area can price for itself (Settings, Places): the errand fee's base, rate per km and
 * minimum, and the customer's service fee. Each is optional: one left out comes from the level above.
 */
export const PriceOverrideSchema = z
  .object({
    baseFeeKobo: kobo,
    ratePerKmKobo: kobo,
    minFeeKobo: kobo,
    serviceFeeBps: bps,
    serviceFeeMinKobo: kobo,
    serviceFeeCapKobo: kobo,
  })
  .partial()
  .strict();
export type PriceOverride = z.infer<typeof PriceOverrideSchema>;

export const PRICE_FIELDS = [
  'baseFeeKobo',
  'ratePerKmKobo',
  'minFeeKobo',
  'serviceFeeBps',
  'serviceFeeMinKobo',
  'serviceFeeCapKobo',
] as const;

/** The prices an errand is sent with: every field set. */
export type Prices = Required<PriceOverride>;

/** The country's prices, from its settings. */
export const countryPrices = (s: CountrySettings): Prices => ({
  baseFeeKobo: s.pricing.baseFeeKobo,
  ratePerKmKobo: s.pricing.ratePerKmKobo,
  minFeeKobo: s.pricing.minFeeKobo,
  serviceFeeBps: s.fees.serviceFeeBps,
  serviceFeeMinKobo: s.fees.serviceFeeMinKobo,
  serviceFeeCapKobo: s.fees.serviceFeeCapKobo,
});

/**
 * The prices for a place: the country's, with each value replaced by the nearest level that sets it. `chain` runs
 * from the widest to the narrowest: state, city, then area.
 */
export function resolvePrices(country: CountrySettings, chain: PriceOverride[]): Prices {
  return applyPrices(countryPrices(country), chain);
}

/** Prices with each level's values laid over them in turn, widest first. */
export function applyPrices(base: Prices, chain: PriceOverride[]): Prices {
  const prices = { ...base };
  for (const level of chain) {
    for (const field of PRICE_FIELDS) {
      const value = level[field];
      if (value !== undefined) prices[field] = value;
    }
  }
  return prices;
}

/** Why some prices can't be used, in words for the admin, or null when they can. */
export function pricesProblem(p: Prices): string | null {
  if (p.serviceFeeMinKobo > p.serviceFeeCapKobo) return 'The service fee minimum must not exceed its cap';
  return null;
}

/**
 * The settings an errand runs under: its country's, with the prices it was sent with. The country's object is
 * shared and cached, so a new one is made rather than it being changed; an errand from before area prices has none.
 */
export function withPrices(settings: CountrySettings, prices: Prices | null | undefined): CountrySettings {
  if (!prices) return settings;
  return {
    ...settings,
    pricing: {
      ...settings.pricing,
      baseFeeKobo: prices.baseFeeKobo,
      ratePerKmKobo: prices.ratePerKmKobo,
      minFeeKobo: prices.minFeeKobo,
    },
    fees: {
      ...settings.fees,
      serviceFeeBps: prices.serviceFeeBps,
      serviceFeeMinKobo: prices.serviceFeeMinKobo,
      serviceFeeCapKobo: prices.serviceFeeCapKobo,
    },
  };
}
