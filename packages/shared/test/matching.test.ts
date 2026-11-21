import { describe, expect, it } from 'vitest';
import { CountrySettingsSchema, NIGERIA_DEFAULT_SETTINGS } from '../src/settings';
import { matchRefusal, type HeldErrand, type MatchAgent, type MatchErrand } from '../src/matching';

const rules = NIGERIA_DEFAULT_SETTINGS.matching;

const agent = (over: Partial<MatchAgent> = {}): MatchAgent => ({
  userId: 'agent-1',
  categoryKeys: null,
  takesPurchases: true,
  held: [],
  ...over,
});

const errand = (over: Partial<MatchErrand> = {}): MatchErrand => ({
  customerId: 'customer-1',
  urgent: false,
  categoryKey: 'parcel',
  buy: false,
  pickupMeters: 1_500,
  pairFlagged: false,
  gaveUp: false,
  ...over,
});

const held = (over: Partial<HeldErrand> = {}): HeldErrand => ({ urgent: false, startsLater: false, ...over });

/**
 * Who may get an errand (docs/matching.md, M1): one decision for the board and for accepting, so an agent can
 * only take what the board would show them.
 */
describe('who may get an errand', () => {
  it('lets an agent take an errand that passes every check', () => {
    expect(matchRefusal(agent(), errand(), rules)).toBeNull();
  });

  it('never gives agents their own errand', () => {
    expect(matchRefusal(agent({ userId: 'customer-1' }), errand(), rules)).toBe('own_errand');
  });

  it("follows the agent's categories and whether they buy items", () => {
    expect(matchRefusal(agent({ categoryKeys: ['groceries'] }), errand(), rules)).toBe('category_off');
    expect(matchRefusal(agent({ categoryKeys: ['groceries', 'parcel'] }), errand(), rules)).toBeNull();
    expect(matchRefusal(agent({ takesPurchases: false }), errand({ buy: true }), rules)).toBe('no_purchases');
  });

  it('needs the pickup within reach of where the agent is', () => {
    expect(matchRefusal(agent(), errand({ pickupMeters: rules.boardRadiusKm * 1000 }), rules)).toBeNull();
    expect(matchRefusal(agent(), errand({ pickupMeters: rules.boardRadiusKm * 1000 + 1 }), rules)).toBe('too_far');
  });

  it('keeps apart a customer and an agent flagged together', () => {
    expect(matchRefusal(agent(), errand({ pairFlagged: true }), rules)).toBe('unavailable');
  });

  it('never gives an errand back to an agent who left it or was replaced on it', () => {
    expect(matchRefusal(agent(), errand({ gaveUp: true }), rules)).toBe('gave_up');
  });

  describe('errands at once', () => {
    it('holds an urgent errand alone: nothing more until it is done', () => {
      const busy = agent({ held: [held({ urgent: true })] });
      expect(matchRefusal(busy, errand(), rules)).toBe('finish_urgent');
      expect(matchRefusal(busy, errand({ urgent: true }), rules)).toBe('finish_urgent');
    });

    it('gives an urgent errand only to an agent holding nothing else', () => {
      expect(matchRefusal(agent({ held: [held()] }), errand({ urgent: true }), rules)).toBe('busy');
      expect(matchRefusal(agent(), errand({ urgent: true }), rules)).toBeNull();
    });

    it("doesn't count a scheduled errand that hasn't started against an urgent one", () => {
      const later = agent({ held: [held({ startsLater: true })] });
      expect(matchRefusal(later, errand({ urgent: true }), rules)).toBeNull();
    });

    it('lets an agent hold several errands from the board, up to the cap', () => {
      const full = Array.from({ length: rules.maxBoardErrands }, () => held());
      expect(matchRefusal(agent({ held: full.slice(1) }), errand(), rules)).toBeNull();
      expect(matchRefusal(agent({ held: full }), errand(), rules)).toBe('too_many_errands');
      // A scheduled errand taken ahead is held all the same.
      const withLater = [...full.slice(1), held({ startsLater: true })];
      expect(matchRefusal(agent({ held: withLater }), errand(), rules)).toBe('too_many_errands');
    });
  });
});

describe('the Matching settings', () => {
  it('start at the agreed values', () => {
    expect(rules).toEqual({
      locationFreshMinutes: 2,
      boardRadiusKm: 10,
      maxBoardErrands: 3,
      fakeGpsHoldHours: 24,
    });
  });

  it('come with their starting values in versions saved before the group existed', () => {
    const { matching: _, ...older } = NIGERIA_DEFAULT_SETTINGS;
    expect(CountrySettingsSchema.parse(older).matching).toEqual(rules);
  });

  it('replace the old cap on errands held at once, which meant no limit by default', () => {
    const older = {
      ...NIGERIA_DEFAULT_SETTINGS,
      security: { ...NIGERIA_DEFAULT_SETTINGS.security, maxActiveErrandsPerAgent: 0 },
    };
    expect(CountrySettingsSchema.parse(older).security).not.toHaveProperty('maxActiveErrandsPerAgent');
  });
});
