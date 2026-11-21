import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { agentPresence, errandOffers, errands } from '../src/db/schema';
import { AgentLocations } from '../src/matching/agent-locations';
import { adminAs, approved, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

/** Ikota, away from the other tests' agents. */
const IKOTA = { lat: 6.445, lng: 3.555 };
const east = (km: number) => ({ lat: IKOTA.lat, lng: IKOTA.lng + km / 111 });

/**
 * Urgent errands sent at about the same time (docs/matching.md, M5): the first offers wait a moment so they are
 * matched together, with agents assigned so as many errands as possible get one and the total score is highest,
 * not each errand its best agent in turn.
 */
describe('batching first offers', () => {
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

  const agentAt = async (at: { lat: number; lng: number }, workRadiusKm?: number) => {
    const agent = await signIn(t, 'agent');
    if (workRadiusKm) {
      await request(t.http).patch('/v1/agent/profile').set(agent.headers).send({ workRadiusKm }).expect(200);
    }
    await request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, ...at })
      .expect(200);
    return agent;
  };
  /** Sent, its first offer left to wait for the batch. */
  const urgentAt = (at: { lat: number; lng: number }) =>
    createErrand(
      t,
      customer,
      {
        urgent: true,
        stops: [
          { kind: 'pickup', label: 'Shop', address: 'Ikota Shopping Complex, Lekki', ...at },
          { kind: 'dropoff', label: 'Home', address: 'Ajah, Lagos', lat: at.lat + 0.01, lng: at.lng },
        ],
      },
      { batch: 'leave' },
    );
  const openOffer = async (errandId: string) =>
    (await t.db.select().from(errandOffers).where(eq(errandOffers.errandId, errandId))).find(
      (o) => o.status === 'open',
    );
  const batches = () => t.timers.pending.filter((p) => p.job.event === 'offer_batch');
  const runBatch = () => t.timers.fireWhere((job) => job.event === 'offer_batch');

  it('waits a moment, then matches errands sent together so both get an agent', async () => {
    // X is best for both errands; Y can reach only the first.
    const x = await agentAt(east(0));
    const y = await agentAt(east(-0.8), 1);
    const first = await urgentAt(east(0));
    const second = await urgentAt(east(2));
    // Sending one doesn't wait for an agent to be found: nothing is offered until the batch runs.
    expect(await openOffer(first.id)).toBeUndefined();
    expect(await openOffer(second.id)).toBeUndefined();
    expect(batches()).toHaveLength(1);
    expect(batches()[0]!.delayMs).toBe(DEFAULT_MATCHING_SETTINGS.batchSeconds * 1000);

    await runBatch();
    // In turn, the first would take X and the second wait: together, the first goes to Y and the second to X.
    expect((await openOffer(first.id))?.agentId).toBe(y.userId);
    expect((await openOffer(second.id))?.agentId).toBe(x.userId);
  });

  it('offers a lone errand to its best-ranked agent', async () => {
    const near = await agentAt(east(0.2));
    await agentAt(east(1.5));
    const errand = await urgentAt(east(0));
    await runBatch();
    expect((await openOffer(errand.id))?.agentId).toBe(near.userId);
  });

  it('gives an agent at most one errand of a batch, and looks again for the rest', async () => {
    const only = await agentAt(east(0));
    const first = await urgentAt(east(0));
    const second = await urgentAt(east(0.1));
    await runBatch();
    const offered = [await openOffer(first.id), await openOffer(second.id)].filter(Boolean);
    expect(offered).toHaveLength(1);
    expect(offered[0]!.agentId).toBe(only.userId);
    const waiting = offered[0]!.errandId === first.id ? second : first;
    expect(t.timers.pending.some((p) => p.job.event === 'offer_dispatch' && p.job.errandId === waiting.id)).toBe(true);
  });

  it('batches each state on its own, one batch at a time', async () => {
    await urgentAt(east(0));
    await urgentAt(east(0.3));
    await urgentAt(east(0.6));
    expect(batches()).toHaveLength(1);
    await runBatch();
    expect(batches()).toHaveLength(0);
    // The next errand starts the next batch.
    await urgentAt(east(0));
    expect(batches()).toHaveLength(1);
    await runBatch();
  });
});
