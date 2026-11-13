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
  });
});
