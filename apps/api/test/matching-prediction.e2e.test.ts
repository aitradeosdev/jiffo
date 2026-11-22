import { and, desc, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { acceptanceModels, agentPresence, errandOffers, errands } from '../src/db/schema';
import { AgentLocations } from '../src/matching/agent-locations';
import { adminAs, approved, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

/** Agege, away from the other tests' errands. */
const HERE = { lat: 6.62, lng: 3.32 };
const east = (km: number) => ({ lat: HERE.lat, lng: HERE.lng + km / 110 });

/**
 * Acceptance prediction (docs/matching.md, M13), as DoorDash ranks with it: each offer keeps what it looked like to
 * the agent; nightly, each state with enough answered offers lately gets a model of who takes what; and ranking
 * takes each agent's chance of taking the offer into their score, by the share Settings, Matching give.
 */
describe('acceptance prediction', () => {
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
    await matching({ ...DEFAULT_MATCHING_SETTINGS, fakeGpsHoldHours: 0, maxBoardErrands: 10, predictionMinOffers: 40 });
    customer = await signIn(t, 'customer');
    await fund(t, customer, 100_000_000);
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
    await request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, ...at })
      .expect(200);
    return agent;
  };
  const urgent = (feeKobo = 300_000) =>
    createErrand(t, customer, {
      urgent: true,
      feeKobo,
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Agege Motor Road, Lagos', ...east(0.4) },
        { kind: 'dropoff', label: 'Home', address: 'Agege, Lagos', ...east(3) },
      ],
    });
  const offerOf = async (errandId: string) =>
    (await t.db.select().from(errandOffers).where(eq(errandOffers.errandId, errandId)))[0];
  const latestModel = async () =>
    (
      await t.db
        .select()
        .from(acceptanceModels)
        .where(and(eq(acceptanceModels.countryCode, 'NG'), eq(acceptanceModels.stateCode, 'LA')))
        .orderBy(desc(acceptanceModels.trainedAt))
        .limit(1)
    )[0];

  /** A history of answered offers in Lagos: near, well-paid ones taken, far ones turned down. */
  async function seedHistory(n: number) {
    const agents = [await signIn(t, 'agent'), await signIn(t, 'agent')];
    const errand = await createErrand(t, customer, {
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Agege Motor Road, Lagos', ...east(0.4) },
        { kind: 'dropoff', label: 'Home', address: 'Agege, Lagos', ...east(3) },
      ],
    });
    const now = Date.now();
    await t.db.insert(errandOffers).values(
      Array.from({ length: n }, (_, i) => {
        const pickupKm = (i % 8) + 0.5;
        const feeKobo = 150_000 + (i % 5) * 75_000;
        const taken = pickupKm < 4 && feeKobo >= 300_000;
        const offeredAt = new Date(now - (i + 1) * 60_000);
        return {
          errandId: errand.id,
          agentId: agents[i % 2]!.userId,
          countryCode: 'NG',
          status: taken ? ('accepted' as const) : ('declined' as const),
          feeKobo,
          rank: 1,
          score: 0.5,
          parts: {},
          travelSeconds: Math.round(pickupKm * 180),
          travelEstimated: true,
          straightMeters: Math.round(pickupKm * 1000),
          features: { pickupKm, tripKm: 3, feeKobo, acceptanceRate: null, hour: i % 24, buy: false },
          offeredAt,
          expiresAt: new Date(offeredAt.getTime() + 20_000),
          answeredAt: new Date(offeredAt.getTime() + 5_000),
        };
      }),
    );
  }

  it('keeps with each offer what it looked like to the agent', async () => {
    const agent = await agentAt(HERE);
    const errand = await urgent(350_000);
    const offer = (await offerOf(errand.id))!;
    expect(offer.agentId).toBe(agent.userId);
    expect(offer.features).toMatchObject({ feeKobo: 350_000, buy: false, acceptanceRate: null });
    expect(offer.features!.pickupKm).toBeCloseTo(0.4, 1);
    expect(offer.features!.tripKm).toBeCloseTo(2.6, 1);
    expect(offer.features!.hour).toBeGreaterThanOrEqual(0);
    expect(offer.features!.hour).toBeLessThan(24);
  });

  it('learns nightly in a state with enough answered offers, and ranks with it', async () => {
    await seedHistory(80);
    await t.jobs.run('acceptance.fit');
    const model = (await latestModel())!;
    expect(model.offers).toBeGreaterThanOrEqual(80);
    expect(model.logLoss).toBeGreaterThan(0);
    // The dashboard says so.
    const dashboard = (await request(t.http).get('/v1/admin/matching?country=NG').set(owner.headers).expect(200)).body;
    expect(dashboard.predictions).toEqual(
      expect.arrayContaining([expect.objectContaining({ stateCode: 'LA', offers: model.offers })]),
    );
    // A new offer is ranked with the chance taken in.
    await agentAt(HERE);
    const errand = await urgent();
    const parts = (await offerOf(errand.id))!.parts;
    expect(parts.prediction).toBeGreaterThan(0);
    expect(parts.prediction).toBeLessThan(1);
    expect(parts.total).toBeLessThanOrEqual(parts.beforePrediction! + 1e-9);
  });

  it('learns nothing new below the offers needed, and stops using a model gone stale', async () => {
    const before = await latestModel();
    await matching({ predictionMinOffers: 100_000 });
    try {
      await t.jobs.run('acceptance.fit');
      expect((await latestModel())?.id).toBe(before?.id);
    } finally {
      await matching({ predictionMinOffers: 40 });
    }
    // A week old: no longer used.
    if (before) {
      await t.db
        .update(acceptanceModels)
        .set({ trainedAt: new Date(Date.now() - 8 * 24 * 3_600_000) })
        .where(eq(acceptanceModels.id, before.id));
    }
    await agentAt(HERE);
    const errand = await urgent();
    expect((await offerOf(errand.id))!.parts.prediction).toBeUndefined();
  });

  it('shows a model as not in use while the share is 0, and lets go of models a month old', async () => {
    const kept = (await latestModel())!;
    const [old] = await t.db
      .insert(acceptanceModels)
      .values({
        countryCode: 'NG',
        stateCode: 'LA',
        model: kept.model,
        offers: kept.offers,
        logLoss: kept.logLoss,
        trainedAt: new Date(Date.now() - 31 * 24 * 3_600_000),
      })
      .returning();
    await t.jobs.run('acceptance.fit');
    const left = await t.db.select({ id: acceptanceModels.id }).from(acceptanceModels);
    expect(left.map((m) => m.id)).not.toContain(old!.id);
    // Last week's is kept: only those over a month old go.
    expect(left.map((m) => m.id)).toContain(kept.id);
    const lagos = async () =>
      (
        (await request(t.http).get('/v1/admin/matching?country=NG&state=LA').set(owner.headers).expect(200)).body
          .predictions as Array<{ inUse: boolean }>
      )[0];
    expect((await lagos())?.inUse).toBe(true);
    await matching({ predictionShareBps: 0 });
    try {
      expect((await lagos())?.inUse).toBe(false);
    } finally {
      await matching({ predictionShareBps: DEFAULT_MATCHING_SETTINGS.predictionShareBps });
    }
  });
});
