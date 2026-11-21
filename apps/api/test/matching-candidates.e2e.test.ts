import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { haversineMeters, MAPS, type MapsAdapter } from '../src/adapters/maps';
import { agentPresence } from '../src/db/schema';
import { AgentLocations } from '../src/matching/agent-locations';
import { CandidatesService } from '../src/matching/candidates.service';
import { adminAs, approved, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

/** Epe and Badagry, far from the other tests' agents around Lekki. */
const EPE = { lat: 6.5841, lng: 3.9834 };
const BADAGRY = { lat: 6.4153, lng: 2.8813 };
/** A point about `km` east of `from`. */
const east = (from: { lat: number; lng: number }, km: number) => ({ lat: from.lat, lng: from.lng + km / 111 });

const stopsAt = (at: { lat: number; lng: number }) => [
  { kind: 'pickup', label: 'Shop', address: 'Market Road, Lagos', ...at },
  { kind: 'dropoff', label: 'Home', address: 'Church Street, Lagos', lat: at.lat + 0.01, lng: at.lng },
];

/**
 * Who could be offered an errand (docs/matching.md, M2 and M3): the agents nearest its pickup from their live
 * positions in Redis, each checked again in the database, with their road travel time from the maps provider.
 */
describe('candidates for an errand', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let original: { settings: { matching: Record<string, number> } };
  let customer: Person;
  let candidates: CandidatesService;

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    customer = await signIn(t, 'customer');
    await fund(t, customer, 50_000_000);
    candidates = t.app.get(CandidatesService);
    await matching(DEFAULT_MATCHING_SETTINGS);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await matching(original.settings.matching);
    await t.close();
  });

  async function matching(changes: Record<string, number>) {
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

  const report = (agent: Person, body: Record<string, unknown>) =>
    request(t.http).put('/v1/agent/presence').set(agent.headers).send(body).expect(200);
  const agentAt = async (at: { lat: number; lng: number }) => {
    const agent = await signIn(t, 'agent');
    await report(agent, { online: true, ...at });
    return agent;
  };
  const errandAt = (at: { lat: number; lng: number }) => createErrand(t, customer, { stops: stopsAt(at) });
  const ids = (found: Array<{ agentId: string }>, mine: Person[]) => {
    const wanted = new Set(mine.map((a) => a.userId));
    return found.filter((c) => wanted.has(c.agentId)).map((c) => c.agentId);
  };

  it('finds the agents online near the pickup from their live positions, nearest by road first', async () => {
    const [near, mid, farther] = [
      await agentAt(east(EPE, 1)),
      await agentAt(east(EPE, 3)),
      await agentAt(east(EPE, 6)),
    ];
    const tooFar = await agentAt(east(EPE, 15));
    const offline = await agentAt(east(EPE, 2));
    await report(offline, { online: false });
    const mocked = await agentAt(east(EPE, 2));
    await report(mocked, { ...east(EPE, 2), mocked: true });

    const errand = await errandAt(EPE);
    const found = await candidates.forErrand(errand.id);
    expect(ids(found, [near, mid, farther, tooFar, offline, mocked])).toEqual([
      near.userId,
      mid.userId,
      farther.userId,
    ]);
    const mine = found.filter((c) => [near, mid, farther].some((a) => a.userId === c.agentId));
    expect(mine.map((c) => c.travel.estimated)).toEqual([false, false, false]);
    expect(mine[0]!.travel.durationSeconds).toBeLessThan(mine[1]!.travel.durationSeconds);
    expect(mine[0]!.straightMeters).toBeGreaterThan(900);
    expect(mine[0]!.straightMeters).toBeLessThan(1_100);
  });

  it('checks each agent again in the database: a live position alone gets no one an errand', async () => {
    const able = await agentAt(east(EPE, 1.5));
    const choosy = await agentAt(east(EPE, 1.5));
    await request(t.http)
      .patch('/v1/agent/profile')
      .set(choosy.headers)
      .send({ categoryKeys: ['groceries'] })
      .expect(200);
    const stale = await agentAt(east(EPE, 1.5));
    // Redis still has them; the database says their position is three minutes old.
    await t.db
      .update(agentPresence)
      .set({ locatedAt: new Date(Date.now() - 3 * 60_000) })
      .where(eq(agentPresence.userId, stale.userId));
    const errand = await errandAt(EPE);
    expect(ids(await candidates.forErrand(errand.id), [able, choosy, stale])).toEqual([able.userId]);
  });

  it('asks the maps provider about the nearest agents only, as many as the settings say', async () => {
    const agents: Person[] = [];
    for (let km = 1; km <= 7; km++) agents.push(await agentAt(east(BADAGRY, km)));
    const errand = await errandAt(BADAGRY);
    await matching({ shortlistSize: 4 });
    try {
      const maps = t.app.get<MapsAdapter>(MAPS);
      const asked = vi.spyOn(maps, 'travelTimes');
      const found = await candidates.forErrand(errand.id);
      expect(found.map((c) => c.agentId)).toEqual(agents.slice(0, 4).map((a) => a.userId));
      expect(asked).toHaveBeenCalledTimes(1);
      expect(asked.mock.calls[0]![0]).toHaveLength(4);
    } finally {
      await matching({ shortlistSize: DEFAULT_MATCHING_SETTINGS.shortlistSize });
    }
  });

  it('remembers travel times for a minute, so the same agents and pickup are asked about once', async () => {
    const agent = await agentAt(east(EPE, 2.5));
    const errand = await errandAt(EPE);
    const maps = t.app.get<MapsAdapter>(MAPS);
    const asked = vi.spyOn(maps, 'travelTimes');
    const first = await candidates.forErrand(errand.id);
    const calls = asked.mock.calls.length;
    const again = await candidates.forErrand(errand.id);
    expect(asked.mock.calls.length).toBe(calls);
    const of = (list: typeof first) => list.find((c) => c.agentId === agent.userId)!.travel;
    expect(of(again)).toEqual(of(first));
  });

  it("estimates when the maps provider fails, at the settings' speed, and says so", async () => {
    const agent = await agentAt(east(EPE, 4.5));
    const errand = await errandAt(EPE);
    vi.spyOn(t.app.get<MapsAdapter>(MAPS), 'travelTimes').mockRejectedValue(new Error('quota'));
    const mine = (await candidates.forErrand(errand.id)).find((c) => c.agentId === agent.userId)!;
    expect(mine.travel.estimated).toBe(true);
    const roads = mine.straightMeters * 1.3;
    expect(mine.travel.distanceMeters).toBe(Math.round(roads));
    expect(mine.travel.durationSeconds).toBe(Math.round(roads / (DEFAULT_MATCHING_SETTINGS.fallbackSpeedKmh / 3.6)));
  });

  it('estimates only the agents the maps provider found no route for', async () => {
    const [routed, unrouted] = [await agentAt(east(BADAGRY, 0.5)), await agentAt(east(BADAGRY, 0.6))];
    const errand = await errandAt(BADAGRY);
    vi.spyOn(t.app.get<MapsAdapter>(MAPS), 'travelTimes').mockImplementation(async (origins) =>
      origins.map((o, i) => (i === 1 ? null : { distanceMeters: 700, durationSeconds: 120 + i })),
    );
    const found = await candidates.forErrand(errand.id);
    const of = (a: Person) => found.find((c) => c.agentId === a.userId)!.travel;
    expect(of(routed).estimated).toBe(false);
    expect(of(unrouted).estimated).toBe(true);
  });

  it('reads the database when Redis has no answer, and still checks every agent', async () => {
    const able = await agentAt(east(EPE, 3.5));
    const choosy = await agentAt(east(EPE, 3.5));
    await request(t.http)
      .patch('/v1/agent/profile')
      .set(choosy.headers)
      .send({ categoryKeys: ['groceries'] })
      .expect(200);
    const errand = await errandAt(EPE);
    vi.spyOn(t.app.get(AgentLocations), 'near').mockRejectedValue(new Error('Redis is down'));
    expect(ids(await candidates.forErrand(errand.id), [able, choosy])).toEqual([able.userId]);
  });

  describe('live positions', () => {
    const locations = () => t.app.get(AgentLocations);
    const nearIds = async (at: { lat: number; lng: number }) =>
      (await locations().near('NG', at, 2, 50, DEFAULT_MATCHING_SETTINGS.locationFreshMinutes)).map((n) => n.agentId);
    /** A town of its own, so no other test's agents are there. */
    const IKORODU = { lat: 6.6194, lng: 3.5105 };

    it("follow the agent's phone: added online, moved, and dropped offline or when mocked", async () => {
      const agent = await agentAt(IKORODU);
      expect(await nearIds(IKORODU)).toContain(agent.userId);
      await report(agent, east(IKORODU, 0.5));
      const [here] = (await locations().near('NG', IKORODU, 2, 50, 2)).filter((n) => n.agentId === agent.userId);
      expect(haversineMeters(here!, east(IKORODU, 0.5))).toBeLessThan(5);
      await report(agent, { ...IKORODU, mocked: true });
      expect(await nearIds(IKORODU)).not.toContain(agent.userId);
      await report(agent, { online: true, ...IKORODU });
      expect(await nearIds(IKORODU)).toContain(agent.userId);
      await report(agent, { online: false });
      expect(await nearIds(IKORODU)).not.toContain(agent.userId);
    });

    it('are never kept for an agent the presence sweep forgets', async () => {
      const agent = await agentAt(east(IKORODU, 1));
      await t.db
        .update(agentPresence)
        .set({ locatedAt: new Date(Date.now() - 31 * 60_000) })
        .where(eq(agentPresence.userId, agent.userId));
      const { PresenceService } = await import('../src/agents/presence.service');
      await t.app.get(PresenceService).sweep();
      expect(await nearIds(IKORODU)).not.toContain(agent.userId);
    });
  });
});
