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

  it("gives each parse its own copy of a group's default, so changing one changes no other", () => {
    const without: Record<string, unknown> = structuredClone(NIGERIA_DEFAULT_SETTINGS);
    for (const group of ['topUps', 'security', 'risk', 'safety']) delete without[group];
    const a = CountrySettingsSchema.parse(without);
    const b = CountrySettingsSchema.parse(without);
    expect(a.security).not.toBe(b.security);
    expect(a.security.releaseReminderHours).not.toBe(b.security.releaseReminderHours);
    expect(a.security.releaseReminderHours).not.toBe(DEFAULT_SECURITY_SETTINGS.releaseReminderHours);
    expect(a.topUps).not.toBe(b.topUps);
    expect(a.risk).not.toBe(b.risk);
    expect(a.safety).not.toBe(b.safety);
  });

  it('refuses an ID reveal alert at or above the daily reveal limit, which it would never reach', () => {
    const bad = structuredClone(NIGERIA_DEFAULT_SETTINGS);
    bad.security.idRevealAlertAt = bad.security.dailyIdReveals;
    const res = CountrySettingsSchema.safeParse(bad);
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(['security', 'idRevealAlertAt']);
  });

  it('reports the service fee rule on the minimum', () => {
    const bad = structuredClone(NIGERIA_DEFAULT_SETTINGS);
    bad.fees.serviceFeeMinKobo = bad.fees.serviceFeeCapKobo + 1;
    const res = CountrySettingsSchema.safeParse(bad);
    expect(res.success).toBe(false);
    expect(res.error?.issues[0]?.path).toEqual(['fees', 'serviceFeeMinKobo']);
  });
});
