import { describe, expect, it } from 'vitest';
import { priceInput, pricesFromForm } from './prices';

/** The prices form (Settings, Places): naira and percentages on screen, kobo and basis points to the API. */
describe('prices form', () => {
  it('shows kobo as naira and basis points as a percentage, and nothing for a value left to the level above', () => {
    expect(priceInput('baseFeeKobo', 70_000)).toBe('700');
    expect(priceInput('minFeeKobo', 150_050)).toBe('1500.5');
    expect(priceInput('serviceFeeBps', 850)).toBe('8.5');
    expect(priceInput('ratePerKmKobo', undefined)).toBe('');
  });

  it('reads the form back, leaving empty fields to the level above', () => {
    const form = new FormData();
    form.set('baseFeeKobo', '700');
    form.set('ratePerKmKobo', '');
    form.set('minFeeKobo', '1,500.5');
    form.set('serviceFeeBps', '8.5');
    expect(pricesFromForm(form)).toEqual({
      prices: { baseFeeKobo: 70_000, minFeeKobo: 150_050, serviceFeeBps: 850 },
    });
  });

  it('says which field is wrong when one is not a sensible amount', () => {
    const form = new FormData();
    form.set('baseFeeKobo', '-5');
    expect(pricesFromForm(form).error).toMatch(/base fee/i);
    const pct = new FormData();
    pct.set('serviceFeeBps', '120');
    expect(pricesFromForm(pct).error).toMatch(/service fee/i);
    const text = new FormData();
    text.set('ratePerKmKobo', 'abc');
    expect(pricesFromForm(text).error).toMatch(/per km/i);
  });
});
