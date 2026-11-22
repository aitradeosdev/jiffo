import { describe, expect, it } from 'vitest';
import { matchingOverrideFor, MatchingOverrideSchema, matchingProblem, resolveMatching } from '../src/matching-places';
import { DEFAULT_MATCHING_SETTINGS } from '../src/settings';

/** Matching values a state, city or area sets for itself (docs/matching.md, M14). */
describe('Matching per place', () => {
  it('takes the offer and ranking values a place may set, and nothing of who may get an errand', () => {
    expect(MatchingOverrideSchema.parse({ offerSeconds: 30, searchStepsKm: [2, 4] })).toEqual({
      offerSeconds: 30,
      searchStepsKm: [2, 4],
    });
    expect(MatchingOverrideSchema.parse({})).toEqual({});
    // Who may get an errand stays the country's, so the board and accepting keep one rule.
    expect(MatchingOverrideSchema.safeParse({ boardRadiusKm: 20 }).success).toBe(false);
    expect(MatchingOverrideSchema.safeParse({ maxBoardErrands: 5 }).success).toBe(false);
    // Each value within its bounds, as in the country's settings.
    expect(MatchingOverrideSchema.safeParse({ offerSeconds: 2 }).success).toBe(false);
    expect(
      MatchingOverrideSchema.safeParse({ weights: { travel: 50, reliability: 20, rating: 10, waiting: 10 } }).success,
    ).toBe(false);
  });

  it("leaves how long a state's batch waits to the state", () => {
    expect(matchingOverrideFor('state').parse({ batchSeconds: 5 })).toEqual({ batchSeconds: 5 });
    expect(matchingOverrideFor('city').safeParse({ batchSeconds: 5 }).success).toBe(false);
    expect(matchingOverrideFor('area').safeParse({ batchSeconds: 5 }).success).toBe(false);
    expect(matchingOverrideFor('area').parse({ offerSeconds: 30 })).toEqual({ offerSeconds: 30 });
  });

  it('uses each value from the nearest place that sets it: area, then city, then state, then the country', () => {
    const country = { ...DEFAULT_MATCHING_SETTINGS };
    const state = { offerSeconds: 30, shortlistSize: 6 };
    const city = { offerSeconds: 25 };
    const area = { searchStepsKm: [2, 5] };
    const rules = resolveMatching(country, [state, city, area]);
    expect(rules).toMatchObject({ offerSeconds: 25, shortlistSize: 6, searchStepsKm: [2, 5] });
    expect(rules.boardRadiusKm).toBe(country.boardRadiusKm);
    expect(resolveMatching(country, [])).toEqual(country);
  });

  it('says why the values that result for a place would not work', () => {
    expect(matchingProblem(resolveMatching({ ...DEFAULT_MATCHING_SETTINGS }, [{ searchStepsKm: [3, 6] }]))).toBeNull();
    // Past how far the country's board reaches.
    expect(
      matchingProblem(
        resolveMatching({ ...DEFAULT_MATCHING_SETTINGS, boardRadiusKm: 8 }, [{ searchStepsKm: [3, 12] }]),
      ),
    ).toMatch(/can't reach past how far the board reaches/);
  });
});
