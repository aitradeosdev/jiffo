import type { AgentTier, CountrySettings } from './settings';

/** An errand the agent holds now: urgent or not, and whether it is a scheduled one taken ahead, not started yet. */
export interface HeldErrand {
  urgent: boolean;
  startsLater: boolean;
}

/** What matching knows about the agent asking. */
export interface MatchAgent {
  userId: string;
  /** The categories they take; null for all. */
  categoryKeys: string[] | null;
  takesPurchases: boolean;
  /** How far they said they'd travel to a pickup; null for as far as Jiffo allows. */
  workRadiusKm: number | null;
  held: HeldErrand[];
}

/** What matching knows about an errand, as seen by that agent. */
export interface MatchErrand {
  customerId: string;
  urgent: boolean;
  categoryKey: string;
  buy: boolean;
  /** From the agent's position to the pickup, in a straight line. */
  pickupMeters: number;
  /**
   * Its customer and this agent are kept apart: a flag links them (one of PAIR_FLAG_KINDS not cleared, or of
   * CONFIRMED_PAIR_FLAG_KINDS confirmed), or either chose not to be matched with the other again.
   */
  keptApart: boolean;
  /** This agent left it, or its customer replaced them on it. */
  gaveUp: boolean;
}

/** Why an agent may not get an errand. */
export type MatchRefusal =
  | 'own_errand'
  | 'finish_urgent'
  | 'busy'
  | 'too_many_errands'
  | 'category_off'
  | 'no_purchases'
  | 'too_far'
  | 'unavailable'
  | 'gave_up';

type Rules = Pick<CountrySettings['matching'], 'boardRadiusKm' | 'maxBoardErrands'>;

/** How far from the agent a pickup may be, in km: their own work radius, within what admin allows. */
export const agentReachKm = (agent: Pick<MatchAgent, 'workRadiusKm'>, rules: Pick<Rules, 'boardRadiusKm'>) =>
  Math.min(agent.workRadiusKm ?? rules.boardRadiusKm, rules.boardRadiusKm);

/**
 * Whether the errands the agent holds let them take one more: an urgent errand is held alone, apart from a
 * scheduled one taken ahead that hasn't started; errands from the board up to the cap.
 */
export function heldRefusal(held: HeldErrand[], urgent: boolean, rules: Rules): MatchRefusal | null {
  if (held.some((e) => e.urgent)) return 'finish_urgent';
  if (urgent) return held.some((e) => !e.startsLater) ? 'busy' : null;
  return held.length >= rules.maxBoardErrands ? 'too_many_errands' : null;
}

/**
 * Who may get an errand (docs/matching.md, M1), once the agent is known to be online, approved, where they say
 * and not held for faked GPS: one decision for the board and for accepting, so an agent can only take what the
 * board would show them.
 */
export function matchRefusal(agent: MatchAgent, errand: MatchErrand, rules: Rules): MatchRefusal | null {
  if (errand.customerId === agent.userId) return 'own_errand';
  const held = heldRefusal(agent.held, errand.urgent, rules);
  if (held) return held;
  if (agent.categoryKeys && !agent.categoryKeys.includes(errand.categoryKey)) return 'category_off';
  if (errand.buy && !agent.takesPurchases) return 'no_purchases';
  if (errand.pickupMeters > agentReachKm(agent, rules) * 1000) return 'too_far';
  if (errand.keptApart) return 'unavailable';
  if (errand.gaveUp) return 'gave_up';
  return null;
}

/** What ranking knows about an agent for one errand (docs/matching.md, M4). */
export interface RankInputs {
  /** By road to the pickup, from the maps provider or estimated. */
  travelSeconds: number;
  /** Of the errands they accepted lately, the share they finished; null with none to count. */
  completionRate: number | null;
  /** Of the offers they had lately, the share they took; null until offers are counted (M9). */
  acceptanceRate: number | null;
  /** Errands they left after accepting, in the last 7 days. */
  cancellations7d: number;
  /** Their average over their last 100 rated errands; null with none. */
  ratingStars: number | null;
  completedErrands: number;
  /** Since their last errand ended, or since going online if later; 0 while they hold one. */
  waitingMinutes: number;
  tier: AgentTier;
}

/** The state's average, for agents with too little history of their own. */
export interface StateAverages {
  reliability: number;
  ratingStars: number;
}

/** Each part of a score, from 0 to 1, and the weighted total with the tier boost on top. */
export interface RankParts {
  travel: number;
  reliability: number;
  rating: number;
  waiting: number;
  boost: number;
  total: number;
}

type RankRules = Pick<CountrySettings['matching'], 'weights' | 'tierBoosts' | 'newAgentErrands'>;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const ratingPart = (stars: number) => clamp01((stars - 3) / 2);

/**
 * An agent's score for an errand (docs/matching.md, M4). The highest gets the first offer.
 * - Travel: 1 minus the minutes to the pickup over 30, floored at 0.
 * - Reliability: the average of the acceptance and completion rates it has, less 0.1 for each cancellation
 *   after accepting in the last 7 days, floored at 0.
 * - Rating: the average stars less 3, over 2, between 0 and 1.
 * - Waiting: minutes since the last errand ended or since going online, over 60, capped at 1.
 * Weighted as Settings, Matching say; then the tier's boost is added on top. A new agent, with fewer completed
 * errands than the settings ask, has the state's average reliability and rating, so is never starved.
 */
export function rankScore(inputs: RankInputs, rules: RankRules, average: StateAverages): RankParts {
  const travel = clamp01(1 - inputs.travelSeconds / 60 / 30);
  const newcomer = inputs.completedErrands < rules.newAgentErrands;
  const rates = [inputs.acceptanceRate, inputs.completionRate].filter((r): r is number => r !== null);
  const reliability =
    newcomer || !rates.length
      ? clamp01(average.reliability)
      : clamp01(rates.reduce((a, b) => a + b, 0) / rates.length - 0.1 * inputs.cancellations7d);
  const rating = ratingPart(newcomer || inputs.ratingStars === null ? average.ratingStars : inputs.ratingStars);
  const waiting = clamp01(inputs.waitingMinutes / 60);
  const w = rules.weights;
  const boost = (rules.tierBoosts[inputs.tier] ?? 0) / 100;
  const total =
    (w.travel * travel + w.reliability * reliability + w.rating * rating + w.waiting * waiting) / 100 + boost;
  return { travel, reliability, rating, waiting, boost, total };
}

/** Highest score first; a tie goes to the shorter travel time. */
export function byRank(a: { score: number; travelSeconds: number }, b: { score: number; travelSeconds: number }) {
  const diff = b.score - a.score;
  return Math.abs(diff) > 1e-9 ? diff : a.travelSeconds - b.travelSeconds;
}
