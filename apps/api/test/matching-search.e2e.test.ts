import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { agentPresence, errandOffers, errands } from '../src/db/schema';
import { AgentLocations } from '../src/matching/agent-locations';
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

/** Lekki Free Zone, away from the other tests' agents. */
const FREE_ZONE = { lat: 6.47, lng: 4.08 };
const east = (km: number) => ({ lat: FREE_ZONE.lat, lng: FREE_ZONE.lng + km / 111 });

/**
 * An urgent errand's search (docs/matching.md, M8): offered one agent at a time within each radius in turn, up to
 * the step's offers, then to every agent within the last radius at once, the first to accept getting it. Here the
 * steps are 1, 2 and 3 km with one offer each.
 */
describe('the search steps', () => {
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
    await matching({ ...DEFAULT_MATCHING_SETTINGS, searchStepsKm: [1, 2, 3], offersPerStep: 1 });
    customer = await signIn(t, 'customer');
    await fund(t, customer, 100_000_000);
    await request(t.http)
      .put('/v1/devices/current/push-token')
      .set(customer.headers)
      .send({ token: `push-${customer.userId}` })
      .expect(204);
  });
  afterAll(async () => {
    await matching(original.settings.matching);
    await t.close();
  });
  // Each test starts with every agent so far offline, and no urgent errand waiting.
  afterEach(async () => {
    vi.restoreAllMocks();
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
  const urgent = () =>
    createErrand(t, customer, {
      urgent: true,
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Free Zone Road, Lekki', ...FREE_ZONE },
        { kind: 'dropoff', label: 'Home', address: 'Eleko, Lagos', lat: FREE_ZONE.lat + 0.01, lng: FREE_ZONE.lng },
      ],
    });
  const openOffer = async (errandId: string) =>
    (await t.db.select().from(errandOffers).where(eq(errandOffers.errandId, errandId))).find(
      (o) => o.status === 'open',
    );
  const decline = async (agent: Person, errandId: string) => {
    const offer = (await openOffer(errandId))!;
    expect(offer.agentId).toBe(agent.userId);
    await request(t.http).post(`/v1/agent/offers/${offer.id}/decline`).set(agent.headers).expect(200);
  };
  const accept = (agent: Person, errandId: string) =>
    request(t.http).post(`/v1/errands/${errandId}/events`).set(agent.headers).send({ event: 'accept' });
  const boardHas = async (agent: Person, at: { lat: number; lng: number }, errandId: string) => {
    const board = await request(t.http)
      .get(`/v1/errands/board?lat=${at.lat}&lng=${at.lng}&radiusKm=50`)
      .set(agent.headers)
      .expect(200);
    return (board.body.errands as Array<{ id: string }>).some((e) => e.id === errandId);
  };
  const search = async (errandId: string) =>
    (await request(t.http).get(`/v1/errands/${errandId}`).set(customer.headers).expect(200)).body.search;
  const pushesTo = (person: Person) => t.push.sent.filter((p) => p.token === `push-${person.userId}`);
  const lookAgain = (errandId: string) =>
    t.timers.fireWhere((job) => job.event === 'offer_dispatch' && job.errandId === errandId);

  it('offers it within the first radius before a better-ranked agent further out', async () => {
    await matching({ weights: { travel: 0, reliability: 0, rating: 0, waiting: 100 } });
    try {
      const near = await agentAt(east(0.5));
      const waited = await agentAt(east(1.5));
      // The one further out has waited two hours, so ranks first.
      await t.db
        .update(agentPresence)
        .set({ onlineSince: new Date(Date.now() - 2 * 3_600_000) })
        .where(eq(agentPresence.userId, waited.userId));
      const errand = await urgent();
      expect((await openOffer(errand.id))?.agentId).toBe(near.userId);
      expect(await search(errand.id)).toEqual({ radiusKm: 1, everyone: false });
      // Its one offer made, the search moves out to 2 km.
      await decline(near, errand.id);
      expect((await openOffer(errand.id))?.agentId).toBe(waited.userId);
      expect(await search(errand.id)).toEqual({ radiusKm: 2, everyone: false });
    } finally {
      await matching({ weights: DEFAULT_MATCHING_SETTINGS.weights });
    }
  });

  it('moves out at once when no one is within the radius', async () => {
    const far = await agentAt(east(2.5));
    const errand = await urgent();
    expect((await openOffer(errand.id))?.agentId).toBe(far.userId);
    expect(await search(errand.id)).toEqual({ radiusKm: 3, everyone: false });
  });

  it('then tells every agent within the last radius at once, and the first to accept gets it', async () => {
    const [a, b, c] = [await agentAt(east(0.5)), await agentAt(east(1.5)), await agentAt(east(2.5))];
    const errand = await urgent();
    for (const agent of [a, b, c]) await decline(agent, errand.id);
    expect(await openOffer(errand.id)).toBeUndefined();
    expect(await search(errand.id)).toEqual({ radiusKm: 3, everyone: true });

    // Agents arriving now are told on the next look, within the last radius only, and never those who said no.
    const [d, e, beyond] = [await agentAt(east(1)), await agentAt(east(2.8)), await agentAt(east(5))];
    const told = vi.spyOn(t.app.get(RealtimeGateway), 'toUser');
    await lookAgain(errand.id);
    for (const agent of [d, e]) {
      expect(pushesTo(agent).at(-1)).toMatchObject({ data: { type: 'errand.broadcast', errandId: errand.id } });
      expect(pushesTo(agent).at(-1)?.ring).toBeFalsy();
    }
    for (const agent of [a, b, c, beyond]) {
      expect(pushesTo(agent).some((p) => p.data?.type === 'errand.broadcast')).toBe(false);
    }
    // Told once, however often it looks again.
    await lookAgain(errand.id);
    expect(pushesTo(d).filter((p) => p.data?.type === 'errand.broadcast')).toHaveLength(1);
    // On the board now, for whoever may take it within the last radius.
    expect(await boardHas(d, east(1), errand.id)).toBe(true);
    expect(await boardHas(beyond, east(5), errand.id)).toBe(false);

    expect((await accept(d, errand.id)).status).toBe(200);
    const late = await accept(e, errand.id);
    expect(late.status).toBe(409);
    expect(late.body.error).toMatchObject({ code: 'errand_taken', message: 'This errand was taken' });
    // The others told were told it was taken; the one who took it wasn't.
    expect(told).toHaveBeenCalledWith(e.userId, 'agent', 'errand.gone', { errandId: errand.id, taken: true });
    expect(told).not.toHaveBeenCalledWith(d.userId, 'agent', 'errand.gone', expect.anything());
  });

  it('starts again at the first radius when the customer raises the fee, asking those who said no again', async () => {
    const [a, b, c] = [await agentAt(east(0.5)), await agentAt(east(1.5)), await agentAt(east(2.5))];
    const errand = await urgent();
    for (const agent of [a, b, c]) await decline(agent, errand.id);
    expect(await search(errand.id)).toMatchObject({ everyone: true });
    await act(t, customer, errand.id, 'raise_fee', { amountKobo: 300_000 });
    expect((await openOffer(errand.id))?.agentId).toBe(a.userId);
    expect(await search(errand.id)).toEqual({ radiusKm: 1, everyone: false });
    // Offered one at a time again, so off the board.
    expect(await boardHas(b, east(1.5), errand.id)).toBe(false);
    expect((await accept(b, errand.id)).body.error.code).toBe('not_offered');
  });

  it('asks the customer to raise the fee once the prompt time has passed, unless they have', async () => {
    const prompts = () => pushesTo(customer).filter((p) => p.data?.type === 'errand.raise_prompt');
    const promptFor = (errandId: string) =>
      t.timers.pending.find((p) => p.job.event === 'raise_prompt' && p.job.errandId === errandId);
    const timers = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body
      .settings.timers;

    const waiting = await urgent();
    expect(promptFor(waiting.id)?.delayMs).toBe(timers.raisePricePromptMinutes * 60_000);
    const before = prompts().length;
    await t.timers.fireWhere((job) => job.event === 'raise_prompt' && job.errandId === waiting.id);
    expect(prompts()).toHaveLength(before + 1);
    expect(prompts().at(-1)).toMatchObject({ data: { errandId: waiting.id } });

    // An errand from the board waits longer before the prompt.
    const board = await createErrand(t, customer);
    expect(promptFor(board.id)?.delayMs).toBe(timers.boardRaisePromptMinutes * 60_000);

    // Raised already: not asked.
    const raised = await urgent();
    await act(t, customer, raised.id, 'raise_fee', { amountKobo: 300_000 });
    await t.timers.fireWhere((job) => job.event === 'raise_prompt' && job.errandId === raised.id);
    expect(prompts()).toHaveLength(before + 1);
  });
});
