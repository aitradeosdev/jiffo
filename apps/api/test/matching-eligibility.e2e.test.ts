import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { agentPresence, riskFlags } from '../src/db/schema';
import {
  act,
  adminAs,
  approved,
  createErrand,
  createTestApp,
  fund,
  LAGOS_STOPS,
  offerTo,
  signIn,
  type Person,
  type TestApp,
} from './helpers';

const PICKUP = { lat: LAGOS_STOPS[0]!.lat, lng: LAGOS_STOPS[0]!.lng };

/**
 * Who may get an errand (docs/matching.md, M1). The board shows an agent only the errands they may take, and
 * accepting checks the same again inside its transaction, so an errand can't be taken by asking for it directly.
 */
describe('who may get an errand', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let original: { settings: { matching: Record<string, unknown> } };
  let customer: Person;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    customer = await signIn(t, 'customer');
    await fund(t, customer, 50_000_000);
    // Matching's starting values, which the other tests' settings relax.
    await matching(DEFAULT_MATCHING_SETTINGS);
  });
  afterAll(async () => {
    await matching(original.settings.matching);
    await t.close();
  });

  async function matching(changes: Record<string, unknown>) {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    Object.assign(settings.matching, changes);
    const res = await approved(t, 'owner', (h) =>
      request(t.http)
        .post('/v1/admin/settings?country=NG')
        .set(h)
        .send({ basedOn: now.version, settings, note: 'Matching limits for a test' }),
    );
    expect(res.status).toBe(200);
  }

  const online = (agent: Person, at = PICKUP) =>
    request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, ...at })
      .expect(200);
  const accept = (agent: Person, id: string) =>
    request(t.http).post(`/v1/errands/${id}/events`).set(agent.headers).send({ event: 'accept' });
  const board = (agent: Person, at = PICKUP) =>
    request(t.http).get(`/v1/errands/board?lat=${at.lat}&lng=${at.lng}&radiusKm=50`).set(agent.headers);
  const onBoard = async (agent: Person, id: string, at = PICKUP) => {
    const res = await board(agent, at).expect(200);
    return (res.body.errands as Array<{ id: string }>).some((e) => e.id === id);
  };
  const flag = async (
    kind: 'pair_shared_phone' | 'repeat_pairing' | 'gps_jump',
    userId: string,
    otherUserId: string | null,
  ) => {
    const [row] = await t.db
      .insert(riskFlags)
      .values({ countryCode: 'NG', queue: 'risk', kind, dedupeKey: `test:${Math.random()}`, userId, otherUserId })
      .returning({ id: riskFlags.id });
    return row!.id;
  };
  const scheduled = () => ({ scheduledFor: new Date(Date.now() + 3 * 3_600_000).toISOString() });

  it('needs the agent online, where they really are, and lately', async () => {
    const agent = await signIn(t, 'agent');
    const errand = await createErrand(t, customer);
    expect((await accept(agent, errand.id)).body.error.code).toBe('go_online');
    expect((await board(agent)).body.error.code).toBe('go_online');

    await online(agent);
    // A position older than the two minutes the Matching settings start with doesn't count.
    await t.db
      .update(agentPresence)
      .set({ locatedAt: new Date(Date.now() - 3 * 60_000) })
      .where(eq(agentPresence.userId, agent.userId));
    expect((await accept(agent, errand.id)).body.error.code).toBe('location_needed');
    expect((await board(agent)).body.error.code).toBe('location_needed');

    // A mocked position says nothing about where the agent is.
    await request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ ...PICKUP, mocked: true })
      .expect(200);
    expect((await accept(agent, errand.id)).body.error.code).toBe('mock_location');

    await online(agent);
    expect((await accept(agent, errand.id)).status).toBe(200);
  });

  it('needs the pickup within reach of the agent', async () => {
    const agent = await signIn(t, 'agent');
    const errand = await createErrand(t, customer);
    // About 13 km north of the pickup, past the 10 km the Matching settings start with.
    const far = { lat: PICKUP.lat + 0.12, lng: PICKUP.lng };
    await online(agent, far);
    const res = await board(agent, far).expect(200);
    expect((res.body.errands as Array<{ id: string }>).some((e) => e.id === errand.id)).toBe(false);
    expect((await accept(agent, errand.id)).body.error.code).toBe('too_far');
  });

  it("checks the agent's categories and purchases when accepting, not only on the board", async () => {
    const agent = await signIn(t, 'agent');
    await online(agent);
    const parcel = await createErrand(t, customer);
    await request(t.http)
      .patch('/v1/agent/profile')
      .set(agent.headers)
      .send({ categoryKeys: ['groceries'] })
      .expect(200);
    expect((await accept(agent, parcel.id)).body.error.code).toBe('category_off');

    const buying = await createErrand(t, customer, { categoryKey: 'groceries', buy: true });
    await request(t.http).patch('/v1/agent/profile').set(agent.headers).send({ takesPurchases: false }).expect(200);
    expect((await accept(agent, buying.id)).body.error.code).toBe('no_purchases');
  });

  it('keeps a customer and an agent flagged together apart until the flag is cleared', async () => {
    const agent = await signIn(t, 'agent');
    await online(agent);
    const errand = await createErrand(t, customer);
    const flagId = await flag('pair_shared_phone', customer.userId, agent.userId);
    expect(await onBoard(agent, errand.id)).toBe(false);
    // The agent isn't told why: a flag is for staff.
    const refused = await accept(agent, errand.id);
    expect(refused.body.error.code).toBe('unavailable');
    expect(JSON.stringify(refused.body)).not.toMatch(/flag/i);

    await t.db.update(riskFlags).set({ status: 'confirmed' }).where(eq(riskFlags.id, flagId));
    expect((await accept(agent, errand.id)).body.error.code).toBe('unavailable');
    await t.db.update(riskFlags).set({ status: 'cleared' }).where(eq(riskFlags.id, flagId));
    expect(await onBoard(agent, errand.id)).toBe(true);
    expect((await accept(agent, errand.id)).status).toBe(200);
  });

  it('keeps matching a customer and the agent who often works for them, unless staff confirm it is collusion', async () => {
    // Working together often is what a regular customer and their local agent do: a person looks first.
    const agent = await signIn(t, 'agent');
    await online(agent);
    const flagId = await flag('repeat_pairing', customer.userId, agent.userId);
    const first = await createErrand(t, customer);
    expect(await onBoard(agent, first.id)).toBe(true);
    await act(t, agent, first.id, 'accept');
    await t.db.update(riskFlags).set({ status: 'confirmed' }).where(eq(riskFlags.id, flagId));
    const next = await createErrand(t, customer);
    expect(await onBoard(agent, next.id)).toBe(false);
    expect((await accept(agent, next.id)).body.error.code).toBe('unavailable');
  });

  it('never gives an errand back to an agent who left it, or whom the customer replaced', async () => {
    const [left, replaced, next] = await Promise.all([0, 1, 2].map(() => signIn(t, 'agent')));
    for (const a of [left!, replaced!, next!]) await online(a);
    const errand = await createErrand(t, customer);

    await act(t, left!, errand.id, 'accept');
    await act(t, left!, errand.id, 'withdraw');
    expect(await onBoard(left!, errand.id)).toBe(false);
    expect((await accept(left!, errand.id)).body.error.code).toBe('gave_up');

    await act(t, replaced!, errand.id, 'accept');
    await act(t, customer, errand.id, 'release_agent');
    expect((await accept(replaced!, errand.id)).body.error.code).toBe('gave_up');

    expect((await accept(next!, errand.id)).status).toBe(200);
  });

  it('keeps an agent whose GPS was flagged as faked off errands while the flag is open, for a day at most', async () => {
    const agent = await signIn(t, 'agent');
    await online(agent);
    const errand = await createErrand(t, customer);
    const flagId = await flag('gps_jump', agent.userId, null);
    expect((await board(agent)).body.error.code).toBe('location_review');
    expect((await accept(agent, errand.id)).body.error.code).toBe('location_review');

    // Confirmed by staff, it holds the agent all the same; staff decide on anything more.
    await t.db.update(riskFlags).set({ status: 'confirmed' }).where(eq(riskFlags.id, flagId));
    expect((await accept(agent, errand.id)).body.error.code).toBe('location_review');

    // After the hold, the agent works again.
    await t.db
      .update(riskFlags)
      .set({ createdAt: new Date(Date.now() - 25 * 3_600_000) })
      .where(eq(riskFlags.id, flagId));
    expect((await accept(agent, errand.id)).status).toBe(200);
  });

  it('lets an agent work again as soon as staff clear a fake-GPS flag', async () => {
    const agent = await signIn(t, 'agent');
    await online(agent);
    const errand = await createErrand(t, customer);
    const flagId = await flag('gps_jump', agent.userId, null);
    expect((await accept(agent, errand.id)).body.error.code).toBe('location_review');
    await t.db.update(riskFlags).set({ status: 'cleared' }).where(eq(riskFlags.id, flagId));
    expect((await accept(agent, errand.id)).status).toBe(200);
  });

  it("doesn't hold one customer's GPS flag against them when they work as an agent", async () => {
    // A flag on someone else's errand names its customer first: only the agent named second is held.
    const agent = await signIn(t, 'agent');
    const other = await signIn(t, 'agent');
    await flag('gps_jump', agent.userId, other.userId);
    await online(agent);
    const errand = await createErrand(t, customer);
    expect((await accept(agent, errand.id)).status).toBe(200);
    await online(other);
    expect((await board(other)).body.error.code).toBe('location_review');
  });

  describe('errands at once', () => {
    it('holds an urgent errand alone', async () => {
      const agent = await signIn(t, 'agent');
      await online(agent);
      const urgent = await createErrand(t, customer, { urgent: true });
      const other = await createErrand(t, customer);
      await act(t, agent, urgent.id, 'accept');
      expect((await board(agent)).body.error.code).toBe('finish_urgent');
      expect((await accept(agent, other.id)).body.error.code).toBe('finish_urgent');
    });

    it('gives an urgent errand only to an agent holding nothing else, but a scheduled one taken ahead', async () => {
      const busy = await signIn(t, 'agent');
      const ahead = await signIn(t, 'agent');
      for (const a of [busy, ahead]) await online(a);
      const urgent = await createErrand(t, customer, { urgent: true });

      await act(t, busy, (await createErrand(t, customer)).id, 'accept');
      // Even holding its offer: an urgent errand is held alone.
      await offerTo(t, busy, urgent.id);
      expect((await accept(busy, urgent.id)).body.error.code).toBe('busy');

      await act(t, ahead, (await createErrand(t, customer, scheduled())).id, 'accept');
      await act(t, ahead, urgent.id, 'accept');
    });

    it('lets an agent hold errands from the board up to the cap admin sets', async () => {
      const agent = await signIn(t, 'agent');
      await online(agent);
      const waiting = await Promise.all([0, 1, 2, 3].map(() => createErrand(t, customer)));
      // A scheduled errand taken ahead is held like any other.
      await act(t, agent, (await createErrand(t, customer, scheduled())).id, 'accept');
      for (const e of waiting.slice(0, 2)) await act(t, agent, e.id, 'accept');
      expect((await accept(agent, waiting[2]!.id)).body.error.code).toBe('too_many_errands');
      expect((await board(agent)).body.error.code).toBe('too_many_errands');

      // The cap is read when accepting, as admin sets it now.
      await matching({ maxBoardErrands: 4 });
      try {
        expect((await accept(agent, waiting[2]!.id)).status).toBe(200);
        expect((await accept(agent, waiting[3]!.id)).body.error.code).toBe('too_many_errands');
      } finally {
        await matching({ maxBoardErrands: DEFAULT_MATCHING_SETTINGS.maxBoardErrands });
      }
    });
  });

  describe('the board', () => {
    const top = async (agent: Person, limit: number) => {
      const res = await request(t.http)
        .get(`/v1/errands/board?lat=${PICKUP.lat}&lng=${PICKUP.lng}&radiusKm=50&limit=${limit}`)
        .set(agent.headers)
        .expect(200);
      return (res.body.errands as Array<{ id: string }>).map((e) => e.id);
    };

    it('fills its list with errands the agent may take, past nearer ones they may not', async () => {
      const agent = await signIn(t, 'agent');
      await online(agent);
      await act(t, agent, (await createErrand(t, customer)).id, 'accept');
      const flagged = await signIn(t, 'customer');
      await fund(t, flagged, 5_000_000);
      await flag('pair_shared_phone', flagged.userId, agent.userId);
      const mine = await createErrand(t, customer);
      // Newer, so first at the same distance: urgent ones, and ones from a customer flagged with the agent.
      await createErrand(t, customer, { urgent: true });
      await createErrand(t, flagged);
      await createErrand(t, customer, { urgent: true });
      expect(await top(agent, 1)).toEqual([mine.id]);
    });

    it('shows no urgent errands, which are offered instead, so an agent at the cap is told so', async () => {
      const agent = await signIn(t, 'agent');
      await online(agent);
      for (let i = 0; i < 3; i++) await act(t, agent, (await createErrand(t, customer, scheduled())).id, 'accept');
      expect((await board(agent)).body.error.code).toBe('too_many_errands');
      // Their errands are all scheduled ones not started: an urgent one offered to them they may still take.
      const urgent = await createErrand(t, customer, { urgent: true });
      await offerTo(t, agent, urgent.id);
      expect((await accept(agent, urgent.id)).status).toBe(200);
    });
  });

  it('reads how near and how recent from the Matching settings', async () => {
    const agent = await signIn(t, 'agent');
    const errand = await createErrand(t, customer);
    const far = { lat: PICKUP.lat + 0.12, lng: PICKUP.lng };
    await online(agent, far);
    await t.db
      .update(agentPresence)
      .set({ locatedAt: new Date(Date.now() - 3 * 60_000) })
      .where(eq(agentPresence.userId, agent.userId));
    await matching({ boardRadiusKm: 20, locationFreshMinutes: 5 });
    try {
      expect(await onBoard(agent, errand.id, far)).toBe(true);
      expect((await accept(agent, errand.id)).status).toBe(200);
    } finally {
      await matching({
        boardRadiusKm: DEFAULT_MATCHING_SETTINGS.boardRadiusKm,
        locationFreshMinutes: DEFAULT_MATCHING_SETTINGS.locationFreshMinutes,
      });
    }
  });
});
