import { describe, expect, it } from 'vitest';
import { haversineMeters } from '../src/geo';
import { CountrySettingsSchema, NIGERIA_DEFAULT_SETTINGS } from '../src/settings';
import {
  averageReliability,
  backToBackFrom,
  bringsCloser,
  lateForScheduled,
  matchRefusal,
  offerCounts,
  pausesOffers,
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
  completionRate: null,
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
  scheduled: false,
  offRoute: false,
  ...over,
});

const held = (over: Partial<HeldErrand> = {}): HeldErrand => ({
  urgent: false,
  startsLater: false,
  status: 'accepted',
  dropoff: null,
  startsAt: null,
  pickup: null,
  ...over,
});

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
      batchSeconds: 3,
      freeDeclineKm: 3,
      freeDeclineMinutes: 2,
      acceptanceOffers: 50,
      acceptanceMinOffers: 10,
      pauseBelowBps: null,
      pauseMinutes: 30,
      boardTravelTimes: false,
      backToBack: true,
      backToBackDropoffKm: 1,
      backToBackPickupKm: 3,
      scheduledMinCompletionBps: 5_000,
      scheduledOnlineMinutes: 15,
      scheduledTakeBackMinutes: 10,
      destinationMode: true,
      destinationUsesPerDay: 2,
      destinationCloserBps: 2_000,
      predictionShareBps: 2_000,
      predictionMinOffers: 500,
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

/** The acceptance rate (docs/matching.md, M9): the share of an agent's recent counted offers they took. */
describe('the acceptance rate', () => {
  const rules = { freeDeclineKm: 3, freeDeclineMinutes: 2, pauseBelowBps: 6_000, acceptanceMinOffers: 10 };
  const at = new Date('2026-11-21T10:00:00.000Z');
  const ago = (minutes: number) => new Date(at.getTime() - minutes * 60_000);

  it('counts offers near enough, once the agent has been online a little while', () => {
    expect(offerCounts({ straightMeters: 2_500, offeredAt: at, onlineSince: ago(30) }, rules)).toBe(true);
    expect(offerCounts({ straightMeters: 3_000, offeredAt: at, onlineSince: ago(2) }, rules)).toBe(true);
    // Further than 3 km to the pickup: declining it is free.
    expect(offerCounts({ straightMeters: 3_001, offeredAt: at, onlineSince: ago(30) }, rules)).toBe(false);
    // Within 2 minutes of going online.
    expect(offerCounts({ straightMeters: 500, offeredAt: at, onlineSince: ago(1) }, rules)).toBe(false);
    expect(offerCounts({ straightMeters: 500, offeredAt: at, onlineSince: null }, rules)).toBe(false);
  });

  it('pauses offers below the level admin set, once there are enough counted offers, and never when off', () => {
    expect(pausesOffers({ taken: 5, answered: 10 }, rules)).toBe(true);
    expect(pausesOffers({ taken: 6, answered: 10 }, rules)).toBe(false);
    expect(pausesOffers({ taken: 1, answered: 9 }, rules)).toBe(false);
    expect(pausesOffers({ taken: 0, answered: 50 }, { ...rules, pauseBelowBps: null })).toBe(false);
    // Exactly at the level isn't below it, whatever rounding would make of 57%.
    expect(pausesOffers({ taken: 57, answered: 100 }, { ...rules, pauseBelowBps: 5_700 })).toBe(false);
    expect(pausesOffers({ taken: 56, answered: 100 }, { ...rules, pauseBelowBps: 5_700 })).toBe(true);
  });

  it("compares agents with too little history to the state's reliability, acceptance included", () => {
    expect(averageReliability({ completion: 0.9, acceptance: 0.7 })).toBeCloseTo(0.8);
    expect(averageReliability({ completion: 0.9, acceptance: null })).toBe(0.9);
    expect(averageReliability({ completion: null, acceptance: null })).toBe(1);
  });

  it('needs the rate to be over at least as many offers as it takes to count', () => {
    const parse = (matching: Record<string, unknown>) =>
      CountrySettingsSchema.safeParse({
        ...NIGERIA_DEFAULT_SETTINGS,
        matching: { ...NIGERIA_DEFAULT_SETTINGS.matching, ...matching },
      });
    expect(parse({ acceptanceOffers: 50, acceptanceMinOffers: 50 }).success).toBe(true);
    const never = parse({ acceptanceOffers: 50, acceptanceMinOffers: 60 });
    expect(never.success).toBe(false);
    expect(JSON.stringify(never.error)).toContain('more offers than the rate is over');
  });
});

