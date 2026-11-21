import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { agentPresence, errandOffers, errands } from '../src/db/schema';
import { AgentLocations } from '../src/matching/agent-locations';
import { MatchingRedis } from '../src/matching/matching-redis';
import { OffersService } from '../src/matching/offers.service';
import { RankingService } from '../src/matching/ranking.service';
import {
  act,
  adminAs,
  approved,
  balanceOf,
  createErrand,
  createTestApp,
  fund,
  onlineAtPickup,
  signIn,
  type Person,
  type TestApp,
} from './helpers';

/** Ibeju-Lekki, away from the other tests' agents. */
const IBEJU = { lat: 6.4333, lng: 3.9333 };
const east = (km: number) => ({ lat: IBEJU.lat, lng: IBEJU.lng + km / 111 });

/**
 * Urgent errands offered to one agent at a time (docs/matching.md, M6 and M7): the best-ranked agent gets a
 * ringing offer for 20 seconds, the next one if they decline or let it run out, and accepting an offer is one
 * conditional change in the accept transaction.
 */
describe('offers', () => {
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
  // Each test starts with no offer standing and no urgent errand waiting from the one before.
  afterEach(async () => {
    await t.db.update(errandOffers).set({ status: 'withdrawn' }).where(eq(errandOffers.status, 'open'));
    await t.db
      .update(errands)
      .set({ status: 'expired' })
      .where(and(eq(errands.status, 'requested'), eq(errands.urgent, true)));
  });

  /** Every agent so far taken offline, for a test that needs only its own. */
  const alone = async () => {
    const off = await t.db
      .update(agentPresence)
      .set({ online: false, onlineSince: null })
      .where(eq(agentPresence.online, true))
      .returning({ userId: agentPresence.userId });
    const locations = t.app.get(AgentLocations);
    for (const o of off) await locations.remove(o.userId, 'NG');
  };

  /** An agent online at a spot, with a phone that takes pushes. */
  const agentAt = async (at: { lat: number; lng: number }) => {
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
    return agent;
  };
  const urgentAt = (at = IBEJU) =>
    createErrand(t, customer, {
      urgent: true,
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Lekki-Epe Expressway, Ibeju-Lekki', ...at },
        { kind: 'dropoff', label: 'Home', address: 'Awoyaya, Lagos', lat: at.lat + 0.01, lng: at.lng },
      ],
    });
  const offersOf = (errandId: string) =>
    t.db.select().from(errandOffers).where(eq(errandOffers.errandId, errandId)).orderBy(errandOffers.offeredAt);
  const openOffer = async (errandId: string) => (await offersOf(errandId)).find((o) => o.status === 'open');
  const current = (agent: Person) => request(t.http).get('/v1/agent/offers/current').set(agent.headers);
  const decline = (agent: Person, offerId: string) =>
    request(t.http).post(`/v1/agent/offers/${offerId}/decline`).set(agent.headers);
  const accept = (agent: Person, errandId: string) =>
    request(t.http).post(`/v1/errands/${errandId}/events`).set(agent.headers).send({ event: 'accept' });
  /** As if the offer's time had come. */
  const runOut = (offerId: string) =>
    t.timers.fireWhere((job) => job.event === 'offer_expire' && job.offerId === offerId);
  const pushesTo = (agent: Person) => t.push.sent.filter((p) => p.token === `push-${agent.userId}`);

  it('offers an urgent errand to the best-ranked agent alone, ringing, for 20 seconds', async () => {
    const nearest = await agentAt(east(1));
    const other = await agentAt(east(4));
    const errand = await urgentAt();
    const offers = await offersOf(errand.id);
    expect(offers).toHaveLength(1);
    const [offer] = offers;
    expect(offer).toMatchObject({ agentId: nearest.userId, status: 'open' });
    expect(offer!.expiresAt.getTime() - offer!.offeredAt.getTime()).toBe(20_000);
    expect(offer!.score).toBeGreaterThan(0);
    expect(offer!.parts).toMatchObject({ travel: expect.any(Number), reliability: expect.any(Number) });

    // It rings: a push marked as an offer, to the agent offered it and no one else.
    expect(pushesTo(nearest).at(-1)).toMatchObject({
      ring: true,
      data: { type: 'errand.offer', errandId: errand.id, offerId: offer!.id },
    });
    expect(pushesTo(other)).toHaveLength(0);

    // What the agent's offer screen shows.
    const shown = (await current(nearest).expect(200)).body.offer;
    expect(shown).toMatchObject({
      id: offer!.id,
      expiresAt: offer!.expiresAt.toISOString(),
      errand: { id: errand.id, urgent: true, feeKobo: 250_000, buy: false, stopCount: 2, scheduledFor: null },
      customer: { firstName: 'Ada', verified: true, completedErrands: expect.any(Number) },
    });
    expect(shown.pickup.km).toBeGreaterThan(0.5);
    expect(shown.dropoff.km).toBeGreaterThan(shown.pickup.km);
    // What they'd earn, as the errand shows it to them, and how long is left by the server's clock.
    const asProspect = (await request(t.http).get(`/v1/errands/${errand.id}`).set(nearest.headers).expect(200)).body;
    expect(shown.agentEarnsKobo).toBe(asProspect.agentEarnsKobo);
    expect(shown.agentEarnsKobo).toBeGreaterThan(0);
    expect(shown.secondsLeft).toBeGreaterThan(15);
    expect(shown.secondsLeft).toBeLessThanOrEqual(20);
    expect((await current(other).expect(200)).body.offer).toBeNull();

    // An urgent errand isn't on the board: only the agent offered it can take it.
    const board = await request(t.http)
      .get(`/v1/errands/board?lat=${east(4).lat}&lng=${east(4).lng}&radiusKm=50`)
      .set(other.headers)
      .expect(200);
    expect((board.body.errands as Array<{ id: string }>).some((e) => e.id === errand.id)).toBe(false);
    expect((await accept(other, errand.id)).body.error.code).toBe('not_offered');

    expect((await accept(nearest, errand.id)).status).toBe(200);
    expect(await openOffer(errand.id)).toBeUndefined();
    expect((await offersOf(errand.id))[0]).toMatchObject({ status: 'accepted', answeredAt: expect.any(Date) });
  });

  it('moves to the next agent when one declines, and never offers it to them again', async () => {
    const first = await agentAt(east(1.2));
    const second = await agentAt(east(1.5));
    const errand = await urgentAt();
    const toFirst = (await openOffer(errand.id))!;
    expect(toFirst.agentId).toBe(first.userId);
    await decline(first, toFirst.id).expect(200);

    const toSecond = (await openOffer(errand.id))!;
    expect(toSecond.agentId).toBe(second.userId);
    expect((await offersOf(errand.id)).find((o) => o.id === toFirst.id)).toMatchObject({ status: 'declined' });
    await decline(second, toSecond.id).expect(200);
    // Others in this file may be offered it; never the two who said no.
    const offered = (await offersOf(errand.id)).map((o) => o.agentId);
    expect(offered.filter((id) => id === first.userId)).toHaveLength(1);
    expect(offered.filter((id) => id === second.userId)).toHaveLength(1);
    // Only the agent it's offered to can answer it.
    await decline(first, toSecond.id).expect(404);
  });

  it('moves to the next agent when the offer runs out', async () => {
    const slow = await agentAt(east(0.8));
    const ready = await agentAt(east(0.9));
    const errand = await urgentAt();
    const offer = (await openOffer(errand.id))!;
    expect(offer.agentId).toBe(slow.userId);
    await runOut(offer.id);
    expect((await offersOf(errand.id)).find((o) => o.id === offer.id)).toMatchObject({ status: 'expired' });
    expect((await openOffer(errand.id))!.agentId).toBe(ready.userId);
    // Too late now.
    expect((await accept(slow, errand.id)).body.error.code).toBe('not_offered');
  });

  it('never gives one agent two offers at once', async () => {
    const busy = await agentAt(east(0.3));
    const first = await urgentAt();
    expect((await openOffer(first.id))!.agentId).toBe(busy.userId);
    const second = await urgentAt();
    expect((await openOffer(second.id))?.agentId).not.toBe(busy.userId);
    const open = await t.db
      .select({ n: sql<number>`count(*)::int` })
      .from(errandOffers)
      .where(and(eq(errandOffers.agentId, busy.userId), eq(errandOffers.status, 'open')));
    expect(open[0]!.n).toBe(1);
  });

  it('takes an agent offline after missing offers in a row, and says so', async () => {
    await matching({ missedOffersOffline: 2 });
    try {
      const missing = await agentAt(east(0.1));
      for (let i = 0; i < 2; i++) {
        const errand = await urgentAt();
        const offer = (await openOffer(errand.id))!;
        expect(offer.agentId).toBe(missing.userId);
        await runOut(offer.id);
      }
      const [presence] = await t.db.select().from(agentPresence).where(eq(agentPresence.userId, missing.userId));
      expect(presence!.online).toBe(false);
      expect(pushesTo(missing).at(-1)).toMatchObject({ title: expect.stringMatching(/offline/i) });

      // The app's heartbeat, still saying online, doesn't put them back: only the agent going online does.
      const report = (body: Record<string, unknown>) =>
        request(t.http)
          .put('/v1/agent/presence')
          .set(missing.headers)
          .send({ ...east(0.1), ...body })
          .expect(200);
      expect((await report({ online: true })).body).toMatchObject({ online: false, offlineReason: 'missed_offers' });
      expect((await request(t.http).get('/v1/agent/presence').set(missing.headers).expect(200)).body).toMatchObject({
        online: false,
        offlineReason: 'missed_offers',
      });
      expect((await report({ online: true, tapped: true })).body).toMatchObject({ online: true });
      expect((await report({ online: true })).body.online).toBe(true);
      expect((await request(t.http).get('/v1/agent/presence').set(missing.headers).expect(200)).body).toMatchObject({
        online: true,
        offlineReason: null,
      });
    } finally {
      await matching({ missedOffersOffline: DEFAULT_MATCHING_SETTINGS.missedOffersOffline });
    }
  });

  it('brings back the agents who said no when the customer raises the fee', async () => {
    const only = await agentAt(east(0.05));
    const errand = await urgentAt();
    const offer = (await openOffer(errand.id))!;
    expect(offer.agentId).toBe(only.userId);
    await decline(only, offer.id).expect(200);
    // Whoever else gets it, let them pass too, until no one is left.
    for (let open = await openOffer(errand.id); open; open = await openOffer(errand.id)) {
      await t.db.update(errandOffers).set({ status: 'declined' }).where(eq(errandOffers.id, open.id));
    }
    await act(t, customer, errand.id, 'raise_fee', { amountKobo: 300_000 });
    expect((await openOffer(errand.id))?.agentId).toBe(only.userId);
  });

  it('withdraws the offer when the customer cancels', async () => {
    const agent = await agentAt(east(0.02));
    const errand = await urgentAt();
    const offer = (await openOffer(errand.id))!;
    expect(offer.agentId).toBe(agent.userId);
    await act(t, customer, errand.id, 'cancel');
    expect((await offersOf(errand.id)).find((o) => o.id === offer.id)).toMatchObject({ status: 'withdrawn' });
    expect((await current(agent).expect(200)).body.offer).toBeNull();
  });

  it('keeps trying while no one can take it, until someone can', async () => {
    const errand = await urgentAt({ lat: 6.4333, lng: 4.2 });
    expect(await openOffer(errand.id)).toBeUndefined();
    const later = t.timers.pending.find((p) => p.job.event === 'offer_dispatch' && p.job.errandId === errand.id);
    expect(later?.delayMs).toBe(DEFAULT_MATCHING_SETTINGS.dispatchRetrySeconds * 1000);
    const arrived = await agentAt({ lat: 6.4333, lng: 4.21 });
    await t.timers.fireWhere((job) => job.event === 'offer_dispatch' && job.errandId === errand.id);
    expect((await openOffer(errand.id))?.agentId).toBe(arrived.userId);
  });

  it('keeps offering when finding the next agent fails for a moment', async () => {
    await alone();
    const first = await agentAt(east(0.5));
    const second = await agentAt(east(0.6));
    const errand = await urgentAt();
    const offer = (await openOffer(errand.id))!;
    expect(offer.agentId).toBe(first.userId);
    const failing = vi.spyOn(t.app.get(RankingService), 'ranked').mockRejectedValueOnce(new Error('Maps down'));
    try {
      // The no is kept, and the agent told so, whatever happens next.
      await decline(first, offer.id).expect(200);
    } finally {
      failing.mockRestore();
    }
    expect(await openOffer(errand.id)).toBeUndefined();
    await t.timers.fireWhere((job) => job.event === 'offer_dispatch' && job.errandId === errand.id);
    expect((await openOffer(errand.id))?.agentId).toBe(second.userId);
  });

  it('looks past the agents who said no, however short the shortlist', async () => {
    await matching({ shortlistSize: 2 });
    try {
      await alone();
      const agents = [await agentAt(east(0.5)), await agentAt(east(0.6)), await agentAt(east(0.7))];
      const errand = await urgentAt();
      for (const agent of agents.slice(0, 2)) {
        const offer = (await openOffer(errand.id))!;
        expect(offer.agentId).toBe(agent.userId);
        await decline(agent, offer.id).expect(200);
      }
      expect((await openOffer(errand.id))?.agentId).toBe(agents[2]!.userId);
    } finally {
      await matching({ shortlistSize: DEFAULT_MATCHING_SETTINGS.shortlistSize });
    }
  });

  it('ends an offer whose timer never came, freeing the errand and the agent', async () => {
    await alone();
    const lost = await agentAt(east(0.5));
    const next = await agentAt(east(0.6));
    const first = await urgentAt();
    const stuck = (await openOffer(first.id))!;
    expect(stuck.agentId).toBe(lost.userId);
    const timeUp = (id: string, agoMs: number) =>
      t.db
        .update(errandOffers)
        .set({ expiresAt: new Date(Date.now() - agoMs) })
        .where(eq(errandOffers.id, id));
    // Its time was up a minute ago, but its timer never came (lost as Redis failed, say): the sweep ends it.
    await timeUp(stuck.id, 60_000);
    await t.jobs.run('offers.sweep');
    expect((await offersOf(first.id)).find((o) => o.id === stuck.id)).toMatchObject({ status: 'expired' });
    const again = (await openOffer(first.id))!;
    expect(again.agentId).toBe(next.userId);
    // And the agent can be offered the next errand.
    const second = await urgentAt();
    expect((await openOffer(second.id))?.agentId).toBe(lost.userId);

    // An errand whose offer's time is up is offered again as soon as it changes, sweep or not.
    await timeUp(again.id, 1_000);
    await act(t, customer, first.id, 'raise_fee', { amountKobo: 300_000 });
    const raised = (await openOffer(first.id))!;
    expect(raised.agentId).toBe(next.userId);
    expect(raised.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect((await offersOf(first.id)).find((o) => o.id === again.id)).toMatchObject({ status: 'expired' });
  });

  it('puts urgent errands on the board for anyone to take while offers are off, and offers them once on', async () => {
    await matching({ offers: false });
    try {
      await alone();
      const agent = await agentAt(east(0.5));
      const other = await agentAt(east(0.6));
      const errand = await urgentAt();
      expect(await offersOf(errand.id)).toHaveLength(0);
      const board = await request(t.http)
        .get(`/v1/errands/board?lat=${east(0.5).lat}&lng=${east(0.5).lng}&radiusKm=50`)
        .set(agent.headers)
        .expect(200);
      expect((board.body.errands as Array<{ id: string }>).some((e) => e.id === errand.id)).toBe(true);
      expect((await accept(agent, errand.id)).status).toBe(200);

      // Waiting while they're off, and offered once they're on again.
      const waiting = await urgentAt();
      await matching({ offers: true });
      await t.timers.fireWhere((job) => job.event === 'offer_dispatch' && job.errandId === waiting.id);
      expect((await openOffer(waiting.id))?.agentId).toBe(other.userId);
    } finally {
      await matching({ offers: true });
    }
  });

  it('keeps one look again waiting per errand, for longer than its timer takes', async () => {
    await alone();
    const errand = await urgentAt();
    const offers = t.app.get(OffersService);
    await offers.dispatch(errand.id);
    await offers.dispatch(errand.id);
    const looks = t.timers.pending.filter((p) => p.job.event === 'offer_dispatch' && p.job.errandId === errand.id);
    expect(looks).toHaveLength(1);
    // A timer that comes late doesn't let a second one start meanwhile.
    const redis = t.app.get(MatchingRedis).client;
    expect(await redis.ttl(`offers:retry:${errand.id}`)).toBeGreaterThan(
      DEFAULT_MATCHING_SETTINGS.dispatchRetrySeconds,
    );

    // The look and its timer lost (Redis failing, say): the sweep looks again.
    await redis.del(`offers:retry:${errand.id}`);
    t.timers.pending.splice(t.timers.pending.indexOf(looks[0]!), 1);
    const arrived = await agentAt(east(0.5));
    await t.jobs.run('offers.sweep');
    expect((await openOffer(errand.id))?.agentId).toBe(arrived.userId);
  });

  describe('accepting safely (M7)', () => {
    it('lets only the agent offered it take it, once, however many times they tap at once', async () => {
      const agent = await agentAt(east(0.01));
      const errand = await urgentAt();
      expect((await openOffer(errand.id))!.agentId).toBe(agent.userId);
      const taps = await Promise.all(Array.from({ length: 20 }, () => accept(agent, errand.id)));
      expect(taps.filter((r) => r.status === 200)).toHaveLength(1);
      const [row] = await t.db.select().from(errands).where(eq(errands.id, errand.id));
      expect(row).toMatchObject({ status: 'accepted', agentId: agent.userId });
    });

    it('gives a board errand to exactly one of 50 agents accepting at once, holding the money once', async () => {
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, 1_000_000);
      const errand = await createErrand(t, buyer);
      const agents = await Promise.all(Array.from({ length: 50 }, () => signIn(t, 'agent')));
      for (const a of agents) await onlineAtPickup(t, a, errand.id);
      const results = await Promise.all(agents.map((a) => accept(a, errand.id)));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      // The fee and its service fee are held once: 250,000 and 25,000.
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(1_000_000 - 275_000);
      const [row] = await t.db.select().from(errands).where(eq(errands.id, errand.id));
      expect(row!.status).toBe('accepted');
    });
  });
});
