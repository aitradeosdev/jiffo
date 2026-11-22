import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { agentPresence, errandOffers, errands } from '../src/db/schema';
import { AgentLocations } from '../src/matching/agent-locations';
import { adminAs, approved, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

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

// Enugu, away from the places the other test files draw and send errands, so Enugu's figures are this file's alone.
const ENUGU = box(7.4, 6.35, 7.6, 6.55);
const INDEPENDENCE_LAYOUT = box(7.48, 6.43, 7.54, 6.47);
const PICKUP = { lat: 6.45, lng: 7.51 };
/** A km east of the pickup, about, this far from the equator. */
const east = (km: number) => ({ lat: PICKUP.lat, lng: PICKUP.lng + km / 110 });

type Offer = {
  agent: { id: string; firstName: string | null };
  rank: number;
  status: string;
  score: number;
  parts: Record<string, number>;
  travelSeconds: number;
  travelEstimated: boolean;
  straightMeters: number;
  counts: boolean;
  feeKobo: number;
  offeredAt: string;
  answeredAt: string | null;
};
type Figures = {
  errands: number;
  urgent: number;
  firstOfferSeconds: number | null;
  acceptSeconds: number | null;
  offersPerErrand: number | null;
  everyoneShare: number | null;
  expiredShare: number;
  pickups: number;
  predictedPickupSeconds: number | null;
  actualPickupSeconds: number | null;
};

/**
 * The matching dashboard and offer log (docs/matching.md, M15): every offer of an errand, in order, with its score
 * and answer, in the admin errand view; figures per state and category; and per agent. Enugu's search is 1 km,
 * then 2, one offer each, set for the state (M14).
 */
describe('the matching dashboard', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let original: { settings: { matching: Record<string, unknown> } };
  let customer: Person;
  let enugu: string;
  const agents = new Map<string, Person>();

  const admin = (path: string) => request(t.http).get(`/v1/admin${path}`).set(owner.headers);
  async function country(changes: Record<string, unknown>) {
    const now = (await admin('/settings?country=NG').expect(200)).body;
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
  async function enuguMatching(matching: Record<string, unknown>) {
    const listed = (await admin('/service-areas?country=NG').expect(200)).body;
    const { version } = listed.states.find((s: { code: string }) => s.code === 'EN').matching;
    const res = await approved(t, 'owner', (h) =>
      request(t.http)
        .post('/v1/admin/matching')
        .set(h)
        .send({ scope: 'state', id: enugu, basedOn: version, matching, note: 'Enugu for a test' }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    await adminAs(t, 'owner');
    original = (await admin('/settings?country=NG').expect(200)).body;
    await country({ ...DEFAULT_MATCHING_SETTINGS });
    customer = await signIn(t, 'customer');
    await fund(t, customer, 100_000_000);
    const states = (await admin('/states?country=NG').expect(200)).body as Array<{ id: string; code: string }>;
    enugu = states.find((s) => s.code === 'EN')!.id;
    const post = (path: string, body: object) =>
      request(t.http).post(`/v1/admin${path}`).set(owner.headers).send(body).expect(201);
    const patch = (path: string) =>
      request(t.http).patch(`/v1/admin${path}`).set(owner.headers).send({ enabled: true }).expect(200);
    const city = (await post('/cities', { stateId: enugu, name: 'Enugu', boundary: ENUGU })).body.id;
    const area = (await post('/areas', { cityId: city, name: 'Independence Layout', boundary: INDEPENDENCE_LAYOUT }))
      .body.id;
    await patch(`/cities/${city}`);
    await patch(`/areas/${area}`);
    await enuguMatching({ searchStepsKm: [1, 2], offersPerStep: 1 });
  });
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
    await enuguMatching({});
    await country(original.settings.matching);
    await t.close();
  });

  const agentAt = async (at: { lat: number; lng: number }) => {
    const agent = await signIn(t, 'agent');
    await request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, ...at })
      .expect(200);
    agents.set(agent.userId, agent);
    return agent;
  };
  const send = (categoryKey: string, urgent = true) =>
    createErrand(t, customer, {
      urgent,
      categoryKey,
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Independence Layout, Enugu', ...PICKUP },
        { kind: 'dropoff', label: 'Home', address: 'Ogui Road, Enugu', lat: PICKUP.lat + 0.01, lng: PICKUP.lng },
      ],
    });
  /** The agent holding the errand's open offer. */
  const offered = async (errandId: string) => {
    const [open] = await t.db
      .select()
      .from(errandOffers)
      .where(and(eq(errandOffers.errandId, errandId), eq(errandOffers.status, 'open')));
    return open ? { offer: open, agent: agents.get(open.agentId)! } : null;
  };
  const decline = async (errandId: string) => {
    const { offer, agent } = (await offered(errandId))!;
    await request(t.http).post(`/v1/agent/offers/${offer.id}/decline`).set(agent.headers).expect(200);
    return agent;
  };
  const accept = async (errandId: string) => {
    const { agent } = (await offered(errandId))!;
    await request(t.http)
      .post(`/v1/errands/${errandId}/events`)
      .set(agent.headers)
      .send({ event: 'accept' })
      .expect(200);
    return agent;
  };
  const detail = async (errandId: string) => (await admin(`/errands/${errandId}`).expect(200)).body;
  const dashboard = async () => (await admin('/matching?country=NG&state=EN&days=7').expect(200)).body;

  it('logs every offer of an errand, in order, with its score and what the agent did, in its admin view', async () => {
    const near = await agentAt(east(0.3));
    const further = await agentAt(east(0.8));
    const errand = await send('parcel');
    expect((await decline(errand.id)).userId).toBe(near.userId);
    expect((await accept(errand.id)).userId).toBe(further.userId);

    const { offers } = (await detail(errand.id)) as { offers: Offer[] };
    expect(offers.map((o) => [o.agent.id, o.status])).toEqual([
      [near.userId, 'declined'],
      [further.userId, 'accepted'],
    ]);
    for (const o of offers) {
      expect(o.rank).toBeGreaterThanOrEqual(1);
      expect(o.score).toBeGreaterThan(0);
      expect(o.parts.total).toBe(o.score);
      expect(o.travelSeconds).toBeGreaterThan(0);
      expect(o.straightMeters).toBeGreaterThan(0);
      expect(o.feeKobo).toBe(250_000);
      expect(o.answeredAt).not.toBeNull();
      expect(o.agent.firstName).toBeTruthy();
    }
    expect(new Date(offers[0]!.offeredAt) <= new Date(offers[1]!.offeredAt)).toBe(true);
  });

  it('lists who was told once the errand was open to everyone', async () => {
    await agentAt(east(0.5));
    await agentAt(east(1.5));
    await agentAt(east(1.8));
    const errand = await send('parcel');
    const asked = [await decline(errand.id), await decline(errand.id)];
    const { broadcasts, toldAgents } = (await detail(errand.id)) as {
      broadcasts: Array<{ agent: { id: string }; straightMeters: number; feeKobo: number; toldAt: string }>;
      toldAgents: number;
    };
    // Each agent once, however many times they were told.
    expect(new Set(broadcasts.map((b) => b.agent.id)).size).toBe(broadcasts.length);
    expect(toldAgents).toBe(broadcasts.length);
    const left = [...agents.keys()].filter((id) => !asked.some((a) => a.userId === id));
    expect(broadcasts.map((b) => b.agent.id)).toEqual(expect.arrayContaining([left.at(-1)]));
    expect(broadcasts.some((b) => asked.some((a) => a.userId === b.agent.id))).toBe(false);
    expect(broadcasts[0]).toMatchObject({ feeKobo: 250_000 });
    expect(broadcasts[0]!.straightMeters).toBeGreaterThan(0);
  });

  it('works out the figures per state and category, from offer to pickup', async () => {
    // Laundry, sent here only by this test.
    const near = await agentAt(east(0.4));
    const taken = await send('laundry');
    expect((await accept(taken.id)).userId).toBe(near.userId);
    const reached = async () => (await t.db.select().from(errands).where(eq(errands.id, taken.id)))[0]!.reachedPickupAt;
    const acceptedAt = (await t.db.select().from(errands).where(eq(errands.id, taken.id)))[0]!.acceptedAt;
    // Still 500 m off: not at the pickup yet.
    await request(t.http).put('/v1/agent/presence').set(near.headers).send(east(0.5)).expect(200);
    expect(await reached()).toBeNull();
    // At the pickup, but by a fix the phone took before they accepted: not arriving.
    await request(t.http)
      .put('/v1/agent/presence')
      .set(near.headers)
      .send({ ...PICKUP, fixedAt: acceptedAt!.getTime() - 60_000 })
      .expect(200);
    expect(await reached()).toBeNull();
    // There, as the phone took the fix: arrival is when the fix was taken, not when it reached us.
    const fixedAt = Date.now();
    await request(t.http)
      .put('/v1/agent/presence')
      .set(near.headers)
      .send({ ...PICKUP, fixedAt })
      .expect(200);
    expect((await reached())!.getTime()).toBe(fixedAt);
    // No one free: it opens to everyone, and expires.
    await t.db.update(agentPresence).set({ online: false }).where(eq(agentPresence.userId, near.userId));
    await t.app.get(AgentLocations).remove(near.userId, 'NG');
    const lost = await send('laundry');
    await t.timers.fireWhere((job) => job.event === 'expire' && job.errandId === lost.id);
    // A board errand: in the counts and time to accept, not the offer figures.
    const boardAgent = await agentAt(east(0.2));
    const board = await send('laundry', false);
    await request(t.http)
      .post(`/v1/errands/${board.id}/events`)
      .set(boardAgent.headers)
      .send({ event: 'accept' })
      .expect(200);

    const body = await dashboard();
    const row = (body.places as Array<Figures & { stateCode: string; categoryKey: string; stateName: string }>).find(
      (p) => p.stateCode === 'EN' && p.categoryKey === 'laundry',
    )!;
    // The expired share is of urgent errands, as the other offer figures are.
    expect(row).toMatchObject({ stateName: 'Enugu', errands: 3, urgent: 2, pickups: 1, expiredShare: 0.5 });
    expect(row.offersPerErrand).toBe(0.5);
    expect(row.firstOfferSeconds).toBeGreaterThanOrEqual(0);
    expect(row.acceptSeconds).toBeGreaterThanOrEqual(0);
    const [offer] = await t.db.select().from(errandOffers).where(eq(errandOffers.errandId, taken.id));
    expect(row.predictedPickupSeconds).toBe(offer!.travelSeconds);
    expect(row.actualPickupSeconds).toBeGreaterThanOrEqual(0);
    // Enugu in all, this file's errands alone.
    expect(body.total.errands).toBeGreaterThanOrEqual(row.errands);
  });

  it('counts an errand as open to everyone even once its fee is raised and offers start again', async () => {
    // Shopping, sent here only by this test.
    await agentAt(east(0.5));
    await agentAt(east(1.5));
    const errand = await send('shopping');
    await decline(errand.id);
    await decline(errand.id);
    const [opened] = await t.db.select().from(errands).where(eq(errands.id, errand.id));
    expect(opened!.broadcastFeeKobo).toBe(250_000);
    await request(t.http)
      .post(`/v1/errands/${errand.id}/events`)
      .set(customer.headers)
      .send({ event: 'raise_fee', version: opened!.version, data: { amountKobo: 300_000 } })
      .expect(200);
    const row = ((await dashboard()).places as Array<Figures & { categoryKey: string }>).find(
      (p) => p.categoryKey === 'shopping',
    )!;
    expect(row.everyoneShare).toBe(1);
  });

  it('sees an agent reach the pickup of an errand they hold while out on another', async () => {
    // Anything else, sent here only by this test: two board errands, the first under way.
    const agent = await agentAt(east(1));
    const stopsAt = (at: { lat: number; lng: number }) => [
      { kind: 'pickup', label: 'Shop', address: 'Independence Layout, Enugu', ...at },
      { kind: 'dropoff', label: 'Home', address: 'Ogui Road, Enugu', lat: at.lat + 0.01, lng: at.lng },
    ];
    const first = await createErrand(t, customer, { categoryKey: 'other', stops: stopsAt(east(1)) });
    const second = await createErrand(t, customer, { categoryKey: 'other', stops: stopsAt(PICKUP) });
    for (const e of [first, second]) {
      await request(t.http).post(`/v1/errands/${e.id}/events`).set(agent.headers).send({ event: 'accept' }).expect(200);
    }
    const { version } = (await t.db.select().from(errands).where(eq(errands.id, first.id)))[0]!;
    await request(t.http)
      .post(`/v1/errands/${first.id}/events`)
      .set(agent.headers)
      .send({ event: 'start', version })
      .expect(200);
    await request(t.http).put('/v1/agent/presence').set(agent.headers).send(PICKUP).expect(200);
    const [held] = await t.db.select().from(errands).where(eq(errands.id, second.id));
    expect(held!.reachedPickupAt).not.toBeNull();
  });

  it('shows each agent their offers and how they answered, and the same on their own page', async () => {
    const a = await agentAt(east(0.3));
    await agentAt(east(0.9));
    const errand = await send('food');
    expect((await decline(errand.id)).userId).toBe(a.userId);
    await accept(errand.id);

    const { agents: listed } = (await dashboard()) as {
      agents: Array<{ id: string; offers: number; accepted: number; declined: number; expired: number }>;
    };
    expect(listed.find((x) => x.id === a.userId)).toMatchObject({ offers: 1, accepted: 0, declined: 1, expired: 0 });

    const person = (await admin(`/people/${a.userId}`).expect(200)).body;
    expect(person.matching).toMatchObject({
      offers30d: { received: 1, accepted: 0, declined: 1, expired: 0 },
      offersPausedUntil: null,
    });
    expect(person.matching).toHaveProperty('acceptanceRate');
    expect(person.matching).toHaveProperty('completionRate');
    // A customer has no matching figures.
    expect((await admin(`/people/${customer.userId}`).expect(200)).body.matching).toBeNull();
  });

  it('is for staff who may look at errands', async () => {
    const support = await adminAs(t, 'support');
    await request(t.http).get('/v1/admin/matching?country=NG').set(support.headers).expect(200);
    await request(t.http).get('/v1/admin/matching?country=NG&days=5').set(owner.headers).expect(400);
  });
});