/**
 * Back-to-back offers (docs/matching.md, M10): an agent near the end of an errand can be offered the next urgent
 * errand whose pickup is near its drop-off, and hold it behind the current one, as Uber's back-to-back trips.
 */
describe('back-to-back offers', () => {
  const dropoff = { lat: 6.5, lng: 3.4 };
  const east = (km: number) => ({ lat: dropoff.lat, lng: dropoff.lng + km / 111 });
  const current = held({ urgent: true, status: 'started', dropoff });

  it('offers the next urgent errand to an agent within a km of the drop-off, its pickup within 3 km of it', () => {
    expect(backToBackFrom({ ...east(0.5), held: [current] }, east(2.5), rules)).toBe(current);
    // Marked delivered: wherever they are.
    const delivered = held({ status: 'delivered', dropoff });
    expect(backToBackFrom({ ...east(4), held: [delivered] }, east(2), rules)).toBe(delivered);
    expect(
      backToBackFrom({ ...east(4), held: [held({ status: 'photo_pending', dropoff })] }, east(2), rules),
    ).not.toBeNull();
    // A scheduled errand taken ahead, not started, doesn't count as one held now.
    expect(backToBackFrom({ ...east(0.5), held: [current, held({ startsLater: true })] }, east(1), rules)).toBe(
      current,
    );
  });

  it('not further from the drop-off, unless delivered, nor with the next pickup too far from it', () => {
    expect(backToBackFrom({ ...east(1.5), held: [current] }, east(1), rules)).toBeNull();
    expect(backToBackFrom({ ...east(0.5), held: [current] }, east(3.5), rules)).toBeNull();
    // As admin sets the distances.
    const wider = { ...rules, backToBackDropoffKm: 2, backToBackPickupKm: 4 };
    expect(backToBackFrom({ ...east(1.5), held: [current] }, east(3.5), wider)).toBe(current);
  });

  it('not before the errand is under way, with one already waiting behind it, or with it switched off', () => {
    expect(backToBackFrom({ ...east(0.2), held: [held({ status: 'accepted', dropoff })] }, east(1), rules)).toBeNull();
    expect(
      backToBackFrom({ ...east(0.2), held: [held({ status: 'unreachable', dropoff })] }, east(1), rules),
    ).toBeNull();
    expect(backToBackFrom({ ...east(0.2), held: [current, held({ urgent: true })] }, east(1), rules)).toBeNull();
    expect(backToBackFrom({ ...east(0.2), held: [] }, east(1), rules)).toBeNull();
    expect(backToBackFrom({ ...east(0.2), held: [current] }, east(1), { ...rules, backToBack: false })).toBeNull();
  });

  it('lets the agent take it while holding the current one, and never a third', () => {
    const busy = agent({ held: [current] });
    expect(matchRefusal(busy, errand({ urgent: true }), rules)).toBe('finish_urgent');
    expect(matchRefusal(busy, errand({ urgent: true }), rules, { backToBack: true })).toBeNull();
    const waiting = agent({ held: [current, held({ urgent: true })] });
    expect(matchRefusal(waiting, errand({ urgent: true }), rules, { backToBack: true })).toBe('busy');
    // The other checks still apply.
    expect(matchRefusal(busy, errand({ urgent: true, gaveUp: true }), rules, { backToBack: true })).toBe('gave_up');
    // Only urgent errands go back to back.
    expect(matchRefusal(busy, errand(), rules, { backToBack: true })).toBe('finish_urgent');
  });

  it('measures straight-line distance on the earth', () => {
    expect(Math.round(haversineMeters(dropoff, east(1)))).toBeGreaterThan(990);
    expect(Math.round(haversineMeters(dropoff, east(1)))).toBeLessThan(1_010);
    expect(haversineMeters(dropoff, dropoff)).toBe(0);
  });
});

