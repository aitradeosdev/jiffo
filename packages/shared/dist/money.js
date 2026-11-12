"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KOBO_PER_NAIRA = void 0;
exports.assertKobo = assertKobo;
exports.nairaToKobo = nairaToKobo;
exports.applyBps = applyBps;
exports.serviceFee = serviceFee;
exports.commission = commission;
exports.formatNaira = formatNaira;
exports.KOBO_PER_NAIRA = 100;
function assertKobo(value, label = 'amount') {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${label} must be a whole, non-negative number of kobo, got ${value}`);
    }
    return value;
}
function nairaToKobo(naira) {
    return assertKobo(Math.round(naira * exports.KOBO_PER_NAIRA), 'naira amount');
}
/** Applies a basis-point rate, rounding half up to the nearest kobo. */
function applyBps(amount, bps) {
    assertKobo(amount);
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
        throw new RangeError(`rate must be 0 to 10000 basis points, got ${bps}`);
    }
    return Math.floor((amount * bps + 5_000) / 10_000);
}
/** The customer's service fee: a percentage of the errand fee, held between a minimum and a cap. */
function serviceFee(errandFee, rule) {
    const raw = applyBps(errandFee, rule.serviceFeeBps);
    return Math.min(Math.max(raw, rule.serviceFeeMinKobo), rule.serviceFeeCapKobo);
}
/** The agent's commission on the errand fee. Item money and tips are never charged. */
function commission(errandFee, commissionBps) {
    return applyBps(errandFee, commissionBps);
}
/** Formats kobo as naira for display, for example 150050 → "₦1,500.50" and 150000 → "₦1,500". */
function formatNaira(amount) {
    assertKobo(amount);
    const naira = Math.floor(amount / exports.KOBO_PER_NAIRA);
    const kobo = amount % exports.KOBO_PER_NAIRA;
    const whole = naira.toLocaleString('en-NG');
    return kobo === 0 ? `₦${whole}` : `₦${whole}.${String(kobo).padStart(2, '0')}`;
}
//# sourceMappingURL=money.js.map