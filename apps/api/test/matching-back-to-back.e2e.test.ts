import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS, haversineMeters } from '@jiffo/shared';
import { agentPresence, errandOffers, errands } from '../src/db/schema';
import { AgentLocations } from '../src/matching/agent-locations';
import { TravelTimesService } from '../src/matching/travel-times';
import {
  act,
  adminAs,
  approved,
  createErrand,
  createTestApp,
  fund,
  photo,
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

// Port Harcourt, away from the places the other test files draw and send errands.
const PORT_HARCOURT = box(6.9, 4.7, 7.15, 4.95);
const GRA = box(6.95, 4.76, 7.1, 4.9);
const ORIGIN = { lat: 4.82, lng: 6.97 };
/** A km east of the origin, about, this close to the equator. */
const east = (km: number) => ({ lat: ORIGIN.lat, lng: ORIGIN.lng + km / 111 });
const north = (from: { lat: number; lng: number }, km: number) => ({ lat: from.lat + km / 111, lng: from.lng });

/**
 * Back-to-back offers (docs/matching.md, M10), as Uber's back-to-back trips: an agent within a km of an errand's
 * final drop-off, or who has marked it delivered, can be offered the next urgent errand whose pickup is within 3 km
 * of that drop-off. It waits behind the current one, and starts once that one is done.
 */
describe('back-to-back offers', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let original: { settings: { matching: Record<string, unknown> } };
  let customer: Person;

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
    customer = await signIn(t, 'customer');
    await fund(t, customer, 100_000_000);
    const admin = (path: string, body: object, method: 'post' | 'patch' = 'post') =>
      request(t.http)[method](`/v1/admin${path}`).set(owner.headers).send(body);
    const states = (await request(t.http).get('/v1/admin/states?country=NG').set(owner.headers).expect(200))
      .body as Array<{ id: string; code: string }>;
    const rivers = states.find((s) => s.code === 'RI')!.id;
    const city = (
      await admin('/cities', { stateId: rivers, name: 'Port Harcourt', boundary: PORT_HARCOURT }).expect(201)
    ).body.id;
    const area = (await admin('/areas', { cityId: city, name: 'GRA', boundary: GRA }).expect(201)).body.id;
    await admin(`/cities/${city}`, { enabled: true }, 'patch').expect(200);
    await admin(`/areas/${area}`, { enabled: true }, 'patch').expect(200);
  });
  // Each test starts with every agent so far offline, and no urgent errand waiting.
  afterEach(async () => {
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
  const urgent = (pickup: { lat: number; lng: number }, dropoff: { lat: number; lng: number }) =>
    createErrand(t, customer, {
      urgent: true,
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Aba Road, Port Harcourt', ...pickup },
        { kind: 'dropoff', label: 'Home', address: 'GRA Phase 2, Port Harcourt', ...dropoff },
      ],
    });
  const current = async (agent: Person) =>
    (await request(t.http).get('/v1/agent/offers/current').set(agent.headers).expect(200)).body.offer as {
      id: string;
      errand: { id: string };
      counts: boolean;
      backToBack: boolean;
    } | null;
  const event = (agent: Person, errandId: string, name: string) =>
    request(t.http).post(`/v1/errands/${errandId}/events`).set(agent.headers).send({ event: name });
  /** The agent takes an urgent errand they're offered, and starts it. */
  async function underWay(agent: Person, pickup: { lat: number; lng: number }, dropoff: { lat: number; lng: number }) {
    const errand = await urgent(pickup, dropoff);
    expect((await current(agent))?.errand.id).toBe(errand.id);
    await event(agent, errand.id, 'accept').expect(200);
    await act(t, agent, errand.id, 'start');
    return errand;
  }
  const pinOf = async (id: string) =>
    (await request(t.http).get(`/v1/errands/${id}/pin`).set(customer.headers).expect(200)).body.pin as string;
  const estimate = (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
    TravelTimesService.estimate(haversineMeters(from, to), DEFAULT_MATCHING_SETTINGS).durationSeconds;

  it('offers the next urgent errand near the end of the current one, held behind it until that one is done', async () => {
    const dropoff = east(2);
    const agent = await agentAt(ORIGIN);
    const first = await underWay(agent, ORIGIN, dropoff);
    // On the way, 600 m from the drop-off: the next errand's pickup is 2 km on from there.
    const here = east(1.4);
    await report(agent, here);
    const next = north(dropoff, 2);
    const second = await urgent(next, north(next, 1));
    const offer = await current(agent);
    expect(offer).toMatchObject({ errand: { id: second.id }, backToBack: true });
    // Declining it is free, as for other offers they can't help.
    expect(offer!.counts).toBe(false);
    // Ranked by the rest of the current errand and then the drive.
    const [row] = await t.db.select().from(errandOffers).where(eq(errandOffers.id, offer!.id));
    expect(row!.backToBack).toBe(true);
    expect(row!.travelSeconds).toBeGreaterThanOrEqual(estimate(here, dropoff) + estimate(dropoff, next) - 2);
    expect(row!.travelSeconds).toBeLessThanOrEqual(estimate(here, dropoff) + estimate(dropoff, next) + 2);

    await event(agent, second.id, 'accept').expect(200);
    // Waiting behind the first: it starts only once that one is done.
    const early = await event(agent, second.id, 'start');
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('finish_current');
    // No third behind it.
    const third = await urgent(north(dropoff, 1), north(dropoff, 2));
    expect(await current(agent)).toBeNull();
    expect((await t.db.select().from(errandOffers).where(eq(errandOffers.errandId, third.id))).length).toBe(0);

    await act(t, agent, first.id, 'mark_delivered');
    await act(t, agent, first.id, 'confirm_pin', { pin: await pinOf(first.id) });
    await act(t, agent, second.id, 'start');
  });

  it('waits until the agent is within a km of the drop-off, or has marked it delivered', async () => {
    const dropoff = east(3);
    const agent = await agentAt(east(0.5));
    const first = await underWay(agent, east(0.5), dropoff);
    // Still 2 km off the drop-off.
    await report(agent, east(1));
    const next = north(dropoff, 1.5);
    const early = await urgent(next, north(next, 1));
    expect(await current(agent)).toBeNull();
    expect((await t.db.select().from(errandOffers).where(eq(errandOffers.errandId, early.id))).length).toBe(0);
    // Delivered: offered, wherever they are now.
    await act(t, agent, first.id, 'mark_delivered');
    await report(agent, north(dropoff, -1.5));
    await t.timers.fireWhere((job) => job.event === 'offer_dispatch' && job.errandId === early.id);
    const offer = await current(agent);
    expect(offer).toMatchObject({ errand: { id: early.id }, backToBack: true });
    // Done with the first, they drive from where they are: 3 km to the pickup, not the 1.5 km from the drop-off.
    const [row] = await t.db.select().from(errandOffers).where(eq(errandOffers.id, offer!.id));
    expect(row!.travelSeconds).toBeGreaterThan(estimate(dropoff, next) + 100);
  });

  it('never with the next pickup more than 3 km from the drop-off, nor with back-to-back offers switched off', async () => {
    const dropoff = east(5);
    const agent = await agentAt(east(4));
    await underWay(agent, east(4), dropoff);
    await report(agent, east(4.6));
    // 3.5 km on from the drop-off, though within the agent's reach.
    const far = await urgent(north(dropoff, 3.5), north(dropoff, 4.5));
    expect(await current(agent)).toBeNull();
    expect((await t.db.select().from(errandOffers).where(eq(errandOffers.errandId, far.id))).length).toBe(0);

    await matching({ backToBack: false });
    try {
      const near = await urgent(north(dropoff, 1), north(dropoff, 2));
      expect(await current(agent)).toBeNull();
      expect((await t.db.select().from(errandOffers).where(eq(errandOffers.errandId, near.id))).length).toBe(0);
    } finally {
      await matching({ backToBack: true });
    }
  });

  it('is accepted only from the offer: the board still keeps urgent errands for agents with nothing held', async () => {
    const dropoff = east(7);
    const agent = await agentAt(east(6));
    await underWay(agent, east(6), dropoff);
    await report(agent, east(6.7));
    const next = north(dropoff, 1);
    const offered = await urgent(next, north(next, 1));
    const offer = await current(agent);
    expect(offer?.errand.id).toBe(offered.id);
    // Once the offer is gone, the errand can't be taken back to back any other way.
    await request(t.http).post(`/v1/agent/offers/${offer!.id}/decline`).set(agent.headers).expect(200);
    const res = await event(agent, offered.id, 'accept');
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('starts the waiting errand once the first is handed over, though its photo waits for the customer', async () => {
    const dropoff = east(9);
    const agent = await agentAt(east(8));
    const first = await underWay(agent, east(8), dropoff);
    await report(agent, east(8.6));
    const next = north(dropoff, 1);
    const second = await urgent(next, north(next, 1));
    expect((await current(agent))?.errand.id).toBe(second.id);
    await event(agent, second.id, 'accept').expect(200);
    await act(t, agent, first.id, 'mark_delivered');
    await act(t, agent, first.id, 'send_dropoff_photo', { photo: await photo(t, agent, first.id, 'dropoff_photo') });
    await act(t, agent, second.id, 'start');
  });

  it('never takes an agent offline for back-to-back offers they let run out', async () => {
    await matching({ missedOffersOffline: 1 });
    try {
      const dropoff = east(11);
      const agent = await agentAt(east(10));
      await underWay(agent, east(10), dropoff);
      await report(agent, east(10.6));
      const next = north(dropoff, 1);
      const offered = await urgent(next, north(next, 1));
      const offer = await current(agent);
      expect(offer?.errand.id).toBe(offered.id);
      await t.timers.fireWhere((job) => job.event === 'offer_expire' && job.offerId === offer!.id);
      const [presence] = await t.db.select().from(agentPresence).where(eq(agentPresence.userId, agent.userId));
      expect(presence!.online).toBe(true);
    } finally {
      await matching({ missedOffersOffline: DEFAULT_MATCHING_SETTINGS.missedOffersOffline });
    }
  });

  it('is accepted back to back only while back-to-back offers are on', async () => {
    const dropoff = east(13);
    const agent = await agentAt(east(12));
    await underWay(agent, east(12), dropoff);
    await report(agent, east(12.6));
    const next = north(dropoff, 1);
    const offered = await urgent(next, north(next, 1));
    expect((await current(agent))?.errand.id).toBe(offered.id);
    await matching({ backToBack: false });
    try {
      const res = await event(agent, offered.id, 'accept');
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('finish_urgent');
    } finally {
      await matching({ backToBack: true });
    }
  });
});
