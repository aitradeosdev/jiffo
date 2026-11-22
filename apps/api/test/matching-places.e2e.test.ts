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

// Kaduna, away from the places the other test files send errands.
const KADUNA = box(7.35, 10.42, 7.6, 10.62);
const BARNAWA = box(7.42, 10.47, 7.46, 10.51);
const PICKUP = { lat: 10.49, lng: 7.44 };
/** A km east of the pickup, about, this far from the equator. */
const east = (km: number) => ({ lat: PICKUP.lat, lng: PICKUP.lng + km / 109 });

type Scope = 'state' | 'city' | 'area';

/**
 * Matching values per state, city and area (docs/matching.md, M14): how a place's urgent errands are offered and
 * ranked can be its own, like its prices. What a place leaves out comes from the level above, then the country's
 * settings. Each change needs a second admin's approval, and must leave workable values for the place and every
 * place below it.
 */
describe('Matching per place', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let original: { settings: { matching: Record<string, unknown> } };
  let customer: Person;
  let ids: Record<Scope, string>;

  const admin = (method: 'get' | 'post' | 'patch', path: string, as = owner) =>
    request(t.http)[method](`/v1/admin${path}`).set(as.headers);

  async function country(changes: Record<string, unknown>) {
    const now = (await admin('get', '/settings?country=NG').expect(200)).body;
    const settings = structuredClone(now.settings);
    Object.assign(settings.matching, changes);
    return approved(t, 'owner', (h) =>
      request(t.http)
        .post('/v1/admin/settings?country=NG')
        .set(h)
        .send({ basedOn: now.version, settings, note: 'Matching values for a test' }),
    );
  }
  /** The Matching values one place sets now: their version, to change them from. */
  async function saved(scope: Scope, id: string) {
    const listed = (await admin('get', '/service-areas?country=NG').expect(200)).body;
    const state = listed.states.find((s: { code: string }) => s.code === 'KD');
    const place =
      scope === 'state'
        ? state
        : scope === 'city'
          ? state.cities.find((c: { id: string }) => c.id === id)
          : state.cities.flatMap((c: { areas: unknown[] }) => c.areas).find((a: { id: string }) => a.id === id);
    return place.matching as { version: number; data: Record<string, unknown> };
  }
  async function setMatching(scope: Scope, id: string, matching: Record<string, unknown>) {
    const { version } = await saved(scope, id);
    return approved(t, 'owner', (h) =>
      request(t.http)
        .post('/v1/admin/matching')
        .set(h)
        .send({ scope, id, basedOn: version, matching, note: 'Matching values for a test' }),
    );
  }
  /** Leaves Kaduna's places with no values of their own. */
  async function clear() {
    for (const scope of ['area', 'city', 'state'] as const) {
      if (Object.keys((await saved(scope, ids[scope])).data).length) {
        expect((await setMatching(scope, ids[scope], {})).status).toBe(200);
      }
    }
  }

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    // Another owner, so a change waits for one of them to approve it.
    await adminAs(t, 'owner');
    original = (await admin('get', '/settings?country=NG').expect(200)).body;
    expect((await country({ ...DEFAULT_MATCHING_SETTINGS })).status).toBe(200);
    customer = await signIn(t, 'customer');
    await fund(t, customer, 100_000_000);
    const states = (await admin('get', '/states?country=NG').expect(200)).body as Array<{ id: string; code: string }>;
    const state = states.find((s) => s.code === 'KD')!.id;
    const city = (await admin('post', '/cities').send({ stateId: state, name: 'Kaduna', boundary: KADUNA }).expect(201))
      .body.id;
    const area = (await admin('post', '/areas').send({ cityId: city, name: 'Barnawa', boundary: BARNAWA }).expect(201))
      .body.id;
    await admin('patch', `/cities/${city}`).send({ enabled: true }).expect(200);
    await admin('patch', `/areas/${area}`).send({ enabled: true }).expect(200);
    ids = { state, city, area };
  });
  // Each test starts with Kaduna's places setting nothing, every agent so far offline, and no urgent errand waiting.
  afterEach(async () => {
    await clear();
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
    return agent;
  };
  const urgent = () =>
    createErrand(t, customer, {
      urgent: true,
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Barnawa Market, Kaduna', ...PICKUP },
        { kind: 'dropoff', label: 'Home', address: 'Barnawa, Kaduna', lat: PICKUP.lat + 0.01, lng: PICKUP.lng },
      ],
    });
  const current = async (agent: Person) =>
    (await request(t.http).get('/v1/agent/offers/current').set(agent.headers).expect(200)).body.offer as {
      id: string;
      errand: { id: string };
      windowSeconds: number;
    } | null;
  const decline = async (agent: Person, errandId: string) => {
    const offer = (await current(agent))!;
    expect(offer.errand.id).toBe(errandId);
    await request(t.http).post(`/v1/agent/offers/${offer.id}/decline`).set(agent.headers).expect(200);
  };
  const search = async (errandId: string) =>
    (await request(t.http).get(`/v1/errands/${errandId}`).set(customer.headers).expect(200)).body.search;
  const boardHas = async (agent: Person, at: { lat: number; lng: number }, errandId: string) => {
    const board = await request(t.http)
      .get(`/v1/errands/board?lat=${at.lat}&lng=${at.lng}&radiusKm=50`)
      .set(agent.headers)
      .expect(200);
    return (board.body.errands as Array<{ id: string }>).some((e) => e.id === errandId);
  };

  it("are the country's until a state, city or area sets its own", async () => {
    for (const scope of ['state', 'city', 'area'] as const) {
      expect(await saved(scope, ids[scope])).toEqual({ version: 0, data: {} });
    }
    const agent = await agentAt(east(1));
    const errand = await urgent();
    expect((await current(agent))!.windowSeconds).toBe(DEFAULT_MATCHING_SETTINGS.offerSeconds);
    expect(await search(errand.id)).toEqual({ radiusKm: DEFAULT_MATCHING_SETTINGS.searchStepsKm[0], everyone: false });
  });

  it("wait for a second admin, then a state's offer time and an area's search steps apply to its errands", async () => {
    // One admin alone asks; nothing changes until another approves.
    const asked = await admin('post', '/matching').send({
      scope: 'state',
      id: ids.state,
      basedOn: 0,
      matching: { offerSeconds: 30 },
      note: 'Kaduna offers',
    });
    expect(asked.status, JSON.stringify(asked.body)).toBe(202);
    expect(asked.body.approval.summary).toMatch(/Kaduna/);
    expect((await saved('state', ids.state)).data).toEqual({});

    expect((await setMatching('state', ids.state, { offerSeconds: 30, searchStepsKm: [3, 5] })).status).toBe(200);
    expect((await setMatching('area', ids.area, { searchStepsKm: [2, 4] })).status).toBe(200);
    expect(await saved('state', ids.state)).toEqual({ version: 1, data: { offerSeconds: 30, searchStepsKm: [3, 5] } });

    const agent = await agentAt(east(1));
    const errand = await urgent();
    // The state's offer time; the area's first step, nearer than the state's.
    expect((await current(agent))!.windowSeconds).toBe(30);
    expect(await search(errand.id)).toEqual({ radiusKm: 2, everyone: false });
  });

  it("opens an errand to everyone within its place's last step, not the country's", async () => {
    expect((await setMatching('area', ids.area, { searchStepsKm: [2, 4], offersPerStep: 1 })).status).toBe(200);
    const a = await agentAt(east(1));
    const b = await agentAt(east(3));
    const errand = await urgent();
    await decline(a, errand.id);
    await decline(b, errand.id);
    expect(await search(errand.id)).toEqual({ radiusKm: 4, everyone: true });
    // Within the area's 4 km, it's on the board; at 6 km, within the country's 10 but not the area's, it isn't.
    const near = await agentAt(east(3.5));
    const far = await agentAt(east(6));
    expect(await boardHas(near, east(3.5), errand.id)).toBe(true);
    expect(await boardHas(far, east(6), errand.id)).toBe(false);
    const tooFar = await request(t.http)
      .post(`/v1/errands/${errand.id}/events`)
      .set(far.headers)
      .send({ event: 'accept' });
    expect(tooFar.status).toBe(422);
    expect(tooFar.body.error.code).toBe('too_far');
    await request(t.http)
      .post(`/v1/errands/${errand.id}/events`)
      .set(near.headers)
      .send({ event: 'accept' })
      .expect(200);
  });

  it('are refused when they would not work, or were changed since they were opened', async () => {
    // Past how far the country's board reaches (10 km).
    const past = await setMatching('area', ids.area, { searchStepsKm: [3, 12] });
    expect(past.status).toBe(400);
    expect(past.body.error).toMatchObject({ code: 'invalid_matching' });
    expect(past.body.error.message).toMatch(/Barnawa/);
    // A state's urgent errands are batched together, so only a state sets how long its batch waits.
    expect((await setMatching('city', ids.city, { batchSeconds: 5 })).status).toBe(400);
    expect((await setMatching('state', ids.state, { batchSeconds: 5 })).status).toBe(200);
    // Who may get an errand stays the country's.
    expect((await setMatching('city', ids.city, { boardRadiusKm: 20 })).status).toBe(400);
    // Asked for from values someone has changed since.
    const stale = await admin('post', '/matching').send({
      scope: 'state',
      id: ids.state,
      basedOn: 0,
      matching: { offerSeconds: 30 },
      note: 'From old values',
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('matching_changed');
  });

  it("refuses a country change that would leave a place's search reaching past the board", async () => {
    expect((await setMatching('area', ids.area, { searchStepsKm: [2, 4] })).status).toBe(200);
    const res = await country({ boardRadiusKm: 3, searchStepsKm: [1, 2, 3] });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error)).toMatch(/Barnawa/);
    // Once the area's are gone, the same change works.
    expect((await setMatching('area', ids.area, {})).status).toBe(200);
    expect((await country({ boardRadiusKm: 3, searchStepsKm: [1, 2, 3] })).status).toBe(200);
    expect((await country({ ...DEFAULT_MATCHING_SETTINGS })).status).toBe(200);
  });
});
