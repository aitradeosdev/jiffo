import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { agentPresence, errandEvents, errandOffers, errands } from '../src/db/schema';
import { AgentLocations } from '../src/matching/agent-locations';
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

/** Ikorodu, away from the other tests' errands. */
const HERE = { lat: 6.62, lng: 3.5 };
const east = (km: number) => ({ lat: HERE.lat, lng: HERE.lng + km / 110 });
const MINUTE = 60_000;

/**
 * Scheduled errands (docs/matching.md, M12), as Bolt's scheduled rides: taken ahead from the board only by agents
 * whose completion rate is 50% or more; the agent reminded to be online 15 minutes before; the errand taken back and
 * sent as urgent at 10 minutes if they aren't, which counts against them like leaving it; and no urgent offer that
 * would make them late for it.
 */
describe('scheduled errands', () => {
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
  const pushToken = (person: Person) =>
    request(t.http)
      .put('/v1/devices/current/push-token')
      .set(person.headers)
      .send({ token: `push-${person.userId}` })
      .expect(204);
  const pushesTo = (person: Person) => t.push.sent.filter((p) => p.token === `push-${person.userId}`);

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    // As the other test files have it: agents moved in an instant aren't held for faked GPS, and may hold many.
    await matching({ ...DEFAULT_MATCHING_SETTINGS, fakeGpsHoldHours: 0, maxBoardErrands: 10 });
    customer = await signIn(t, 'customer');
    await fund(t, customer, 100_000_000);
    await pushToken(customer);
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
    await matching(original.settings.matching);
    await t.close();
  });

  const agentAt = async (at: { lat: number; lng: number }) => {
    const agent = await signIn(t, 'agent');
    await pushToken(agent);
    await request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, ...at })
      .expect(200);
    return agent;
  };
  const stops = (pickup: { lat: number; lng: number }, dropoff: { lat: number; lng: number }) => [
    { kind: 'pickup', label: 'Shop', address: 'Ikorodu Road, Lagos', ...pickup },
    { kind: 'dropoff', label: 'Home', address: 'Ikorodu, Lagos', ...dropoff },
  ];
  const scheduledIn = (minutes: number, at = east(0.5)) =>
    createErrand(t, customer, {
      scheduledFor: new Date(Date.now() + minutes * MINUTE).toISOString(),
      stops: stops(at, { lat: at.lat + 0.01, lng: at.lng }),
    });
  const board = async (agent: Person, at = HERE) =>
    (
      (
        await request(t.http)
          .get(`/v1/errands/board?lat=${at.lat}&lng=${at.lng}&radiusKm=50`)
          .set(agent.headers)
          .expect(200)
      ).body.errands as Array<{ id: string }>
    ).map((e) => e.id);
  const timersFor = (errandId: string, event: string) =>
    t.timers.pending.filter((p) => p.job.errandId === errandId && p.job.event === event);

  it('goes only to agents who finish at least half the errands they accept', async () => {
    const quitter = await agentAt(HERE);
    // Took two errands and left both.
    for (let i = 0; i < 2; i++) {
      const left = await createErrand(t, customer, { stops: stops(east(0.2), east(1)) });
      await act(t, quitter, left.id, 'accept');
      await act(t, quitter, left.id, 'withdraw');
    }
    const errand = await scheduledIn(60);
    expect(await board(quitter)).not.toContain(errand.id);
    const refused = await request(t.http)
      .post(`/v1/errands/${errand.id}/events`)
      .set(quitter.headers)
      .send({ event: 'accept' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('completion_low');
    // A new agent, with no errands left behind, can.
    const fresh = await agentAt(HERE);
    expect(await board(fresh)).toContain(errand.id);
    await act(t, fresh, errand.id, 'accept');
  });

  it('reminds the agent 15 minutes before, and at 10 takes it back from one not online, sent as urgent', async () => {
    const agent = await agentAt(HERE);
    const errand = await scheduledIn(60);
    await act(t, agent, errand.id, 'accept');
    // Due at 45 and 50 minutes from now.
    const [reminder] = timersFor(errand.id, 'scheduled_reminder');
    const [takeBack] = timersFor(errand.id, 'take_back');
    expect(reminder!.delayMs).toBeGreaterThan(44 * MINUTE);
    expect(reminder!.delayMs).toBeLessThanOrEqual(45 * MINUTE);
    expect(takeBack!.delayMs).toBeGreaterThan(49 * MINUTE);
    expect(takeBack!.delayMs).toBeLessThanOrEqual(50 * MINUTE);

    await request(t.http).put('/v1/agent/presence').set(agent.headers).send({ online: false }).expect(200);
    await t.timers.fireWhere((job) => job.event === 'scheduled_reminder' && job.errandId === errand.id);
    expect(pushesTo(agent).at(-1)).toMatchObject({ title: 'Go online for your scheduled errand' });

    // Another agent, online near the pickup, for when it goes out as urgent.
    const standby = await agentAt(east(0.3));
    await t.timers.fireWhere((job) => job.event === 'take_back' && job.errandId === errand.id);
    const [row] = await t.db.select().from(errands).where(eq(errands.id, errand.id));
    expect(row).toMatchObject({ status: 'requested', urgent: true, agentId: null });
    const [taken] = await t.db
      .select()
      .from(errandEvents)
      .where(and(eq(errandEvents.errandId, errand.id), eq(errandEvents.event, 'take_back')));
    expect(taken!.data).toMatchObject({ agentId: agent.userId });
    expect(pushesTo(customer).at(-1)).toMatchObject({ title: 'Finding another agent' });
    expect(pushesTo(agent).at(-1)).toMatchObject({ title: 'Scheduled errand taken back' });
    // It counts against them as leaving it, and they can't have it again.
    const standing = (await request(t.http).get('/v1/agent/standing').set(agent.headers).expect(200)).body;
    expect(standing.completionRate).toBe(0);
    expect(standing.cancellations7d).toBe(1);
    // Offered one at a time, as any urgent errand.
    await t.timers.fireWhere((job) => job.event === 'offer_batch');
    const [offer] = await t.db
      .select()
      .from(errandOffers)
      .where(and(eq(errandOffers.errandId, errand.id), eq(errandOffers.status, 'open')));
    expect(offer!.agentId).toBe(standby.userId);
  });

  it('stays with an agent who is online, and reminds no one who is', async () => {
    const agent = await agentAt(HERE);
    const errand = await scheduledIn(60);
    await act(t, agent, errand.id, 'accept');
    const before = pushesTo(agent).length;
    await t.timers.fireWhere((job) => job.event === 'scheduled_reminder' && job.errandId === errand.id);
    await t.timers.fireWhere((job) => job.event === 'take_back' && job.errandId === errand.id);
    expect(pushesTo(agent).length).toBe(before);
    const [row] = await t.db.select().from(errands).where(eq(errands.id, errand.id));
    expect(row).toMatchObject({ status: 'accepted', agentId: agent.userId, urgent: false });
  });

  it('offers an agent holding one no urgent errand that would make them late for it', async () => {
    const agent = await agentAt(HERE);
    const ahead = await scheduledIn(30, east(0.5));
    await act(t, agent, ahead.id, 'accept');
    // 9 km away and back: well over half an hour at the fallback speed.
    const long = await createErrand(t, customer, { urgent: true, stops: stops(east(0.3), east(9)) });
    expect((await t.db.select().from(errandOffers).where(eq(errandOffers.errandId, long.id))).length).toBe(0);
    // A short one fits before it.
    const short = await createErrand(t, customer, { urgent: true, stops: stops(east(0.3), east(1)) });
    const [offer] = await t.db.select().from(errandOffers).where(eq(errandOffers.errandId, short.id));
    expect(offer?.agentId).toBe(agent.userId);
  });
});
