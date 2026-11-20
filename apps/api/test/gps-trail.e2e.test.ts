import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => {
    vi.restoreAllMocks();
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

  it('judges a move by when the phone took each fix, and by how sure it was of them', async () => {
    const { agent, errand } = await onErrand();
    // Sent a moment apart, but taken nine minutes apart: 20 km at 133 km/h.
    const taken = Date.now() - 540_000;
    await report(agent, pickup, { fixedAt: taken });
    await report(agent, { lat: pickup.lat + north(20_000), lng: pickup.lng }, { fixedAt: taken + 540_000 });
    // A cell tower's fix, off by a kilometre and a half, then a GPS one ten seconds later.
    await lastReportedAgo(agent, 10);
    await report(agent, { lat: pickup.lat + north(21_400), lng: pickup.lng }, { accuracy: 1_500 });
    await lastReportedAgo(agent, 10);
    await report(agent, { lat: pickup.lat + north(20_000), lng: pickup.lng }, { accuracy: 8 });
    expect(await flagsFor({ errand: errand.id })).toEqual([]);
    const [kept] = await trailOf(errand.id);
    expect(kept).toMatchObject({ fixedAt: new Date(taken), accuracy: null });
    // A fix the phone says it took an hour ago isn't believed: its clock is wrong, or the fix is stale.
    await report(agent, { lat: pickup.lat + north(20_000), lng: pickup.lng }, { fixedAt: Date.now() - 3_600_000 });
    expect((await trailOf(errand.id)).at(-1)).toMatchObject({ fixedAt: null });
  });

  it("keeps positions only for the errands that follow the agent now, and a failed write doesn't fail the report", async () => {
    const customer = await signIn(t, 'customer');
    const agent = await signIn(t, 'agent');
    await fund(t, customer, 5_000_000);
    const first = await createErrand(t, customer);
    const second = await createErrand(t, customer);
    await act(t, agent, first.id, 'accept');
    await act(t, agent, second.id, 'accept');
    await act(t, agent, first.id, 'start');
    await report(agent, pickup);
    // Under way on the first, the second's customer doesn't follow them, and nothing is kept for it.
    expect((await trailOf(first.id)).length).toBe(1);
    expect(await trailOf(second.id)).toEqual([]);

    const failing = vi.spyOn(t.app.get(TrailService), 'record').mockRejectedValueOnce(new Error('database away'));
    await report(agent, pickup);
    expect(failing).toHaveBeenCalled();
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

  /** The errand as accepted that many minutes ago. */
  const acceptedAgo = (errandId: string, minutes: number) =>
    t.db
      .update(errands)
      .set({ acceptedAt: sql`now() - make_interval(mins => ${minutes})` })
      .where(eq(errands.id, errandId));
  /** A position a minute, from `from` minutes ago to a minute ago. */
  const everyMinute = (from: number, place: (i: number) => { lat: number; lng: number }) =>
    Array.from({ length: from }, (_, i) => ({ ...place(i), minutesAgo: from - i }));

  it('flags an errand finished with the agent never leaving one spot, far from the pickup', async () => {
    const { customer, agent, errand } = await onErrand();
    // Twenty minutes at the drop-off, never at the pickup 6 km away.
    await acceptedAgo(errand.id, 21);
    await sent(
      errand.id,
      agent.userId,
      everyMinute(20, (i) => ({ lat: dropoff.lat + north((i % 3) * 10), lng: dropoff.lng })),
    );
    await finish(customer, agent, errand.id);
    const flags = await flagsFor({ errand: errand.id });
    expect(flags.map((f) => f.kind)).toEqual(['no_movement']);
    expect(flags[0]!.details).toMatchObject({ points: expect.any(Number), metres: expect.any(Number) });
  });

  it("can't say an agent never moved when positions stopped coming, or from another agent's", async () => {
    const { customer, agent, errand } = await onErrand();
    // Positions at the drop-off at the start and the end only: the agent may have gone without the app.
    await acceptedAgo(errand.id, 21);
    await sent(
      errand.id,
      agent.userId,
      [20, 19, 18, 3, 2, 1].map((minutesAgo) => ({ ...dropoff, minutesAgo })),
    );
    await finish(customer, agent, errand.id);
    expect(await flagsFor({ errand: errand.id })).toEqual([]);

    // An agent who waited at the drop-off and gave the errand back: the next agent isn't judged by it.
    const next = await onErrand();
    const before = await signIn(t, 'agent');
    await acceptedAgo(next.errand.id, 21);
    await sent(
      next.errand.id,
      before.userId,
      everyMinute(20, () => dropoff),
    );
    await finish(next.customer, next.agent, next.errand.id);
    expect(await flagsFor({ errand: next.errand.id })).toEqual([]);
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
