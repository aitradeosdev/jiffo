/**
 * Money is always held as whole kobo (1 naira = 100 kobo) in a JavaScript safe integer.
 * Rates are basis points (1 bp = 0.01%), so 10% is 1000 bp. Nothing here uses floating-point
 * amounts, which keeps every ledger posting exact.
 */
export type Kobo = number;

export const KOBO_PER_NAIRA = 100;

export function assertKobo(value: number, label = 'amount'): Kobo {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a whole, non-negative number of kobo, got ${value}`);
  }
  return value;
}

export function nairaToKobo(naira: number): Kobo {
  return assertKobo(Math.round(naira * KOBO_PER_NAIRA), 'naira amount');
}

/** Applies a basis-point rate, rounding half up to the nearest kobo. */
export function applyBps(amount: Kobo, bps: number): Kobo {
  assertKobo(amount);
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new RangeError(`rate must be 0 to 10000 basis points, got ${bps}`);
  }
  return Math.floor((amount * bps + 5_000) / 10_000);
}

export interface ServiceFeeRule {
  serviceFeeBps: number;
  serviceFeeMinKobo: Kobo;
  serviceFeeCapKobo: Kobo;
}

/** The customer's service fee: a percentage of the errand fee, held between a minimum and a cap. */
export function serviceFee(errandFee: Kobo, rule: ServiceFeeRule): Kobo {
  const raw = applyBps(errandFee, rule.serviceFeeBps);
  return Math.min(Math.max(raw, rule.serviceFeeMinKobo), rule.serviceFeeCapKobo);
}

/** The agent's commission on the errand fee. Item money and tips are never charged. */
export function commission(errandFee: Kobo, commissionBps: number): Kobo {
  return applyBps(errandFee, commissionBps);
}

/** Formats kobo as naira for display, for example 150050 → "₦1,500.50" and 150000 → "₦1,500". */
export function formatNaira(amount: Kobo): string {
  assertKobo(amount);
  const naira = Math.floor(amount / KOBO_PER_NAIRA);
  const kobo = amount % KOBO_PER_NAIRA;
  const whole = naira.toLocaleString('en-NG');
  return kobo === 0 ? `₦${whole}` : `₦${whole}.${String(kobo).padStart(2, '0')}`;
}
