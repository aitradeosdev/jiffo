import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentPresence, errandTrail, errands, riskFlagErrands, riskFlags } from '../src/db/schema';
import { RiskFlagsService } from '../src/risk/risk-flags.service';
import { TrailService } from '../src/agents/trail.service';
import {
  act,
  adminAs,
  createErrand,
  createTestApp,
  fund,
  LAGOS_STOPS,
  signIn,
  type Person,
  type TestApp,
} from './helpers';

interface Flag {
  id: string;
  kind: string;
  people: Array<{ id: string }>;
  details: Record<string, unknown>;
}

/**
 * The agent's trail on an errand (docs/security-plan.md, G1, G3, G4, E6): kept while they are out on it,
 * checked for impossible jumps and for the perfectly straight, even runs a route-faking app makes, and for an
 * agent who never left one spot; deleted after 90 days unless a dispute or a flag is open.
 */
describe('the GPS trail', () => {
  let t: TestApp;
  let ops: Awaited<ReturnType<typeof adminAs>>;
  beforeAll(async () => {
    t = await createTestApp();
    ops = await adminAs(t, 'operations');
  });
  afterAll(() => t.close());

  const north = (metres: number) => metres / 111_195;
  const pickup = LAGOS_STOPS[0]!;
  const dropoff = LAGOS_STOPS[1]!;
  const flagsFor = async (filter: { person?: string; errand?: string }) => {
    await t.app.get(RiskFlagsService).settled();
    const query = new URLSearchParams({ country: 'NG', queue: 'risk', status: 'open', limit: '100' });
    if (filter.person) query.set('person', filter.person);
    if (filter.errand) query.set('errand', filter.errand);
    return (await request(t.http).get(`/v1/admin/flags?${query}`).set(ops.headers).expect(200)).body.flags as Flag[];
  };
  const report = (agent: Person, place: { lat: number; lng: number }, extra: Record<string, unknown> = {}) =>
    request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ lat: place.lat, lng: place.lng, ...extra })
      .expect(200);
  /** The agent's last position, as if reported that many seconds ago. */
  const lastReportedAgo = (agent: Person, seconds: number) =>
    t.db
      .update(agentPresence)
      .set({ locatedAt: sql`now() - make_interval(secs => ${seconds})` })
      .where(eq(agentPresence.userId, agent.userId));
  const trailOf = (errandId: string) =>
    t.db.select().from(errandTrail).where(eq(errandTrail.errandId, errandId)).orderBy(errandTrail.at);
  const onErrand = async () => {
    const customer = await signIn(t, 'customer');
    const agent = await signIn(t, 'agent');
    await fund(t, customer);
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    return { customer, agent, errand };
  };
  /** Points the agent's phone sent, put straight into the trail with their times, minutes ago. */
  const sent = (errandId: string, agentId: string, points: Array<{ lat: number; lng: number; minutesAgo: number }>) =>
    t.db.insert(errandTrail).values(
      points.map((p) => ({
        errandId,
        agentId,
        lat: p.lat,
        lng: p.lng,
        mocked: false,
        at: new Date(Date.now() - p.minutesAgo * 60_000),
      })),
    );
  const finish = async (customer: Person, agent: Person, errandId: string) => {
    await act(t, agent, errandId, 'start');
    await act(t, agent, errandId, 'mark_delivered');
    const pin = (await request(t.http).get(`/v1/errands/${errandId}/pin`).set(customer.headers).expect(200)).body.pin;
    await act(t, agent, errandId, 'confirm_pin', { pin });
  };

  it('keeps where the agent was for each errand they are out on, and nothing while they are only online', async () => {
    const agent = await signIn(t, 'agent');
    await report(agent, pickup, { online: true });
    const customer = await signIn(t, 'customer');
    await fund(t, customer);
    const errand = await createErrand(t, customer);
    expect(await trailOf(errand.id)).toEqual([]);
    await act(t, agent, errand.id, 'accept');
    await report(agent, pickup);
    await report(agent, { lat: pickup.lat + north(300), lng: pickup.lng }, { mocked: true });
    const trail = await trailOf(errand.id);
    expect(trail.map((p) => ({ agentId: p.agentId, mocked: p.mocked }))).toEqual([
      { agentId: agent.userId, mocked: false },
      { agentId: agent.userId, mocked: true },
    ]);
  });

  it("flags an impossible jump in an agent's position, on an errand or just online", async () => {
    const { agent, errand } = await onErrand();
    await report(agent, pickup);
    await lastReportedAgo(agent, 10);
    // 20 km in ten seconds.
    await report(agent, { lat: pickup.lat + north(20_000), lng: pickup.lng });
    const [flag] = await flagsFor({ errand: errand.id });
    expect(flag).toMatchObject({ kind: 'gps_jump' });
    expect(flag!.details.kmh).toBeGreaterThan(1_000);

    const idle = await signIn(t, 'agent');
    await report(idle, pickup, { online: true });
    await lastReportedAgo(idle, 10);
    await report(idle, { lat: pickup.lat + north(20_000), lng: pickup.lng });
    expect((await flagsFor({ person: idle.userId })).map((f) => f.kind)).toEqual(['gps_jump']);
  });

  it("leaves a phone's GPS noise and a fast drive alone", async () => {
    const { agent, errand } = await onErrand();
    await report(agent, pickup);
    await lastReportedAgo(agent, 10);
    await report(agent, { lat: pickup.lat + north(500), lng: pickup.lng });
    await lastReportedAgo(agent, 600);
    await report(agent, { lat: pickup.lat + north(5_500), lng: pickup.lng });
    expect(await flagsFor({ errand: errand.id })).toEqual([]);
  });

  it('flags an errand finished with the agent never leaving one spot, far from the pickup', async () => {
    const { customer, agent, errand } = await onErrand();
    // Twenty minutes at the drop-off, never at the pickup 6 km away.
    await sent(
      errand.id,
      agent.userId,
      [20, 15, 10, 5].map((minutesAgo, i) => ({ lat: dropoff.lat + north(i * 10), lng: dropoff.lng, minutesAgo })),
    );
    await finish(customer, agent, errand.id);
    const flags = await flagsFor({ errand: errand.id });
    expect(flags.map((f) => f.kind)).toEqual(['no_movement']);
    expect(flags[0]!.details).toMatchObject({ points: expect.any(Number), metres: expect.any(Number) });
  });

  it('flags a perfectly straight, even run, as a route-faking app makes', async () => {
    const { customer, agent, errand } = await onErrand();
    await sent(
      errand.id,
      agent.userId,
      Array.from({ length: 10 }, (_, i) => ({
        lat: pickup.lat - north(i * 90),
        lng: pickup.lng,
        minutesAgo: 10 - i / 6,
      })),
    );
    await finish(customer, agent, errand.id);
    expect((await flagsFor({ errand: errand.id })).map((f) => f.kind)).toEqual(['gps_straight']);
  });

  it("doesn't flag an ordinary trip", async () => {
    const { customer, agent, errand } = await onErrand();
    const jitter = [0, 7, -4, 9, -6, 3, -8, 5, -3, 6];
    await sent(
      errand.id,
      agent.userId,
      Array.from({ length: 10 }, (_, i) => ({
        lat: pickup.lat + (dropoff.lat - pickup.lat) * (i / 9) + north(jitter[i]!),
        lng: pickup.lng + (dropoff.lng - pickup.lng) * (i / 9),
        minutesAgo: 30 - i * 3,
      })),
    );
    await finish(customer, agent, errand.id);
    expect(await flagsFor({ errand: errand.id })).toEqual([]);
  });

  it('deletes trails after 90 days, unless a dispute or a flag is still open', async () => {
    const old = async () => {
      const { agent, errand } = await onErrand();
      await sent(errand.id, agent.userId, [{ ...pickup, minutesAgo: 91 * 24 * 60 }]);
      return errand.id;
    };
    const [plain, disputed, flagged, cleared] = await Promise.all([old(), old(), old(), old()]);
    await t.db.update(errands).set({ status: 'disputed' }).where(eq(errands.id, disputed));
    for (const [errandId, status] of [
      [flagged, 'open'],
      [cleared, 'cleared'],
    ] as const) {
      const [flag] = await t.db
        .insert(riskFlags)
        .values({
          countryCode: 'NG',
          queue: 'risk',
          kind: 'gps_jump',
          dedupeKey: errandId,
          userId: (await customerOf(errandId))!,
          status,
        })
        .returning({ id: riskFlags.id });
      await t.db.insert(riskFlagErrands).values({ flagId: flag!.id, errandId });
    }
    await t.app.get(TrailService).prune();
    const left = async (errandId: string) =>
      (
        await t.db
          .select()
          .from(errandTrail)
          .where(and(eq(errandTrail.errandId, errandId), sql`at < now() - interval '90 days'`))
      ).length;
    expect(await left(plain)).toBe(0);
    expect(await left(cleared)).toBe(0);
    expect(await left(disputed)).toBe(1);
    expect(await left(flagged)).toBe(1);
  });
  const customerOf = async (errandId: string) =>
    (await t.db.select({ id: errands.customerId }).from(errands).where(eq(errands.id, errandId)))[0]?.id;
});
