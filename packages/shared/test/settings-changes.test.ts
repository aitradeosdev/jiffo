import { describe, expect, it } from 'vitest';
import { CountrySettingsSchema, NIGERIA_DEFAULT_SETTINGS, settingChanges } from '../src/settings';

describe('settingChanges', () => {
  it('lists each changed setting by path, and treats lists as sets', () => {
    expect(
      settingChanges(
        { fees: { gold: 1000, silver: 1250 }, ids: ['nin', 'bvn'] },
        { fees: { gold: 900, silver: 1250 }, ids: ['bvn', 'nin'] },
      ),
    ).toEqual([{ path: 'fees.gold', from: 1000, to: 900 }]);
    expect(settingChanges({ a: null }, { a: 5, b: 1 })).toEqual([
      { path: 'a', from: null, to: 5 },
      { path: 'b', from: null, to: 1 },
    ]);
  });

  it('reports the service fee rule on the minimum', () => {
    const bad = structuredClone(NIGERIA_DEFAULT_SETTINGS);
    bad.fees.serviceFeeMinKobo = bad.fees.serviceFeeCapKobo + 1;
    const res = CountrySettingsSchema.safeParse(bad);
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(['fees', 'serviceFeeMinKobo']);
  });
});
