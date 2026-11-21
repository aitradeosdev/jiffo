import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { agentPresence, errandOffers, errands } from '../src/db/schema';
import { AgentLocations } from '../src/matching/agent-locations';
import { adminAs, approved, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

/** Sangotedo, away from the other tests' agents. */
const SANGOTEDO = { lat: 6.47, lng: 3.63 };
const east = (km: number) => ({ lat: SANGOTEDO.lat, lng: SANGOTEDO.lng + km / 111 });

/**
 * The acceptance rate (docs/matching.md, M9): the share of an agent's last counted offers they took. Offers far
 * from the agent, or soon after they went online, don't count, and the offer screen says so; a low rate lowers
 * their ranking and, where admin set a level, pauses their offers for a while.
 */
describe('the acceptance rate', () => {
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
    await matching(DEFAULT_MATCHING_SETTINGS);
    customer = await signIn(t, 'customer');
    await fund(t, customer, 100_000_000);
  });
  afterAll(async () => {
    await matching(original.settings.matching);
    await t.close();
  });
  afterEach(async () => {
    await alone();
    await t.db
      .update(errands)
      .set({ status: 'expired' })
      .where(and(eq(errands.status, 'requested'), eq(errands.urgent, true)));
  });

  /** Every agent so far offline, and their offers gone. */
  async function alone() {
    await t.db.update(errandOffers).set({ status: 'withdrawn' }).where(eq(errandOffers.status, 'open'));
    const off = await t.db
      .update(agentPresence)
      .set({ online: false, onlineSince: null })
      .where(eq(agentPresence.online, true))
      .returning({ userId: agentPresence.userId });
    for (const o of off) await t.app.get(AgentLocations).remove(o.userId, 'NG');
  }
  /** An agent online at a spot, with a phone that takes pushes; online a while already unless `fresh`. */
  const agentAt = async (at: { lat: number; lng: number }, fresh = false) => {
    const agent = await signIn(t, 'agent');
    await request(t.http)
      .put('/v1/devices/current/push-token')
      .set(agent.headers)
      .send({ token: `push-${agent.userId}` })
      .expect(204);
    await request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, ...at })
      .expect(200);
    if (!fresh) {
      await t.db
        .update(agentPresence)
        .set({ onlineSince: new Date(Date.now() - 10 * 60_000) })
        .where(eq(agentPresence.userId, agent.userId));
    }
    return agent;
  };
  const urgent = (at = SANGOTEDO) =>
    createErrand(t, customer, {
      urgent: true,
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Sangotedo Market, Lagos', ...at },
        { kind: 'dropoff', label: 'Home', address: 'Abijo, Lagos', lat: at.lat + 0.01, lng: at.lng },
      ],
    });
  const openOffer = async (errandId: string) =>
    (await t.db.select().from(errandOffers).where(eq(errandOffers.errandId, errandId))).find(
      (o) => o.status === 'open',
    );
  const current = async (agent: Person) =>
    (await request(t.http).get('/v1/agent/offers/current').set(agent.headers).expect(200)).body.offer;
  const decline = async (agent: Person, errandId: string) => {
    const offer = (await openOffer(errandId))!;
    expect(offer.agentId).toBe(agent.userId);
    await request(t.http).post(`/v1/agent/offers/${offer.id}/decline`).set(agent.headers).expect(200);
  };
  const runOut = async (errandId: string) => {
    const offer = (await openOffer(errandId))!;
    await t.timers.fireWhere((job) => job.event === 'offer_expire' && job.offerId === offer.id);
  };
  const standing = async (agent: Person) =>
    (await request(t.http).get('/v1/agent/standing').set(agent.headers).expect(200)).body;
  const pushesTo = (agent: Person) => t.push.sent.filter((p) => p.token === `push-${agent.userId}`);

  it('counts an offer near enough, after a while online, and says on the offer screen which count', async () => {
    const steady = await agentAt(east(1));
    const counted = await urgent();
    expect(await openOffer(counted.id)).toMatchObject({ agentId: steady.userId, counts: true });
    expect(await current(steady)).toMatchObject({ counts: true });
    await alone();

    // Just online: declining is free for the first minutes.
    const fresh = await agentAt(east(1), true);
    const early = await urgent();
    expect(await openOffer(early.id)).toMatchObject({ agentId: fresh.userId, counts: false });
    expect(await current(fresh)).toMatchObject({ counts: false });
    await alone();

    // Further than 3 km from the pickup: free to decline too.
    const far = await agentAt(east(4));
    const distant = await urgent();
    expect(await openOffer(distant.id)).toMatchObject({ agentId: far.userId, counts: false });
  });

  it('works out the rate from counted offers only, beside completion and cancellations', async () => {
    const agent = await agentAt(east(1));
    for (let i = 0; i < 2; i++) await decline(agent, (await urgent()).id);
    await runOut((await urgent()).id);
    // A far one, declined: not counted.
    await decline(agent, (await urgent(east(-3.5))).id);
    const taken = await urgent();
    expect((await openOffer(taken.id))?.agentId).toBe(agent.userId);
    await request(t.http)
      .post(`/v1/errands/${taken.id}/events`)
      .set(agent.headers)
      .send({ event: 'accept' })
      .expect(200);
    expect(await standing(agent)).toMatchObject({
      acceptanceRate: 0.25,
      countedOffers: 4,
      completionRate: 1,
      cancellations7d: 0,
      offersPausedUntil: null,
    });
  });

  it('pauses offers below the level admin set, says so, and leaves the board open', async () => {
    await matching({ pauseBelowBps: 6_000, pauseMinOffers: 2, pauseMinutes: 30 });
    try {
      const picky = await agentAt(east(0.5));
      // The first no leaves them at 0% from one offer: too few to pause on.
      await decline(picky, (await urgent()).id);
      expect((await standing(picky)).offersPausedUntil).toBeNull();
      await decline(picky, (await urgent()).id);

      const paused = await standing(picky);
      expect(new Date(paused.offersPausedUntil).getTime()).toBeGreaterThan(Date.now() + 29 * 60_000);
      expect(pushesTo(picky).at(-1)).toMatchObject({ title: expect.stringMatching(/paused/i) });
      // Not offered the next errand while paused, though nearest; the board still works.
      const other = await agentAt(east(2));
      const next = await urgent();
      expect((await openOffer(next.id))?.agentId).toBe(other.userId);
      await request(t.http)
        .get(`/v1/errands/board?lat=${east(0.5).lat}&lng=${east(0.5).lng}&radiusKm=50`)
        .set(picky.headers)
        .expect(200);
    } finally {
      await matching({ pauseBelowBps: null });
    }
  });
});
