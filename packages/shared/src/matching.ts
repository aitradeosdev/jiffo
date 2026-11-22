import type { ErrandState } from './errands';
import { haversineMeters, type LatLng } from './geo';
import type { AgentTier, CountrySettings } from './settings';

/**
 * An errand the agent holds now: urgent or not, whether it is a scheduled one taken ahead, not started yet, where
 * it stands, and its final drop-off.
 */
export interface HeldErrand {
  id: string;
  urgent: boolean;
  startsLater: boolean;
  status: ErrandState;
  dropoff: LatLng | null;
  /** A scheduled errand's start, and its pickup: what an agent holding it ahead must not be late for (M12). */
  startsAt: Date | null;
  pickup: LatLng | null;
  /** The agent has been seen at its pickup (M15). */
  reachedPickup: boolean;
}

/** Within this many metres of a pickup, the agent is there (M15). */
export const AT_PICKUP_METERS = 150;

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

/** How an urgent errand is offered beside one the agent holds: back to back (M10), or carried with it (M13). */
export interface MatchOptions {
  backToBack?: boolean;
  paired?: boolean;
}

/** How far from the agent a pickup may be, in km: their own work radius, within what admin allows. */
export const agentReachKm = (agent: Pick<MatchAgent, 'workRadiusKm'>, rules: Pick<Rules, 'boardRadiusKm'>) =>
  Math.min(agent.workRadiusKm ?? rules.boardRadiusKm, rules.boardRadiusKm);

/**
 * Whether the errands the agent holds let them take one more: an urgent errand is held alone, apart from a
 * scheduled one taken ahead that hasn't started; errands from the board up to the cap. An urgent errand offered
 * back to back (M10) waits behind the one they hold, and no more behind it; one paired with it (M13) is carried
 * beside it, and no third.
 */
export function heldRefusal(
  held: HeldErrand[],
  urgent: boolean,
  rules: Rules,
  options: MatchOptions = {},
): MatchRefusal | null {
  if ((options.backToBack || options.paired) && urgent) {
    return held.filter((e) => !e.startsLater).length > 1 ? 'busy' : null;
  }
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
  options: MatchOptions = {},
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

type TwoAtOnceRules = Pick<CountrySettings['matching'], 'twoAtOnce' | 'twoAtOncePickupKm' | 'twoAtOnceDelayMinutes'>;

/** A stop on a trip carrying two errands: the errand held already, or the next one, and which end of it. */
export interface PairStop {
  errand: 'held' | 'next';
  kind: 'pickup' | 'dropoff';
  at: LatLng;
}

/** The way through both errands' stops, and what it costs the first customer. */
export interface StopOrder {
  order: PairStop[];
  /** How much later the held errand is delivered than going straight there. */
  heldDelaySeconds: number;
  /** How much longer the next errand takes from its pickup to its drop-off than going straight there. */
  nextDelaySeconds: number;
  /** From the agent to the next errand's pickup, along the way. */
  toNextPickupSeconds: number;
  /** All of it. */
  totalSeconds: number;
}

/**
 * The quickest way to carry two errands from where the agent is (M13): both pickups first, then both drop-offs, in
 * whichever order is quickest while neither customer's errand takes more than `maxDelaySeconds` longer than on its
 * own; null if none does. Measured as if the held errand's pickup were still ahead, so its delay is never
 * understated.
 */
export function stopOrder(
  from: LatLng,
  held: { pickup: LatLng; dropoff: LatLng },
  next: { pickup: LatLng; dropoff: LatLng },
  secondsBetween: (a: LatLng, b: LatLng) => number,
  maxDelaySeconds = Number.POSITIVE_INFINITY,
): StopOrder | null {
  const stop = (errand: PairStop['errand'], kind: PairStop['kind']): PairStop => ({
    errand,
    kind,
    at: (errand === 'held' ? held : next)[kind],
  });
  const orders = [
    [stop('held', 'pickup'), stop('next', 'pickup')],
    [stop('next', 'pickup'), stop('held', 'pickup')],
  ].flatMap((p) => [
    [...p, stop('held', 'dropoff'), stop('next', 'dropoff')],
    [...p, stop('next', 'dropoff'), stop('held', 'dropoff')],
  ]);
  const heldAlone = secondsBetween(from, held.pickup) + secondsBetween(held.pickup, held.dropoff);
  const nextAlone = secondsBetween(next.pickup, next.dropoff);
  let best: StopOrder | null = null;
  for (const order of orders) {
    let t = 0;
    let here = from;
    const reached: Record<string, number> = {};
    for (const s of order) {
      t += secondsBetween(here, s.at);
      here = s.at;
      reached[`${s.errand}:${s.kind}`] = t;
    }
    const option: StopOrder = {
      order,
      heldDelaySeconds: Math.max(0, reached['held:dropoff']! - heldAlone),
      nextDelaySeconds: Math.max(0, reached['next:dropoff']! - reached['next:pickup']! - nextAlone),
      toNextPickupSeconds: reached['next:pickup']!,
      totalSeconds: t,
    };
    if (option.heldDelaySeconds > maxDelaySeconds || option.nextDelaySeconds > maxDelaySeconds) continue;
    const quicker = !best || option.totalSeconds < best.totalSeconds - 1e-6;
    const tie = !!best && Math.abs(option.totalSeconds - best.totalSeconds) <= 1e-6;
    if (quicker || (tie && option.heldDelaySeconds < best!.heldDelaySeconds)) best = option;
  }
  return best;
}

/** Where a held errand can have a second carried beside it: accepted, or started and nothing bought yet. */
const PAIRABLE: readonly ErrandState[] = ['accepted', 'started'];

/**
 * The errand an urgent offer could be carried with (docs/matching.md, M13), and the way through both, or null: the
 * one urgent errand the agent holds now, not yet being bought or delivered, nor collected unless they are still at
 * its pickup, its pickup within a km of this one's,
 * and a way through both that keeps each customer's errand at most 10 minutes longer than on its own (Settings,
 * Matching). Off to start.
 */
export function pairWith(
  agent: LatLng & { held: HeldErrand[] },
  next: { pickup: LatLng; dropoff: LatLng },
  rules: TwoAtOnceRules,
  secondsBetween: (a: LatLng, b: LatLng) => number,
): (StopOrder & { held: HeldErrand }) | null {
  if (!rules.twoAtOnce) return null;
  const now = agent.held.filter((e) => !e.startsLater);
  const current = now.length === 1 ? now[0]! : null;
  if (!current?.urgent || !current.pickup || !current.dropoff || !PAIRABLE.includes(current.status)) return null;
  // Collected and left behind: going back for the second would cost its customer more than any way shows.
  if (current.reachedPickup && haversineMeters(agent, current.pickup) > AT_PICKUP_METERS) return null;
  if (haversineMeters(current.pickup, next.pickup) > rules.twoAtOncePickupKm * 1000) return null;
  const way = stopOrder(
    agent,
    { pickup: current.pickup, dropoff: current.dropoff },
    next,
    secondsBetween,
    rules.twoAtOnceDelayMinutes * 60,
  );
  return way ? { ...way, held: current } : null;
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
  /**
   * Where the state has a model (M13): the agent's chance of taking the offer, and the score before it was taken in.
   * The total then has it in.
   */
  prediction?: number;
  beforePrediction?: number;
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
