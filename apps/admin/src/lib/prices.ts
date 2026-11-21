import { PRICE_FIELDS, type PriceOverride } from '@jiffo/shared';

export type PriceField = (typeof PRICE_FIELDS)[number];

/** Each price as the panel names it, and whether it is a percentage (basis points) or naira (kobo). */
export const PRICE_LABELS: Record<PriceField, { label: string; percent: boolean }> = {
  baseFeeKobo: { label: 'Base fee', percent: false },
  ratePerKmKobo: { label: 'Per km', percent: false },
  minFeeKobo: { label: 'Lowest fee allowed', percent: false },
  serviceFeeBps: { label: 'Service fee', percent: true },
  serviceFeeMinKobo: { label: 'Service fee, at least', percent: false },
  serviceFeeCapKobo: { label: 'Service fee, at most', percent: false },
};

/** A price as the form shows it: naira, or a percentage; empty when the level above sets it. */
export function priceInput(field: PriceField, value: number | undefined) {
  if (value === undefined) return '';
  return String(value / 100);
}

/**
 * The prices a form sets: each field filled in, in kobo or basis points; an empty field is left to the level
 * above. Says which field is wrong when one isn't a sensible amount.
 */
export function pricesFromForm(form: FormData): { prices?: PriceOverride; error?: string } {
  const prices: PriceOverride = {};
  for (const field of PRICE_FIELDS) {
    const raw = String(form.get(field) ?? '')
      .replace(/[,₦%\s]/g, '')
      .trim();
    if (!raw) continue;
    const { label, percent } = PRICE_LABELS[field];
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0 || (percent && value > 100)) {
      return { error: `${label}: enter ${percent ? 'a percentage from 0 to 100' : 'an amount in naira'}` };
    }
    prices[field] = Math.round(value * 100);
  }
  return { prices };
}
