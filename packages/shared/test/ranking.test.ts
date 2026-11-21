import { describe, expect, it } from 'vitest';
import { CountrySettingsSchema, NIGERIA_DEFAULT_SETTINGS } from '../src/settings';
import { byRank, rankScore, type RankInputs } from '../src/matching';

const rules = NIGERIA_DEFAULT_SETTINGS.matching;
const average = { reliability: 0.9, ratingStars: 4.5 };

const inputs = (over: Partial<RankInputs> = {}): RankInputs => ({
  travelSeconds: 0,
  completionRate: 1,
  acceptanceRate: null,
  cancellations7d: 0,
  ratingStars: 5,
  completedErrands: 50,
  waitingMinutes: 60,
  tier: 'bronze',
  ...over,
});

/**
 * Who gets an errand first (docs/matching.md, M4): a score from 0 to 1, mostly how soon they reach the pickup,
 * then reliability, rating and how long they've waited, with the weights in Settings, Matching.
 */
describe('ranking', () => {
  it('scores the pickup travel time: 1 at once, 0 from half an hour', () => {
    expect(rankScore(inputs({ travelSeconds: 0 }), rules, average).travel).toBe(1);
    expect(rankScore(inputs({ travelSeconds: 15 * 60 }), rules, average).travel).toBe(0.5);
    expect(rankScore(inputs({ travelSeconds: 45 * 60 }), rules, average).travel).toBe(0);
  });

  it('scores reliability: the rates it has, less 0.1 for each cancellation this week, never below 0', () => {
    expect(rankScore(inputs({ completionRate: 0.9 }), rules, average).reliability).toBeCloseTo(0.9);
    expect(rankScore(inputs({ completionRate: 0.9, acceptanceRate: 0.7 }), rules, average).reliability).toBeCloseTo(
      0.8,
    );
    expect(rankScore(inputs({ completionRate: 0.9, cancellations7d: 2 }), rules, average).reliability).toBeCloseTo(0.7);
    expect(rankScore(inputs({ completionRate: 0.3, cancellations7d: 5 }), rules, average).reliability).toBe(0);
  });

  it('scores the rating from 3 stars (0) to 5 (1)', () => {
    expect(rankScore(inputs({ ratingStars: 5 }), rules, average).rating).toBe(1);
    expect(rankScore(inputs({ ratingStars: 4 }), rules, average).rating).toBe(0.5);
    expect(rankScore(inputs({ ratingStars: 2 }), rules, average).rating).toBe(0);
  });

  it('scores the wait since the last errand or going online, full from an hour', () => {
    expect(rankScore(inputs({ waitingMinutes: 30 }), rules, average).waiting).toBe(0.5);
    expect(rankScore(inputs({ waitingMinutes: 90 }), rules, average).waiting).toBe(1);
    expect(rankScore(inputs({ waitingMinutes: 0 }), rules, average).waiting).toBe(0);
  });

  it('weighs the parts by the settings: 60% travel, 20% reliability, 10% rating, 10% waiting', () => {
    const parts = rankScore(
      inputs({ travelSeconds: 15 * 60, completionRate: 0.5, ratingStars: 4, waitingMinutes: 30 }),
      rules,
      average,
    );
    expect(parts.total).toBeCloseTo(0.6 * 0.5 + 0.2 * 0.5 + 0.1 * 0.5 + 0.1 * 0.5);
  });

  it('gives new agents the state’s average reliability and rating, so they are never starved', () => {
    const fresh = inputs({ completedErrands: 3, completionRate: null, ratingStars: null });
    const parts = rankScore(fresh, rules, average);
    expect(parts.reliability).toBeCloseTo(0.9);
    expect(parts.rating).toBeCloseTo(0.75);
    // Even with a bad start: until the history counts, the state's average stands.
    const unlucky = rankScore(inputs({ completedErrands: 3, completionRate: 0.2, ratingStars: 1 }), rules, average);
    expect(unlucky.reliability).toBeCloseTo(0.9);
    expect(unlucky.rating).toBeCloseTo(0.75);
  });

  it('still takes 0.1 off a new agent for each errand they left this week', () => {
    const leaving = rankScore(inputs({ completedErrands: 3, cancellations7d: 2 }), rules, average);
    expect(leaving.reliability).toBeCloseTo(0.7);
    expect(rankScore(inputs({ completedErrands: 3, cancellations7d: 12 }), rules, average).reliability).toBe(0);
  });

  it('adds a tier boost on top, so a boosted score can pass 1', () => {
    const boosted = { ...rules, tierBoosts: { ...rules.tierBoosts, gold: 20 } };
    const gold = rankScore(inputs({ tier: 'gold' }), boosted, average);
    expect(gold.boost).toBeCloseTo(0.2);
    expect(gold.total).toBeCloseTo(1.2);
    expect(rankScore(inputs({ tier: 'bronze' }), boosted, average).boost).toBe(0);
  });

  it('puts the expected agent first, and a weight change reorders as expected', () => {
    // Near but poorly rated, against a little further and well rated.
    const near = { id: 'near', ...inputs({ travelSeconds: 3 * 60, ratingStars: 3 }) };
    const rated = { id: 'rated', ...inputs({ travelSeconds: 9 * 60, ratingStars: 5 }) };
    const order = (r: typeof rules) =>
      [near, rated]
        .map((a) => ({ id: a.id, travelSeconds: a.travelSeconds, score: rankScore(a, r, average).total }))
        .sort(byRank)
        .map((a) => a.id);
    expect(order(rules)).toEqual(['near', 'rated']);
    expect(order({ ...rules, weights: { travel: 30, reliability: 20, rating: 40, waiting: 10 } })).toEqual([
      'rated',
      'near',
    ]);
  });

  it('breaks a tie with the shorter travel time', () => {
    const tied = [
      { id: 'far', travelSeconds: 600, score: 0.8 },
      { id: 'near', travelSeconds: 300, score: 0.8 },
    ];
    expect([...tied].sort(byRank).map((a) => a.id)).toEqual(['near', 'far']);
  });

  describe('its settings', () => {
    it('start at the plan’s values', () => {
      expect(rules.weights).toEqual({ travel: 60, reliability: 20, rating: 10, waiting: 10 });
      expect(rules.tierBoosts).toEqual({ bronze: 0, silver: 0, gold: 0, platinum: 0 });
      expect(rules.newAgentErrands).toBe(10);
    });

    it('refuse weights that don’t add up to 100%, saying so beside the first of them', () => {
      const bad = structuredClone(NIGERIA_DEFAULT_SETTINGS);
      bad.matching.weights = { travel: 60, reliability: 20, rating: 10, waiting: 20 };
      const parsed = CountrySettingsSchema.safeParse(bad);
      expect(parsed.success).toBe(false);
      expect(parsed.error!.issues[0]).toMatchObject({
        path: ['matching', 'weights', 'travel'],
        message: 'The ranking weights must add up to 100%',
      });
    });

    it('take tier boosts from 0 to 20 points', () => {
      const bad = structuredClone(NIGERIA_DEFAULT_SETTINGS);
      bad.matching.tierBoosts = { ...bad.matching.tierBoosts, gold: 25 };
      expect(CountrySettingsSchema.safeParse(bad).success).toBe(false);
    });
  });
});
