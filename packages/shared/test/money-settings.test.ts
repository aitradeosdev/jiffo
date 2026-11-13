import { describe, expect, it } from 'vitest';
import {
  applyBps,
  assertKobo,
  commission,
  commissionBpsFor,
  formatNaira,
  holdsEarnings,
  nairaToKobo,
  serviceFee,
  splitFeeEscrow,
} from '../src/money';
import { CountrySettingsSchema, NIGERIA_DEFAULT_SETTINGS, publicSettings } from '../src/settings';
import { normaliseIdNumber } from '../src/identity';

describe('money', () => {
  it('converts naira to whole kobo', () => {
    expect(nairaToKobo(1500)).toBe(150_000);
    expect(nairaToKobo(0.1 + 0.2)).toBe(30);
  });

  it('rejects fractional or negative kobo', () => {
    expect(() => assertKobo(1.5)).toThrow(RangeError);
    expect(() => assertKobo(-1)).toThrow(RangeError);
  });

  it('applies basis points with half-up rounding', () => {
    expect(applyBps(150_000, 1_500)).toBe(22_500);
    expect(applyBps(5, 1_000)).toBe(1); // 0.5 kobo rounds up
    expect(applyBps(4, 1_000)).toBe(0);
  });

  it('holds the service fee between its minimum and cap', () => {
    const rule = NIGERIA_DEFAULT_SETTINGS.fees;
    expect(serviceFee(150_000, rule)).toBe(15_000);
    expect(serviceFee(50_000, rule)).toBe(10_000); // minimum
    expect(serviceFee(5_000_000, rule)).toBe(100_000); // cap
  });

  it('charges commission on the errand fee only', () => {
    expect(commission(200_000, NIGERIA_DEFAULT_SETTINGS.fees.commissionBps.bronze)).toBe(30_000);
  });

  it('uses the launch commission while it is on', () => {
    const fees = NIGERIA_DEFAULT_SETTINGS.fees;
    expect(commissionBpsFor(fees, 'gold')).toBe(1_000);
    expect(commissionBpsFor({ ...fees, launchCommissionBps: 500 }, 'gold')).toBe(500);
  });

  it('splits the fee escrow so the parts add up', () => {
    const split = splitFeeEscrow({ feeKobo: 250_001, serviceFeeKobo: 25_000, commissionBps: 1_500 });
    expect(split).toEqual({ agentKobo: 212_501, commissionKobo: 37_500, serviceFeeKobo: 25_000, escrowKobo: 275_001 });
    expect(split.agentKobo + split.commissionKobo + split.serviceFeeKobo).toBe(split.escrowKobo);
  });

  it('holds earnings for Bronze only', () => {
    expect(holdsEarnings('bronze')).toBe(true);
    expect(holdsEarnings('silver')).toBe(false);
  });

  it('formats naira for display', () => {
    expect(formatNaira(150_000)).toBe('₦1,500');
    expect(formatNaira(150_050)).toBe('₦1,500.50');
  });
});

describe('country settings', () => {
  it('reads settings saved before the deposit and withdrawal limits existed', () => {
    const old = structuredClone(NIGERIA_DEFAULT_SETTINGS) as {
      limits: Partial<typeof NIGERIA_DEFAULT_SETTINGS.limits>;
      timers: Partial<typeof NIGERIA_DEFAULT_SETTINGS.timers>;
    };
    delete old.limits.minDepositKobo;
    delete old.limits.maxDepositKobo;
    delete old.limits.minWithdrawalKobo;
    delete old.timers.depositAccountMinutes;
    const parsed = CountrySettingsSchema.parse(old);
    expect(parsed.limits).toMatchObject({ minDepositKobo: 10_000, maxDepositKobo: null, minWithdrawalKobo: 10_000 });
    expect(parsed.timers.depositAccountMinutes).toBe(30);
  });

  it('accepts the Nigerian defaults', () => {
    expect(CountrySettingsSchema.parse(NIGERIA_DEFAULT_SETTINGS)).toEqual(NIGERIA_DEFAULT_SETTINGS);
  });

  it('rejects a service fee minimum above its cap', () => {
    const bad = structuredClone(NIGERIA_DEFAULT_SETTINGS);
    bad.fees.serviceFeeMinKobo = 200_000;
    expect(CountrySettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('keeps limits and the identity provider out of the public settings', () => {
    const pub = publicSettings(NIGERIA_DEFAULT_SETTINGS);
    expect(pub).not.toHaveProperty('limits');
    expect(pub.identity).not.toHaveProperty('provider');
    expect(pub.fees).not.toHaveProperty('commissionBps');
    expect(pub.wallet).toEqual({ minDepositKobo: 10_000, maxDepositKobo: null, minWithdrawalKobo: 10_000 });
  });
});

describe('ID numbers', () => {
  it('normalises spacing and checks the format', () => {
    expect(normaliseIdNumber('nin', '2201 384 5576')).toBe('22013845576');
    expect(normaliseIdNumber('nin', '2201')).toBeNull();
    expect(normaliseIdNumber('drivers_licence', 'lag12345aa12')).toBe('LAG12345AA12');
  });
});
