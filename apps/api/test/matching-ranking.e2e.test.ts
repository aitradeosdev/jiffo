import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { agentPresence, agentProfiles } from '../src/db/schema';
import { RankingService } from '../src/matching/ranking.service';
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

/** Ojo, away from the other tests' agents. */
const OJO = { lat: 6.4626, lng: 3.1806 };
const near = { lat: OJO.lat, lng: OJO.lng + 2 / 111 };

/**
 * Who is offered an errand first (docs/matching.md, M4): each candidate's score from their travel time,
 * reliability, rating and wait, from their own history, weighted as Settings, Matching say.
 */
describe('ranking candidates', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let original: { settings: { matching: Record<string, unknown> } };
  let customer: Person;
  let ranking: RankingService;
  let veteran: Person, weak: Person, quitter: Person, newbie: Person;

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

  /** An errand the agent finishes, and the customer rates. */
  const done = async (agent: Person, stars: number) => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'mark_delivered');
    const pin = (await request(t.http).get(`/v1/errands/${errand.id}/pin`).set(customer.headers).expect(200)).body.pin;
    await act(t, agent, errand.id, 'confirm_pin', { pin });
    await request(t.http).post(`/v1/errands/${errand.id}/rating`).set(customer.headers).send({ stars }).expect(201);
  };
  const online = (agent: Person) =>
    request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, ...near })
      .expect(200);
  const errandAtOjo = () =>
    createErrand(t, customer, {
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Old Ojo Road, Lagos', ...OJO },
        { kind: 'dropoff', label: 'Home', address: 'Alaba, Lagos', lat: OJO.lat + 0.01, lng: OJO.lng },
      ],
    });
  const rankedAtOjo = async () => {
    const mine = new Map([veteran, weak, quitter, newbie].map((a) => [a.userId, a]));
    return (await ranking.ranked((await errandAtOjo()).id)).filter((r) => mine.has(r.agentId));
  };
  const of = (list: Awaited<ReturnType<typeof rankedAtOjo>>, agent: Person) =>
    list.find((r) => r.agentId === agent.userId)!;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    await matching({ ...DEFAULT_MATCHING_SETTINGS, newAgentErrands: 2 });
    customer = await signIn(t, 'customer');
    await fund(t, customer, 50_000_000);
    ranking = t.app.get(RankingService);
    veteran = await signIn(t, 'agent');
    weak = await signIn(t, 'agent');
    quitter = await signIn(t, 'agent');
    newbie = await signIn(t, 'agent');
    for (const agent of [veteran, weak, quitter]) {
      for (let i = 0; i < 2; i++) await done(agent, agent === weak ? 1 : 5);
    }
    // The quitter also left an errand after accepting it, this week.
    const left = await createErrand(t, customer);
    await act(t, quitter, left.id, 'accept');
    await act(t, quitter, left.id, 'withdraw');
    for (const agent of [veteran, weak, quitter, newbie]) await online(agent);
  });
  afterAll(async () => {
    await matching(original.settings.matching);
    await t.close();
  });

  it("scores each agent's own history, and new agents by the state's average", async () => {
    const ranked = await rankedAtOjo();
    expect(of(ranked, veteran).parts).toMatchObject({ reliability: 1, rating: 1 });
    expect(of(ranked, weak).parts).toMatchObject({ reliability: 1, rating: 0 });
    // Three accepted, one left: two thirds, less 0.1 for leaving it this week.
    expect(of(ranked, quitter).parts.reliability).toBeCloseTo(2 / 3 - 0.1);
    const average = await ranking.stateAverages('NG', 'LA');
    expect(of(ranked, newbie).parts.reliability).toBeCloseTo(average.reliability);
    expect(of(ranked, newbie).parts.rating).toBeCloseTo(Math.min(1, Math.max(0, (average.ratingStars - 3) / 2)));
    // The same place, so the same travel time: the well-rated, reliable agent comes first.
    expect(ranked[0]!.agentId).toBe(veteran.userId);
    expect(ranked.map((r) => r.score)).toEqual([...ranked.map((r) => r.score)].sort((a, b) => b - a));
  });

  it('favours the agent who has waited longest when the settings weigh only that', async () => {
    await t.db
      .update(agentPresence)
      .set({ onlineSince: new Date(Date.now() - 2 * 3_600_000) })
      .where(eq(agentPresence.userId, newbie.userId));
    await matching({ weights: { travel: 0, reliability: 0, rating: 0, waiting: 100 } });
    try {
      const ranked = await rankedAtOjo();
      expect(ranked[0]!.agentId).toBe(newbie.userId);
      expect(of(ranked, newbie).parts.waiting).toBe(1);
      // The others finished an errand moments ago.
      expect(of(ranked, veteran).parts.waiting).toBeLessThan(0.1);
    } finally {
      await matching({ weights: DEFAULT_MATCHING_SETTINGS.weights });
    }
  });

  it("adds the tier's boost on top of the score", async () => {
    await t.db
      .insert(agentProfiles)
      .values({ userId: weak.userId, tier: 'gold' })
      .onConflictDoUpdate({ target: agentProfiles.userId, set: { tier: 'gold' } });
    const before = of(await rankedAtOjo(), weak);
    await matching({ tierBoosts: { ...DEFAULT_MATCHING_SETTINGS.tierBoosts, gold: 20 } });
    try {
      const after = of(await rankedAtOjo(), weak);
      expect(after.parts.boost).toBeCloseTo(0.2);
      expect(after.score - before.score).toBeCloseTo(0.2, 1);
    } finally {
      await matching({ tierBoosts: DEFAULT_MATCHING_SETTINGS.tierBoosts });
    }
  });

  it('refuses ranking weights that do not add up to 100%', async () => {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    settings.matching.weights = { travel: 70, reliability: 20, rating: 10, waiting: 10 };
    const res = await request(t.http)
      .post('/v1/admin/settings?country=NG')
      .set(owner.headers)
      .send({ basedOn: now.version, settings, note: 'Weights that add up wrong' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('must add up to 100%');
  });
});