/**
 * Scheduled errands (docs/matching.md, M12), as Bolt's scheduled rides: taken ahead from the board only by agents who
 * finish what they accept, and never left with one who isn't ready.
 */
describe('scheduled errands', () => {
  it('go only to agents with a completion rate of 50% or more, and to new agents with none yet', () => {
    const scheduled = errand({ scheduled: true });
    expect(matchRefusal(agent({ completionRate: 0.4 }), scheduled, rules)).toBe('completion_low');
    expect(matchRefusal(agent({ completionRate: 0.5 }), scheduled, rules)).toBeNull();
    expect(matchRefusal(agent({ completionRate: null }), scheduled, rules)).toBeNull();
    // Errands now go to anyone, as before.
    expect(matchRefusal(agent({ completionRate: 0.4 }), errand(), rules)).toBeNull();
    // As admin sets the bar.
    expect(
      matchRefusal(agent({ completionRate: 0.4 }), scheduled, { ...rules, scheduledMinCompletionBps: 3_000 }),
    ).toBeNull();
  });

  it('start with the agreed values, the errand taken back before the agent must be online', () => {
    expect(rules).toMatchObject({
      scheduledMinCompletionBps: 5_000,
      scheduledOnlineMinutes: 15,
      scheduledTakeBackMinutes: 10,
    });
    const bad = { ...NIGERIA_DEFAULT_SETTINGS, matching: { ...rules, scheduledTakeBackMinutes: 20 } };
    expect(CountrySettingsSchema.safeParse(bad).success).toBe(false);
  });

  it('keep an agent from an urgent errand that would make them late for one they hold', () => {
    const start = Date.parse('2026-11-22T12:00:00Z');
    const ahead = held({ startsLater: true, startsAt: new Date(start), pickup: { lat: 6.5, lng: 3.4 } });
    // Ten minutes to drive between, at most.
    const tenMinutes = () => 600;
    const dropoff = { lat: 6.51, lng: 3.4 };
    expect(lateForScheduled([ahead], { at: start - 15 * 60_000, dropoff }, tenMinutes)).toBe(false);
    expect(lateForScheduled([ahead], { at: start - 5 * 60_000, dropoff }, tenMinutes)).toBe(true);
    // An errand not taken ahead, or one with nothing scheduled, never.
    expect(lateForScheduled([held()], { at: start, dropoff }, tenMinutes)).toBe(false);
    expect(lateForScheduled([], { at: start, dropoff }, tenMinutes)).toBe(false);
  });
});

/**
 * Destination mode (docs/matching.md, M13), as Uber's and Bolt's: an agent heading somewhere, such as home, gets
 * only errands whose drop-off brings them closer.
 */
describe('destination mode', () => {
  const home = { lat: 6.5, lng: 3.5 };
  const west = (km: number) => ({ lat: home.lat, lng: home.lng - km / 111 });

  it('takes an errand whose drop-off is a fifth nearer the destination, at least, than the agent is now', () => {
    // 10 km off: a drop-off 8 km off or nearer brings them closer.
    expect(bringsCloser(west(10), west(5), home, rules)).toBe(true);
    expect(bringsCloser(west(10), west(7.9), home, rules)).toBe(true);
    expect(bringsCloser(west(10), west(9), home, rules)).toBe(false);
    // Further away, or past it on the far side.
    expect(bringsCloser(west(10), west(12), home, rules)).toBe(false);
    expect(bringsCloser(west(10), { lat: home.lat, lng: home.lng + 12 / 111 }, home, rules)).toBe(false);
    // As admin sets it.
    expect(bringsCloser(west(10), west(9), home, { ...rules, destinationCloserBps: 500 })).toBe(true);
  });

  it('refuses an errand that takes the agent away from where they are heading', () => {
    expect(matchRefusal(agent(), errand({ offRoute: true }), rules)).toBe('off_route');
    expect(matchRefusal(agent(), errand({ offRoute: false }), rules)).toBeNull();
  });

  it('starts on, twice a day, a fifth nearer', () => {
    expect(rules).toMatchObject({ destinationMode: true, destinationUsesPerDay: 2, destinationCloserBps: 2_000 });
  });
});
