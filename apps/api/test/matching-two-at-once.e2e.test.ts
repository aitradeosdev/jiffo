import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS, haversineMeters } from '@jiffo/shared';
import { agentPresence, errandOffers, errands } from '../src/db/schema';
import { AgentLocations } from '../src/matching/agent-locations';
import { TravelTimesService } from '../src/matching/travel-times';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import {
  act,
  adminAs,
  approved,
  createErrand,
  createTestApp,
  fund,
  signIn,
  type Person,
  type TestApp,
} from './helpers';

const box = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});

// Benin City, away from the places the other test files draw and send errands.
const BENIN = box(5.5, 6.25, 5.75, 6.45);
const GRA = box(5.52, 6.28, 5.72, 6.42);
const ORIGIN = { lat: 6.33, lng: 5.6 };
/** About a km east, or north, this near the equator. */
const east = (km: number, from = ORIGIN) => ({ lat: from.lat, lng: from.lng + km / 110.5 });
const north = (from: { lat: number; lng: number }, km: number) => ({ lat: from.lat + km / 110.6, lng: from.lng });

/**
 * Two errands at once (docs/matching.md, M13), as DoorDash stacks orders: an agent on the way to an urgent errand's
 * pickup can be offered a second urgent errand picked up near it, when carrying both keeps each customer's errand
 * within a few minutes of what it would take alone. Both are carried at once, both customers follow the agent, and
 * the agent is shown the order of the stops. Switched off to start.
 */
