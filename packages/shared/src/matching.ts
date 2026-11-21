import type { CountrySettings } from './settings';

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
  /** A flag links its customer and this agent (PAIR_FLAG_KINDS), not cleared. */
  pairFlagged: boolean;
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
  if (errand.pickupMeters > rules.boardRadiusKm * 1000) return 'too_far';
  if (errand.pairFlagged) return 'unavailable';
  if (errand.gaveUp) return 'gave_up';
  return null;
}
