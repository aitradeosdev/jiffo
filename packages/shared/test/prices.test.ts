import { describe, expect, it } from 'vitest';
import { NIGERIA_DEFAULT_SETTINGS } from '../src/settings';
import { PriceOverrideSchema, pricesProblem, resolvePrices, withPrices } from '../src/prices';

const country = NIGERIA_DEFAULT_SETTINGS;

/**
 * Prices per state, city and area (Settings, Places): each sets only what differs, and anything it leaves out
 * comes from the level above, then the country's settings.
 */
describe('area prices', () => {
  it("are the country's where nothing is set", () => {
    expect(resolvePrices(country, [])).toEqual({
      baseFeeKobo: 50_000,
      ratePerKmKobo: 20_000,
      minFeeKobo: 100_000,
      serviceFeeBps: 1_000,
      serviceFeeMinKobo: 10_000,
      serviceFeeCapKobo: 100_000,
    });
  });

  it('take each value from the nearest level that sets it: area, then city, then state', () => {
    const state = { ratePerKmKobo: 30_000, serviceFeeBps: 800 };
    const city = { baseFeeKobo: 70_000, ratePerKmKobo: 25_000 };
    const area = { minFeeKobo: 150_000 };
    expect(resolvePrices(country, [state, city, area])).toEqual({
      baseFeeKobo: 70_000,
      ratePerKmKobo: 25_000,
      minFeeKobo: 150_000,
      serviceFeeBps: 800,
      serviceFeeMinKobo: 10_000,
      serviceFeeCapKobo: 100_000,
    });
  });

  it('go into the settings an errand uses, leaving everything else as it was', () => {
    const prices = resolvePrices(country, [{ ratePerKmKobo: 30_000, serviceFeeCapKobo: 200_000 }]);
    const merged = withPrices(country, prices);
    expect(merged.pricing).toEqual({ baseFeeKobo: 50_000, ratePerKmKobo: 30_000, minFeeKobo: 100_000 });
    expect(merged.fees).toEqual({ ...country.fees, serviceFeeCapKobo: 200_000 });
    expect(merged.timers).toBe(country.timers);
    // The country's own settings, which are cached and shared, are never changed.
    expect(country.pricing.ratePerKmKobo).toBe(20_000);
    expect(withPrices(country, null)).toBe(country);
  });

  it('take only the price fields, as whole naira amounts and percentages', () => {
    expect(PriceOverrideSchema.safeParse({ ratePerKmKobo: 30_000 }).success).toBe(true);
    expect(PriceOverrideSchema.safeParse({}).success).toBe(true);
    expect(PriceOverrideSchema.safeParse({ commissionBps: 100 }).success).toBe(false);
    expect(PriceOverrideSchema.safeParse({ baseFeeKobo: -1 }).success).toBe(false);
    expect(PriceOverrideSchema.safeParse({ serviceFeeBps: 10_001 }).success).toBe(false);
  });

  it('say what is wrong when the result would not work', () => {
    expect(pricesProblem(resolvePrices(country, [{ serviceFeeMinKobo: 200_000 }]))).toMatch(/service fee/i);
    expect(pricesProblem(resolvePrices(country, []))).toBeNull();
  });
});
