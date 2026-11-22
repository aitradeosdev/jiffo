import type { ErrandState } from './errands';
import { haversineMeters, type LatLng } from './geo';
import type { AgentTier, CountrySettings } from './settings';

/**
 * An errand the agent holds now: urgent or not, whether it is a scheduled one taken ahead, not started yet, where
 * it stands, and its final drop-off.
 */
export interface HeldErrand {
  urgent: boolean;
  startsLater: boolean;
  status: ErrandState;
  dropoff: LatLng | null;
  /** A scheduled errand's start, and its pickup: what an agent holding it ahead must not be late for (M12). */
  startsAt: Date | null;
  pickup: LatLng | null;
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
  /** Of the errands they accepted lately, the share they didn't leave (M4); null with none to count. */
  completionRate: number | null;
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
  /** Scheduled for later (M12): taken ahead only by agents who finish what they accept. */
  scheduled: boolean;
  /** Its drop-off doesn't bring the agent nearer the destination they set (M13). */
  offRoute: boolean;
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
  | 'gave_up'
  | 'completion_low'
  /** It doesn't take them towards the destination they set (M13). */
  | 'off_route'
  /** It would make them late for a scheduled errand they hold (M12). */
  | 'late_for_scheduled';

type Rules = Pick<CountrySettings['matching'], 'boardRadiusKm' | 'maxBoardErrands' | 'scheduledMinCompletionBps'>;

/** How far from the agent a pickup may be, in km: their own work radius, within what admin allows. */
export const agentReachKm = (agent: Pick<MatchAgent, 'workRadiusKm'>, rules: Pick<Rules, 'boardRadiusKm'>) =>
  Math.min(agent.workRadiusKm ?? rules.boardRadiusKm, rules.boardRadiusKm);

/**
 * Whether the errands the agent holds let them take one more: an urgent errand is held alone, apart from a
 * scheduled one taken ahead that hasn't started; errands from the board up to the cap. An urgent errand offered
 * back to back (M10) waits behind the one they hold, and no more behind it.
 */
export function heldRefusal(
  held: HeldErrand[],
  urgent: boolean,
  rules: Rules,
  options: { backToBack?: boolean } = {},
): MatchRefusal | null {
  if (options.backToBack && urgent) return held.filter((e) => !e.startsLater).length > 1 ? 'busy' : null;
  if (held.some((e) => e.urgent)) return 'finish_urgent';
  if (urgent) return held.some((e) => !e.startsLater) ? 'busy' : null;
  return held.length >= rules.maxBoardErrands ? 'too_many_errands' : null;
}

/**
 * Who may get an errand (docs/matching.md, M1), once the agent is known to be online, approved, where they say
 * and not held for faked GPS: one decision for the board and for accepting, so an agent can only take what the
 * board would show them.
 */
export function matchRefusal(
  agent: MatchAgent,
  errand: MatchErrand,
  rules: Rules,
  options: { backToBack?: boolean } = {},
): MatchRefusal | null {
  if (errand.customerId === agent.userId) return 'own_errand';
  const held = heldRefusal(agent.held, errand.urgent, rules, options);
  if (held) return held;
  if (agent.categoryKeys && !agent.categoryKeys.includes(errand.categoryKey)) return 'category_off';
  if (errand.buy && !agent.takesPurchases) return 'no_purchases';
  if (errand.pickupMeters > agentReachKm(agent, rules) * 1000) return 'too_far';
  if (errand.keptApart) return 'unavailable';
  if (errand.gaveUp) return 'gave_up';
  if (errand.offRoute) return 'off_route';
  // Scheduled errands go to agents who finish what they accept (M12), as Bolt's do; a new agent has no rate yet.
  if (
    errand.scheduled &&
    agent.completionRate !== null &&
    agent.completionRate * 10_000 < rules.scheduledMinCompletionBps
  ) {
    return 'completion_low';
  }
  return null;
}

/**
 * Whether an errand's drop-off brings an agent heading for a destination nearer it (docs/matching.md, M13): by at
 * least the share of the way Settings, Matching gives, measured in straight lines.
 */
export function bringsCloser(
  from: LatLng,
  dropoff: LatLng,
  destination: LatLng,
  rules: Pick<CountrySettings['matching'], 'destinationCloserBps'>,
): boolean {
  const now = haversineMeters(from, destination);
  return haversineMeters(dropoff, destination) <= now * (1 - rules.destinationCloserBps / 10_000);
}

/**
 * Whether an urgent errand would make the agent late for a scheduled one they hold, taken ahead (M12): finished at
 * `finish.at` at its last drop-off, they must still reach that one's pickup by its start. `secondsBetween` is how
 * long the drive between two places takes.
 */
export function lateForScheduled(
  held: HeldErrand[],
  finish: { at: number; dropoff: LatLng },
  secondsBetween: (a: LatLng, b: LatLng) => number,
): boolean {
  return held.some(
    (e) =>
      e.startsLater &&
      !!e.startsAt &&
      !!e.pickup &&
      finish.at + secondsBetween(finish.dropoff, e.pickup) * 1000 > e.startsAt.getTime(),
  );
}

type BackToBackRules = Pick<CountrySettings['matching'], 'backToBack' | 'backToBackDropoffKm' | 'backToBackPickupKm'>;

/** Where an errand is under way, and can be followed back to back; marked delivered, or a photo sent, at its end. */
const UNDER_WAY: readonly ErrandState[] = ['started', 'item_pending', 'items_locked', 'delivered', 'photo_pending'];
const AT_THE_END: readonly ErrandState[] = ['delivered', 'photo_pending'];

/**
 * The errand an urgent offer could follow back to back (docs/matching.md, M10), or null: the one errand the agent
 * holds now, under way, with them within a km of its final drop-off or having marked it delivered, and the next
 * pickup within 3 km of that drop-off (Settings, Matching). A scheduled errand taken ahead, not started, isn't
 * held now; one already waiting behind the current one leaves no room.
 */
export function backToBackFrom(
  agent: LatLng & { held: HeldErrand[] },
  pickup: LatLng,
  rules: BackToBackRules,
): HeldErrand | null {
  if (!rules.backToBack) return null;
  const now = agent.held.filter((e) => !e.startsLater);
  const current = now.length === 1 ? now[0]! : null;
  if (!current?.dropoff || !UNDER_WAY.includes(current.status)) return null;
  const nearEnd =
    AT_THE_END.includes(current.status) || haversineMeters(agent, current.dropoff) <= rules.backToBackDropoffKm * 1000;
  if (!nearEnd) return null;
  return haversineMeters(current.dropoff, pickup) <= rules.backToBackPickupKm * 1000 ? current : null;
}

/** Whether the errand is at its end already, so the time to finish it is the hand-off alone. */
export const atTheEnd = (e: Pick<HeldErrand, 'status'>) => AT_THE_END.includes(e.status);

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
 * errands than the settings ask, has the state's average reliability (less their own cancellations this week)
 * and rating, so is never starved.
 */
export function rankScore(inputs: RankInputs, rules: RankRules, average: StateAverages): RankParts {
  const travel = clamp01(1 - inputs.travelSeconds / 60 / 30);
  const newcomer = inputs.completedErrands < rules.newAgentErrands;
  const rates = [inputs.acceptanceRate, inputs.completionRate].filter((r): r is number => r !== null);
  // Leaving errands after accepting them costs a new agent too, from the state's average.
  const base = newcomer || !rates.length ? average.reliability : rates.reduce((a, b) => a + b, 0) / rates.length;
  const reliability = clamp01(base - 0.1 * inputs.cancellations7d);
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

type SearchRules = Pick<CountrySettings['matching'], 'searchStepsKm' | 'offersPerStep'>;

/**
 * Which step an urgent errand's search is at (docs/matching.md, M8), from how many agents were offered it at this
 * fee: the step's index and radius, or null once every step has had its offers and it goes to everyone at once.
 */
export function searchStep(offersMade: number, rules: SearchRules): { index: number; km: number } | null {
  const index = Math.floor(offersMade / rules.offersPerStep);
  return index < rules.searchStepsKm.length ? { index, km: rules.searchStepsKm[index]! } : null;
}

/**
 * How far the search reaches now, for the customer: the radius of the step its latest offer was made at, or of a
 * step further out where it widened early, with no one to ask nearer (`farthestMeters`: the furthest agent
 * offered it at this fee).
 */
export function searchRadiusKm(offersMade: number, farthestMeters: number | null, rules: SearchRules): number {
  const last = rules.searchStepsKm.at(-1)!;
  const step = searchStep(Math.max(0, offersMade - 1), rules)?.km ?? last;
  const reached = farthestMeters === null ? 0 : (rules.searchStepsKm.find((km) => km * 1000 >= farthestMeters) ?? last);
  return Math.max(step, reached);
}

type AcceptanceRules = Pick<
  CountrySettings['matching'],
  'freeDeclineKm' | 'freeDeclineMinutes' | 'pauseBelowBps' | 'acceptanceMinOffers'
>;

/**
 * Whether an offer counts toward the agent's acceptance rate (docs/matching.md, M9): not one whose pickup is far,
 * nor one in the first minutes after going online, so declining those is free. Offers to everyone at once never
 * count, and are kept apart.
 */
export function offerCounts(
  offer: { straightMeters: number; offeredAt: Date; onlineSince: Date | null },
  rules: Pick<AcceptanceRules, 'freeDeclineKm' | 'freeDeclineMinutes'>,
): boolean {
  if (offer.straightMeters > rules.freeDeclineKm * 1000) return false;
  if (!offer.onlineSince) return false;
  return offer.offeredAt.getTime() - offer.onlineSince.getTime() >= rules.freeDeclineMinutes * 60_000;
}

/**
 * Whether a low acceptance rate pauses the agent's offers now (M9): only where admin set a level, after enough
 * counted offers, and only below it, compared in whole numbers so a rate exactly at the level never is.
 */
export function pausesOffers(
  offers: { taken: number; answered: number },
  rules: Pick<AcceptanceRules, 'pauseBelowBps' | 'acceptanceMinOffers'>,
): boolean {
  if (rules.pauseBelowBps === null || offers.answered < rules.acceptanceMinOffers) return false;
  return offers.taken * 10_000 < rules.pauseBelowBps * offers.answered;
}

/**
 * A state's reliability, for agents with too little history of their own (M4): its completion and acceptance
 * rates together, as an agent's own are, so neither newcomers nor the established gain from the difference.
 */
export function averageReliability(rates: { completion: number | null; acceptance: number | null }): number {
  const known = [rates.completion, rates.acceptance].filter((r): r is number => r !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
}