describe('two errands at once', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let original: { settings: { matching: Record<string, unknown> } };
  let first: Person;
  let second: Person;

  async function matching(changes: Record<string, unknown>) {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    Object.assign(settings.matching, changes);
    const res = await approved(t, 'owner', (h) =>
      request(t.http)
        .post('/v1/admin/settings?country=NG')
        .set(h)
        .send({ basedOn: now.version, settings, note: 'Matching values for a test' }),
    );
    expect(res.status).toBe(200);
  }

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    // As the other test files have it: agents moved across the city in an instant aren't held for faked GPS.
    await matching({ ...DEFAULT_MATCHING_SETTINGS, fakeGpsHoldHours: 0 });
    first = await signIn(t, 'customer');
    second = await signIn(t, 'customer');
    await fund(t, first, 100_000_000);
    await fund(t, second, 100_000_000);
    const admin = (path: string, body: object, method: 'post' | 'patch' = 'post') =>
      request(t.http)[method](`/v1/admin${path}`).set(owner.headers).send(body);
    const states = (await request(t.http).get('/v1/admin/states?country=NG').set(owner.headers).expect(200))
      .body as Array<{ id: string; code: string }>;
    const edo = states.find((s) => s.code === 'ED')!.id;
    const city = (await admin('/cities', { stateId: edo, name: 'Benin City', boundary: BENIN }).expect(201)).body.id;
    const area = (await admin('/areas', { cityId: city, name: 'GRA', boundary: GRA }).expect(201)).body.id;
    await admin(`/cities/${city}`, { enabled: true }, 'patch').expect(200);
    await admin(`/areas/${area}`, { enabled: true }, 'patch').expect(200);
  });
  // Each test starts with every agent so far offline, no urgent errand waiting, and two at once off.
  afterEach(async () => {
    await matching({ twoAtOnce: false });
    await t.db.update(errandOffers).set({ status: 'withdrawn' }).where(eq(errandOffers.status, 'open'));
    await t.db
      .update(errands)
      .set({ status: 'expired' })
      .where(and(eq(errands.status, 'requested'), eq(errands.urgent, true)));
    const off = await t.db
      .update(agentPresence)
      .set({ online: false, onlineSince: null })
      .where(eq(agentPresence.online, true))
      .returning({ userId: agentPresence.userId });
    for (const o of off) await t.app.get(AgentLocations).remove(o.userId, 'NG');
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await matching(original.settings.matching);
    await t.close();
  });

  const report = (agent: Person, at: { lat: number; lng: number }) =>
    request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, ...at })
      .expect(200);
  const agentAt = async (at: { lat: number; lng: number }) => {
    const agent = await signIn(t, 'agent');
    await report(agent, at);
    return agent;
  };
  const urgent = (customer: Person, pickup: { lat: number; lng: number }, dropoff: { lat: number; lng: number }) =>
    createErrand(t, customer, {
      urgent: true,
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Ring Road, Benin City', ...pickup },
        { kind: 'dropoff', label: 'Home', address: 'GRA, Benin City', ...dropoff },
      ],
    });
  const current = async (agent: Person) =>
    (await request(t.http).get('/v1/agent/offers/current').set(agent.headers).expect(200)).body.offer as {
      id: string;
      errand: { id: string };
      counts: boolean;
      backToBack: boolean;
      paired: boolean;
    } | null;
  const event = (who: Person, errandId: string, name: string) =>
    request(t.http).post(`/v1/errands/${errandId}/events`).set(who.headers).send({ event: name });
  const view = async (who: Person, errandId: string) =>
    (await request(t.http).get(`/v1/errands/${errandId}`).set(who.headers).expect(200)).body;
  const pinOf = async (customer: Person, id: string) =>
    (await request(t.http).get(`/v1/errands/${id}/pin`).set(customer.headers).expect(200)).body.pin as string;
  const offersFor = (errandId: string) => t.db.select().from(errandOffers).where(eq(errandOffers.errandId, errandId));
  const estimate = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
    TravelTimesService.estimate(haversineMeters(from, to), DEFAULT_MATCHING_SETTINGS).durationSeconds;

  /** The agent is offered an urgent errand and takes it. */
  async function taken(agent: Person, customer: Person, pickup: { lat: number; lng: number }, dropoff = east(5)) {
    const errand = await urgent(customer, pickup, dropoff);
    expect((await current(agent))?.errand.id).toBe(errand.id);
    await event(agent, errand.id, 'accept').expect(200);
    return errand;
  }

  it('offers nothing beside an errand the agent holds while it is switched off', async () => {
    const agent = await agentAt(ORIGIN);
    await taken(agent, first, east(1));
    const next = await urgent(second, north(east(1.2), 0.6), east(5.5));
    expect(await current(agent)).toBeNull();
    expect(await offersFor(next.id)).toHaveLength(0);
  });

  it('with it on, offers a second errand picked up near the first, and both are carried at once', async () => {
    await matching({ twoAtOnce: true });
    const agent = await agentAt(ORIGIN);
    const one = await taken(agent, first, east(1));
    const pickup = north(east(1.2), 0.6);
    const two = await urgent(second, pickup, east(5.5));
    const offer = await current(agent);
    expect(offer).toMatchObject({ errand: { id: two.id }, paired: true, backToBack: false });
    // Declining it is free, as for other offers they can't help.
    expect(offer!.counts).toBe(false);
    const [row] = await t.db.select().from(errandOffers).where(eq(errandOffers.id, offer!.id));
    expect(row!.pairedWith).toBe(one.id);
    // Ranked by the way to the second pickup through the first.
    const by = estimate(ORIGIN, east(1)) + estimate(east(1), pickup);
    expect(row!.travelSeconds).toBeGreaterThanOrEqual(by - 2);
    expect(row!.travelSeconds).toBeLessThanOrEqual(by + 2);

    const told = vi.spyOn(t.app.get(RealtimeGateway), 'toUser');
    await event(agent, two.id, 'accept').expect(200);
    // The first errand's screens are told, for the stops and the note.
    expect(told.mock.calls).toEqual(
      expect.arrayContaining([
        [first.userId, 'customer', 'errand.alongside', expect.objectContaining({ errandId: one.id })],
        [agent.userId, 'agent', 'errand.alongside', expect.objectContaining({ errandId: one.id })],
      ]),
    );
    // The offer log says so.
    const log = (await request(t.http).get(`/v1/admin/errands/${two.id}`).set(owner.headers).expect(200)).body
      .offers as Array<{ paired: boolean; status: string }>;
    expect(log).toEqual([expect.objectContaining({ paired: true, status: 'accepted' })]);
    // Both start: neither waits for the other.
    await act(t, agent, one.id, 'start');
    await act(t, agent, two.id, 'start');

    // The agent sees the stops of both, in order, from either errand.
    for (const id of [one.id, two.id]) {
      const mine = await view(agent, id);
      expect(mine.alongside.errandId).toBe(id === one.id ? two.id : one.id);
      expect(mine.alongside.stops.map((s: { errandId: string; kind: string }) => [s.errandId, s.kind])).toEqual([
        [one.id, 'pickup'],
        [two.id, 'pickup'],
        [one.id, 'dropoff'],
        [two.id, 'dropoff'],
      ]);
    }
    // Each customer is told their agent carries another errand on the way, and nothing about it.
    const theirs = await view(second, two.id);
    expect(theirs.sharedTrip).toBe(true);
    expect(theirs.alongside).toBeNull();

    // Both customers follow the agent.
    told.mockClear();
    await report(agent, east(1.1));
    const followers = told.mock.calls.filter((c) => c[2] === 'agent.location').map((c) => c[0]);
    expect(followers).toEqual(expect.arrayContaining([first.userId, second.userId]));
    expect((await view(first, one.id)).agentLocation).not.toBeNull();
    expect((await view(second, two.id)).agentLocation).not.toBeNull();
    // At the first pickup: ticked on the list, the rest still to do.
    expect((await view(agent, two.id)).alongside.stops.map((s: { done: boolean }) => s.done)).toEqual([
      true,
      false,
      false,
      false,
    ]);

    // No third beside them.
    const three = await urgent(first, north(east(1), 0.3), east(5.2));
    expect(await current(agent)).toBeNull();
    expect(await offersFor(three.id)).toHaveLength(0);

    // The first delivered: the second goes on alone.
    await act(t, agent, one.id, 'mark_delivered');
    told.mockClear();
    await act(t, agent, one.id, 'confirm_pin', { pin: await pinOf(first, one.id) });
    // The second customer's tracker is told the note goes.
    expect(told.mock.calls).toEqual(
      expect.arrayContaining([
        [second.userId, 'customer', 'errand.alongside', expect.objectContaining({ errandId: two.id })],
      ]),
    );
    expect((await view(agent, two.id)).alongside).toBeNull();
    expect((await view(second, two.id)).sharedTrip).toBe(false);
  });

  it("never with the second pickup far from the first's, or with a customer kept waiting too long", async () => {
    await matching({ twoAtOnce: true });
    const agent = await agentAt(ORIGIN);
    await taken(agent, first, east(1));
    // 1.5 km from the first pickup.
    const far = await urgent(second, east(2.5), east(5.5));
    expect(await current(agent)).toBeNull();
    expect(await offersFor(far.id)).toHaveLength(0);
    // Near, but its drop-off the other way: one customer or the other would wait far longer.
    const away = await urgent(second, north(east(1.2), 0.5), east(-5));
    expect(await current(agent)).toBeNull();
    expect(await offersFor(away.id)).toHaveLength(0);
  });

  it('is checked again when taken: switched off since, the second is refused', async () => {
    await matching({ twoAtOnce: true });
    const agent = await agentAt(ORIGIN);
    await taken(agent, first, east(1));
    const two = await urgent(second, north(east(1.2), 0.6), east(5.5));
    expect((await current(agent))?.paired).toBe(true);
    await matching({ twoAtOnce: false });
    const res = await event(agent, two.id, 'accept');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('finish_urgent');
  });

  it('never takes an agent offline for offers to carry with theirs that they let run out', async () => {
    await matching({ twoAtOnce: true, missedOffersOffline: 1 });
    try {
      const agent = await agentAt(ORIGIN);
      await taken(agent, first, east(1));
      await urgent(second, north(east(1.2), 0.6), east(5.5));
      const offer = await current(agent);
      expect(offer?.paired).toBe(true);
      await t.timers.fireWhere((job) => job.event === 'offer_expire' && job.offerId === offer!.id);
      const [presence] = await t.db.select().from(agentPresence).where(eq(agentPresence.userId, agent.userId));
      expect(presence!.online).toBe(true);
    } finally {
      await matching({ missedOffersOffline: DEFAULT_MATCHING_SETTINGS.missedOffersOffline });
    }
  });

  it('is refused once its errand is open to everyone, as any second urgent errand is', async () => {
    await matching({ twoAtOnce: true });
    const agent = await agentAt(ORIGIN);
    await taken(agent, first, east(1));
    const two = await urgent(second, north(east(1.2), 0.6), east(5.5));
    expect((await current(agent))?.paired).toBe(true);
    // Its search reached its last step while the offer stood.
    await t.db
      .update(errands)
      .set({ broadcastFeeKobo: sql`${errands.feeKobo}` })
      .where(eq(errands.id, two.id));
    const res = await event(agent, two.id, 'accept');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('finish_urgent');
  });

  it("offers it back to back instead when it can't be carried with the first, but can follow it", async () => {
    await matching({ twoAtOnce: true, twoAtOnceDelayMinutes: 30 });
    const agent = await agentAt(ORIGIN);
    const one = await taken(agent, first, east(1), east(3));
    await act(t, agent, one.id, 'start');
    // Heading 8 km west, near the end of the first errand, and never seen at its pickup.
    await request(t.http)
      .put('/v1/agent/destination')
      .set(agent.headers)
      .send({ ...east(-8), label: 'Home' })
      .expect(200);
    await report(agent, east(2.4));
    // Its drop-off brings them nearer home from the first's drop-off, not quite from where they are now.
    const next = await urgent(second, north(east(1.5), 0.4), east(0.5));
    const offer = await current(agent);
    expect(offer).toMatchObject({ errand: { id: next.id }, backToBack: true, paired: false });
  });
});
