import { describe, expect, it } from 'vitest';
import { CountrySettingsSchema, NIGERIA_DEFAULT_SETTINGS } from '../src/settings';
import {
  matchRefusal,
  searchRadiusKm,
  searchStep,
  type HeldErrand,
  type MatchAgent,
  type MatchErrand,
} from '../src/matching';

const rules = NIGERIA_DEFAULT_SETTINGS.matching;

const agent = (over: Partial<MatchAgent> = {}): MatchAgent => ({
  userId: 'agent-1',
  categoryKeys: null,
  takesPurchases: true,
  workRadiusKm: null,
  held: [],
  ...over,
});

const errand = (over: Partial<MatchErrand> = {}): MatchErrand => ({
  customerId: 'customer-1',
  urgent: false,
  categoryKey: 'parcel',
  buy: false,
  pickupMeters: 1_500,
  keptApart: false,
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

  it("keeps to the agent's own work radius, within Jiffo's reach", () => {
    const near = agent({ workRadiusKm: 3 });
    expect(matchRefusal(near, errand({ pickupMeters: 3_000 }), rules)).toBeNull();
    expect(matchRefusal(near, errand({ pickupMeters: 3_001 }), rules)).toBe('too_far');
    // A radius wider than admin allows reaches only as far as admin allows.
    const wide = agent({ workRadiusKm: 50 });
    expect(matchRefusal(wide, errand({ pickupMeters: rules.boardRadiusKm * 1000 + 1 }), rules)).toBe('too_far');
  });

  it('keeps apart a customer and an agent flagged together, or when either chose not to be matched again', () => {
    expect(matchRefusal(agent(), errand({ keptApart: true }), rules)).toBe('unavailable');
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
      shortlistSize: 10,
      fallbackSpeedKmh: 20,
      weights: { travel: 60, reliability: 20, rating: 10, waiting: 10 },
      tierBoosts: { bronze: 0, silver: 0, gold: 0, platinum: 0 },
      newAgentErrands: 10,
      searchStepsKm: [3, 6, 10],
      offersPerStep: 5,
      offers: true,
      offerSeconds: 20,
      missedOffersOffline: 3,
      dispatchRetrySeconds: 15,
    });
  });

  it('come with their starting values in versions saved before the group existed', () => {
    const { matching: _, ...older } = NIGERIA_DEFAULT_SETTINGS;
    expect(CountrySettingsSchema.parse(older).matching).toEqual(rules);
  });

  it('keep a cap on errands held at once that admin had saved, as the cap on errands from the board', () => {
    const { matching: _, ...older } = NIGERIA_DEFAULT_SETTINGS;
    const withCap = (cap: number) => ({ ...older, security: { ...older.security, maxActiveErrandsPerAgent: cap } });
    expect(CountrySettingsSchema.parse(withCap(1)).matching.maxBoardErrands).toBe(1);
    expect(CountrySettingsSchema.parse(withCap(20)).matching.maxBoardErrands).toBe(10);
    // 0 meant no limit: such a country starts at the new cap.
    expect(CountrySettingsSchema.parse(withCap(0)).matching.maxBoardErrands).toBe(3);
    // Saved with the Matching group, its own cap stands.
    expect(CountrySettingsSchema.parse({ ...withCap(1), matching: rules }).matching.maxBoardErrands).toBe(3);
  });

  it('replace the old cap on errands held at once, which meant no limit by default', () => {
    const older = {
      ...NIGERIA_DEFAULT_SETTINGS,
      security: { ...NIGERIA_DEFAULT_SETTINGS.security, maxActiveErrandsPerAgent: 0 },
    };
    expect(CountrySettingsSchema.parse(older).security).not.toHaveProperty('maxActiveErrandsPerAgent');
  });
});

/** An urgent errand's search (docs/matching.md, M8): 3 km, 6 km, then 10 km, 5 offers each, then everyone. */
describe('the search steps', () => {
  const rules = { searchStepsKm: [3, 6, 10], offersPerStep: 5 };

  it('moves out a step after each step has had its offers, then to everyone at once', () => {
    expect(searchStep(0, rules)).toEqual({ index: 0, km: 3 });
    expect(searchStep(4, rules)).toEqual({ index: 0, km: 3 });
    expect(searchStep(5, rules)).toEqual({ index: 1, km: 6 });
    expect(searchStep(14, rules)).toEqual({ index: 2, km: 10 });
    expect(searchStep(15, rules)).toBeNull();
    expect(searchStep(40, rules)).toBeNull();
  });

  it("says how far it reaches: its latest offer's step, or further where it widened early for want of agents", () => {
    expect(searchRadiusKm(0, null, rules)).toBe(3);
    expect(searchRadiusKm(1, 2_500, rules)).toBe(3);
    // The fifth offer was the first step's last.
    expect(searchRadiusKm(5, 2_500, rules)).toBe(3);
    // One offer made, to an agent 4 km away: there was no one within 3 km.
    expect(searchRadiusKm(1, 4_000, rules)).toBe(6);
    expect(searchRadiusKm(6, 1_000, rules)).toBe(6);
    expect(searchRadiusKm(15, 9_000, rules)).toBe(10);
  });

  it("must widen step by step, within the board's reach", () => {
    const parse = (matching: Record<string, unknown>) =>
      CountrySettingsSchema.safeParse({
        ...NIGERIA_DEFAULT_SETTINGS,
        matching: { ...NIGERIA_DEFAULT_SETTINGS.matching, ...matching },
      });
    expect(parse({ searchStepsKm: [2, 5] }).success).toBe(true);
    const narrowing = parse({ searchStepsKm: [6, 3, 10] });
    expect(narrowing.success).toBe(false);
    expect(JSON.stringify(narrowing.error)).toContain('Each search step must reach further than the one before');
    const past = parse({ searchStepsKm: [3, 6, 12] });
    expect(past.success).toBe(false);
    expect(JSON.stringify(past.error)).toContain("can't reach past how far the board reaches");
    expect(parse({ searchStepsKm: [] }).success).toBe(false);
  });

  it("gives a version saved before the steps ones that end at its board's reach, so it still loads", () => {
    const saved = (boardRadiusKm: number) => {
      const { searchStepsKm: _s, offersPerStep: _o, ...older } = NIGERIA_DEFAULT_SETTINGS.matching;
      return CountrySettingsSchema.parse({ ...NIGERIA_DEFAULT_SETTINGS, matching: { ...older, boardRadiusKm } })
        .matching.searchStepsKm;
    };
    expect(saved(10)).toEqual([3, 6, 10]);
    expect(saved(20)).toEqual([3, 6, 10]);
    expect(saved(8)).toEqual([3, 6, 8]);
    expect(saved(5)).toEqual([3, 5]);
    expect(saved(3)).toEqual([3]);
    expect(saved(1)).toEqual([1]);
  });

  it('drops the old single widening, which the steps replace', () => {
    expect(CountrySettingsSchema.parse(NIGERIA_DEFAULT_SETTINGS).timers).not.toHaveProperty('urgentWidenMinutes');
  });
});
