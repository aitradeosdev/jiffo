import { describe, expect, it } from 'vitest';
import {
  CountrySettingsSchema,
  DEFAULT_RISK_SETTINGS,
  DEFAULT_SAFETY_SETTINGS,
  DEFAULT_SECURITY_SETTINGS,
  NIGERIA_DEFAULT_SETTINGS,
  settingChanges,
} from '../src/settings';

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

  it('keeps a list of numbers in number order', () => {
    expect(settingChanges({ hours: [2, 12, 20] }, { hours: [2, 12, 18] })).toEqual([
      { path: 'hours', from: [2, 12, 20], to: [2, 12, 18] },
    ]);
  });

  it('fills a group a saved version never had with its whole default, as parsing it would', () => {
    const defaults = {
      topUps: { oneTimeAccount: true, fixedAccount: false },
      security: DEFAULT_SECURITY_SETTINGS,
      risk: DEFAULT_RISK_SETTINGS,
      safety: DEFAULT_SAFETY_SETTINGS,
    };
    for (const [group, value] of Object.entries(defaults)) {
      const without: Record<string, unknown> = structuredClone(NIGERIA_DEFAULT_SETTINGS);
      delete without[group];
      const given = { ...structuredClone(NIGERIA_DEFAULT_SETTINGS), [group]: structuredClone(value) };
      const filled = CountrySettingsSchema.parse(without) as Record<string, unknown>;
      expect(filled[group], group).toEqual((CountrySettingsSchema.parse(given) as Record<string, unknown>)[group]);
    }
  });

  it('reports the service fee rule on the minimum', () => {
    const bad = structuredClone(NIGERIA_DEFAULT_SETTINGS);
    bad.fees.serviceFeeMinKobo = bad.fees.serviceFeeCapKobo + 1;
    const res = CountrySettingsSchema.safeParse(bad);
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(['fees', 'serviceFeeMinKobo']);
  });
});
