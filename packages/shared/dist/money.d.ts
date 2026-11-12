/**
 * Money is always held as whole kobo (1 naira = 100 kobo) in a JavaScript safe integer.
 * Rates are basis points (1 bp = 0.01%), so 10% is 1000 bp. Nothing here uses floating-point
 * amounts, which keeps every ledger posting exact.
 */
export type Kobo = number;
export declare const KOBO_PER_NAIRA = 100;
export declare function assertKobo(value: number, label?: string): Kobo;
export declare function nairaToKobo(naira: number): Kobo;
/** Applies a basis-point rate, rounding half up to the nearest kobo. */
export declare function applyBps(amount: Kobo, bps: number): Kobo;
export interface ServiceFeeRule {
    serviceFeeBps: number;
    serviceFeeMinKobo: Kobo;
    serviceFeeCapKobo: Kobo;
}
/** The customer's service fee: a percentage of the errand fee, held between a minimum and a cap. */
export declare function serviceFee(errandFee: Kobo, rule: ServiceFeeRule): Kobo;
/** The agent's commission on the errand fee. Item money and tips are never charged. */
export declare function commission(errandFee: Kobo, commissionBps: number): Kobo;
/** Formats kobo as naira for display, for example 150050 → "₦1,500.50" and 150000 → "₦1,500". */
export declare function formatNaira(amount: Kobo): string;
