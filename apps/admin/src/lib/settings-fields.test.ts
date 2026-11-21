import { describe, expect, it } from 'vitest';
import { FIELD_BY_PATH, getAt, setAt, shown } from './settings-fields';

describe('settings fields', () => {
  it('reads and writes nested values without touching the original', () => {
    const before = { fees: { commissionBps: { gold: 1000 } } };
    const after = setAt(before, 'fees.commissionBps.gold', 900);
    expect(getAt(after, 'fees.commissionBps.gold')).toBe(900);
    expect(before.fees.commissionBps.gold).toBe(1000);
  });

  it('shows stored values in the units people use', () => {
    expect(shown(FIELD_BY_PATH.get('pricing.minFeeKobo'), 100_000)).toBe('₦1,000');
    expect(shown(FIELD_BY_PATH.get('fees.commissionBps.gold'), 1_250)).toBe('12.5%');
    expect(shown(FIELD_BY_PATH.get('fees.launchCommissionBps'), null)).toBe('none');
    expect(shown(FIELD_BY_PATH.get('timers.autoReleaseHours'), 24)).toBe('24 h');
    expect(shown(FIELD_BY_PATH.get('identity.agentIdTypes'), ['nin', 'bvn'])).toBe('NIN, BVN');
    expect(shown(FIELD_BY_PATH.get('matching.searchStepsKm'), [3, 6, 10])).toBe('3 km, 6 km, 10 km');
  });

  it('has the acceptance rate settings, with no pause to start (docs/matching.md, M9)', () => {
    expect(shown(FIELD_BY_PATH.get('matching.freeDeclineKm'), 3)).toBe('3 km');
    expect(shown(FIELD_BY_PATH.get('matching.pauseBelowBps'), null)).toBe('none');
    expect(shown(FIELD_BY_PATH.get('matching.pauseBelowBps'), 6_000)).toBe('60%');
    for (const path of ['freeDeclineMinutes', 'acceptanceOffers', 'pauseMinOffers', 'pauseMinutes']) {
      expect(FIELD_BY_PATH.has(`matching.${path}`)).toBe(true);
    }
  });

  it('has the search steps in place of the old single widening (docs/matching.md, M8)', () => {
    expect(FIELD_BY_PATH.get('matching.searchStepsKm')?.kind).toBe('kmList');
    expect(FIELD_BY_PATH.get('matching.offersPerStep')?.kind).toBe('count');
    expect(FIELD_BY_PATH.has('timers.urgentWidenMinutes')).toBe(false);
  });
});
