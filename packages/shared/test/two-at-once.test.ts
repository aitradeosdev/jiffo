import { describe, expect, it } from 'vitest';
import { haversineMeters, type LatLng } from '../src/geo';
import { heldRefusal, pairWith, stopOrder, type HeldErrand } from '../src/matching';
import { DEFAULT_MATCHING_SETTINGS, NIGERIA_DEFAULT_SETTINGS } from '../src/settings';

/** About a km east or north, this near the equator. */
const ORIGIN = { lat: 6.5, lng: 3.35 };
const at = (eastKm: number, northKm = 0): LatLng => ({
  lat: ORIGIN.lat + northKm / 110.6,
  lng: ORIGIN.lng + eastKm / 110,
});

/** Two minutes a km, as the fallback speed has it near enough. */
const secondsBetween = (a: LatLng, b: LatLng) => (haversineMeters(a, b) / 1000) * 120;

const held = (over: Partial<HeldErrand> = {}): HeldErrand => ({
  id: 'first',
  urgent: true,
  startsLater: false,
  status: 'accepted',
  pickup: at(1),
  dropoff: at(5),
  startsAt: null,
  reachedPickup: false,
  ...over,
});

const ON = { ...DEFAULT_MATCHING_SETTINGS, twoAtOnce: true };

/**
 * Two errands at once (docs/matching.md, M13), as DoorDash stacks orders: an agent on the way to one urgent errand's
 * pickup can be offered a second whose pickup is near it, when carrying both keeps the first customer's delivery
 * within a few minutes of what it would have been.
 */
describe('two errands at once', () => {
  it('starts switched off, with the second pickup within a km and the first customer at most 10 minutes later', () => {
    expect(NIGERIA_DEFAULT_SETTINGS.matching).toMatchObject({
      twoAtOnce: false,
      twoAtOncePickupKm: 1,
      twoAtOnceDelayMinutes: 10,
    });
    const agent = { ...ORIGIN, held: [held()] };
    expect(
      pairWith(agent, { pickup: at(1.5), dropoff: at(5.5) }, DEFAULT_MATCHING_SETTINGS, secondsBetween),
    ).toBeNull();
  });

  it('pairs a second errand picked up near the first, going the same way', () => {
    const agent = { ...ORIGIN, held: [held()] };
    // 600 m off the first's pickup, a little aside.
    const pickup = at(1.2, 0.6);
    const paired = pairWith(agent, { pickup, dropoff: at(5.5) }, ON, secondsBetween)!;
    expect(paired.held.id).toBe('first');
    // Both pickups, nearest first, then the first's drop-off, which is on the way to the second's.
    expect(paired.order.map((s) => `${s.errand}:${s.kind}`)).toEqual([
      'held:pickup',
      'next:pickup',
      'held:dropoff',
      'next:dropoff',
    ]);
    // The step aside costs the first customer about a minute; the second, next to nothing.
    expect(paired.heldDelaySeconds).toBeGreaterThan(30);
    expect(paired.heldDelaySeconds).toBeLessThan(120);
    expect(paired.nextDelaySeconds).toBeLessThan(30);
    // To the second pickup by way of the first.
    expect(paired.toNextPickupSeconds).toBeCloseTo(secondsBetween(ORIGIN, at(1)) + secondsBetween(at(1), pickup), 6);
  });

  it('delivers the second first when that is quicker and the first customer still waits little longer', () => {
    const order = stopOrder(
      ORIGIN,
      { pickup: at(1), dropoff: at(6) },
      { pickup: at(1.2), dropoff: at(3) },
      secondsBetween,
    )!;
    expect(order.order.map((s) => `${s.errand}:${s.kind}`)).toEqual([
      'held:pickup',
      'next:pickup',
      'next:dropoff',
      'held:dropoff',
    ]);
    expect(order.heldDelaySeconds).toBeLessThan(60);
    expect(order.nextDelaySeconds).toBeLessThan(60);
  });

  it("never when the second pickup is too far from the first's, or the first customer would wait too long", () => {
    const agent = { ...ORIGIN, held: [held()] };
    expect(pairWith(agent, { pickup: at(2.2), dropoff: at(5.5) }, ON, secondsBetween)).toBeNull();
    // Near pickup, but the drop-off the other way: whichever is delivered second would wait far longer.
    expect(pairWith(agent, { pickup: at(1.5), dropoff: at(-6) }, ON, secondsBetween)).toBeNull();
    expect(
      pairWith(agent, { pickup: at(1.5), dropoff: at(-6) }, { ...ON, twoAtOnceDelayMinutes: 30 }, secondsBetween),
    ).not.toBeNull();
  });

  it('only beside one urgent errand not yet carried: never a third, nor beside a board errand or one being bought', () => {
    const next = { pickup: at(1.5), dropoff: at(5.5) };
    const pair = (h: HeldErrand[]) => pairWith({ ...ORIGIN, held: h }, next, ON, secondsBetween);
    expect(pair([])).toBeNull();
    expect(pair([held(), held({ id: 'second' })])).toBeNull();
    expect(pair([held({ urgent: false })])).toBeNull();
    expect(pair([held({ status: 'started' })])).not.toBeNull();
    for (const status of ['item_pending', 'items_locked', 'delivered', 'photo_pending'] as const) {
      expect(pair([held({ status })])).toBeNull();
    }
    // A scheduled one taken ahead and not started doesn't count as held now.
    expect(pair([held(), held({ id: 'later', urgent: false, startsLater: true })])).not.toBeNull();
  });

  it('lets a paired offer be taken beside the one urgent errand held, and no more', () => {
    expect(heldRefusal([held()], true, ON)).toBe('finish_urgent');
    expect(heldRefusal([held()], true, ON, { paired: true })).toBeNull();
    expect(heldRefusal([held(), held({ id: 'second' })], true, ON, { paired: true })).toBe('busy');
    expect(heldRefusal([], true, ON, { paired: true })).toBeNull();
  });

  it("not once the first errand's pickup is collected and left behind: only while the agent is still there", () => {
    const next = { pickup: at(1.2, 0.6), dropoff: at(5.5) };
    const collected = held({ status: 'started', reachedPickup: true });
    // Gone on 3 km towards its drop-off: going back would cost its customer far more than the way shows.
    expect(pairWith({ ...at(4), held: [collected] }, next, ON, secondsBetween)).toBeNull();
    // Still at the shop, 50 m off: the way on starts from here.
    expect(pairWith({ ...at(1.05), held: [collected] }, next, ON, secondsBetween)).not.toBeNull();
  });
});
