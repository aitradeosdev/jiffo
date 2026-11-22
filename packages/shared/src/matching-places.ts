import { z } from 'zod';
import { MatchingSettingsSchema, type CountrySettings } from './settings';

type Matching = CountrySettings['matching'];

/**
 * The Matching values a state, city or area may set for itself (docs/matching.md, M14): how its urgent errands are
 * offered and ranked. Who may get an errand (how recent a position, how far, how many held, the fake-GPS hold) and
 * an agent's own acceptance rules stay the country's, so the board, offers and accepting keep one rule.
 */
export const MATCHING_PLACE_FIELDS = [
  'batchSeconds',
  'offerSeconds',
  'dispatchRetrySeconds',
  'shortlistSize',
  'fallbackSpeedKmh',
  'searchStepsKm',
  'offersPerStep',
  'weights',
  'tierBoosts',
  'newAgentErrands',
  'freeDeclineKm',
  'freeDeclineMinutes',
] as const satisfies ReadonlyArray<keyof Matching>;
export type MatchingPlaceField = (typeof MATCHING_PLACE_FIELDS)[number];

const shape = MatchingSettingsSchema.shape;

/** A place's own Matching values: any of MATCHING_PLACE_FIELDS, each within the bounds the country's have. */
export const MatchingOverrideSchema = z
  .object(
    Object.fromEntries(MATCHING_PLACE_FIELDS.map((f) => [f, shape[f].unwrap().optional()])) as {
      [F in MatchingPlaceField]: z.ZodOptional<ReturnType<(typeof shape)[F]['unwrap']>>;
    },
  )
  .strict();
export type MatchingOverride = z.infer<typeof MatchingOverrideSchema>;

/**
 * Set by a state only: a state's urgent errands are batched together (M5), so the batch waits as long as the
 * state says, whichever of its cities or areas the first errand is in.
 */
export const MATCHING_STATE_FIELDS = ['batchSeconds'] as const satisfies ReadonlyArray<MatchingPlaceField>;

/** What a state, city or area may set: a city or an area leaves the state's fields to its state. */
export const matchingOverrideFor = (scope: 'state' | 'city' | 'area') =>
  scope === 'state' ? MatchingOverrideSchema : MatchingOverrideSchema.omit({ batchSeconds: true });

/** The Matching rules at a place: the country's, with each value from the nearest level that sets it, widest first. */
export function resolveMatching(country: Matching, chain: MatchingOverride[]): Matching {
  const rules = structuredClone(country);
  for (const level of chain) {
    for (const field of MATCHING_PLACE_FIELDS) {
      const value = level[field];
      if (value !== undefined) (rules as Record<string, unknown>)[field] = structuredClone(value);
    }
  }
  return rules;
}

/** Why the Matching rules that result for a place can't be used, and which value says so, or null when they can. */
export function matchingIssue(rules: Matching): { path: string; message: string } | null {
  const checked = MatchingSettingsSchema.safeParse(rules);
  if (checked.success) return null;
  const issue = checked.error.issues[0];
  return {
    path: issue?.path.join('.') ?? '',
    message: issue?.message ?? 'These Matching values do not work together',
  };
}

/** Why the Matching rules that result for a place can't be used, in words for the admin, or null when they can. */
export const matchingProblem = (rules: Matching) => matchingIssue(rules)?.message ?? null;
