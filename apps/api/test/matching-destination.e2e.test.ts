import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { agentDestinations, agentPresence, errandOffers, errands } from '../src/db/schema';
import { DestinationService } from '../src/agents/destination.service';
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

/** Ojo, away from the other tests' errands. */
const HERE = { lat: 6.45, lng: 3.1 };
const east = (km: number) => ({ lat: HERE.lat, lng: HERE.lng + km / 110 });
const north = (from: { lat: number; lng: number }, km: number) => ({ lat: from.lat + km / 111, lng: from.lng });

/**
 * Destination mode (docs/matching.md, M13), as Uber's and Bolt's: an agent sets where they are heading, such as
 * home, up to twice a day, and gets only errands whose drop-off brings them closer: offered, on the board and
 * accepted. It ends when they get there or clear it.
 */
describe('destination mode', () => {
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
    // As the other test files have it: agents moved in an instant aren't held for faked GPS, and may hold many.
    await matching({ ...DEFAULT_MATCHING_SETTINGS, fakeGpsHoldHours: 0, maxBoardErrands: 10 });
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
  const errandTo = (dropoff: { lat: number; lng: number }, urgent = false) =>
    createErrand(t, customer, {
      urgent,
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Ojo Road, Lagos', ...east(0.3) },
        { kind: 'dropoff', label: 'Home', address: 'Lagos', ...dropoff },
      ],
    });
  const board = async (agent: Person) =>
    (
      (
        await request(t.http)
          .get(`/v1/errands/board?lat=${HERE.lat}&lng=${HERE.lng}&radiusKm=50`)
          .set(agent.headers)
          .expect(200)
      ).body.errands as Array<{ id: string }>
    ).map((e) => e.id);
  const destination = (agent: Person) => request(t.http).get('/v1/agent/destination').set(agent.headers).expect(200);
  const setDestination = (agent: Person, at: { lat: number; lng: number }, label = 'Home') =>
    request(t.http)
      .put('/v1/agent/destination')
      .set(agent.headers)
      .send({ ...at, label });
  const offersFor = (errandId: string) => t.db.select().from(errandOffers).where(eq(errandOffers.errandId, errandId));

  it('keeps an agent to errands whose drop-off brings them closer to where they are heading', async () => {
    const agent = await agentAt(HERE);
    // Heading 10 km east.
    const home = east(10);
    expect((await destination(agent)).body).toMatchObject({ destination: null, usesLeft: 2, usesPerDay: 2 });
    const set = await setDestination(agent, home);
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    expect(set.body).toMatchObject({ destination: { label: 'Home', ...home }, usesLeft: 1 });

    const towards = await errandTo(east(5));
    const away = await errandTo(north(HERE, -3));
    const shown = await board(agent);
    expect(shown).toContain(towards.id);
    expect(shown).not.toContain(away.id);
    const refused = await request(t.http)
      .post(`/v1/errands/${away.id}/events`)
      .set(agent.headers)
      .send({ event: 'accept' });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('off_route');
    // Offers too: one urgent errand the other way isn't offered to them, one their way is.
    const urgentAway = await errandTo(north(HERE, -3), true);
    expect(await offersFor(urgentAway.id)).toHaveLength(0);
    const urgentTowards = await errandTo(east(6), true);
    expect((await offersFor(urgentTowards.id))[0]?.agentId).toBe(agent.userId);

    // Cleared: every errand again.
    await request(t.http).delete('/v1/agent/destination').set(agent.headers).expect(200);
    expect(await board(agent)).toContain(away.id);
    await act(t, agent, away.id, 'accept');
  });

  it('may be set twice a day, and ends once the agent gets there', async () => {
    const agent = await agentAt(HERE);
    expect((await setDestination(agent, east(8))).status).toBe(200);
    // Changed: the second of the day.
    const second = await setDestination(agent, east(9), 'Mum');
    expect(second.body).toMatchObject({ destination: { label: 'Mum' }, usesLeft: 0 });
    const third = await setDestination(agent, east(7));
    expect(third.status).toBe(409);
    expect(third.body.error.code).toBe('destination_limit');
    // Within a km of it: there, and it ends.
    await request(t.http).put('/v1/agent/presence').set(agent.headers).send(east(8.5)).expect(200);
    expect((await destination(agent)).body).toMatchObject({ destination: null, usesLeft: 0 });
    // Already there: nothing to head for.
    const here = await agentAt(east(3));
    const there = await setDestination(here, east(3.5));
    expect(there.status).toBe(422);
    expect(there.body.error.code).toBe('destination_here');
  });

  it('is off where admin switches it off, and then keeps no one from an errand', async () => {
    const agent = await agentAt(HERE);
    expect((await setDestination(agent, east(10))).status).toBe(200);
    const away = await errandTo(north(HERE, -3));
    expect(await board(agent)).not.toContain(away.id);
    await matching({ destinationMode: false });
    try {
      expect(await board(agent)).toContain(away.id);
      const refused = await setDestination(agent, east(9));
      expect(refused.status).toBe(409);
      expect(refused.body.error.code).toBe('destination_off');
    } finally {
      await matching({ destinationMode: true });
    }
  });

  it('is for agents alone', async () => {
    await request(t.http).get('/v1/agent/destination').set(customer.headers).expect(403);
  });

  it("holds to the day's limit when two are set at once, leaving one open", async () => {
    const agent = await agentAt(HERE);
    expect((await setDestination(agent, east(8))).status).toBe(200);
    const both = await Promise.all([setDestination(agent, east(9), 'A'), setDestination(agent, east(7), 'B')]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    const open = (
      await t.db.select().from(agentDestinations).where(eq(agentDestinations.agentId, agent.userId))
    ).filter((d) => !d.endedAt);
    expect(open).toHaveLength(1);
  });

  it('keeps a destination just set when a report about the one before arrives late', async () => {
    const agent = await agentAt(HERE);
    expect((await setDestination(agent, east(8))).status).toBe(200);
    const [before] = await t.db.select().from(agentPresence).where(eq(agentPresence.userId, agent.userId));
    expect((await setDestination(agent, east(12), 'Work')).status).toBe(200);
    // The report read the first, at it, before the second was set.
    await t.app.get(DestinationService).arrivedIfThere(agent.userId, east(8), {
      lat: before!.destinationLat!,
      lng: before!.destinationLng!,
      setAt: before!.destinationSetAt!,
    });
    expect((await destination(agent)).body).toMatchObject({ destination: { label: 'Work' } });
  });

  it("lasts the day it was set: yesterday's keeps no one from an errand today", async () => {
    const agent = await agentAt(HERE);
    expect((await setDestination(agent, east(10))).status).toBe(200);
    const away = await errandTo(north(HERE, -3));
    expect(await board(agent)).not.toContain(away.id);
    await t.db
      .update(agentPresence)
      .set({ destinationSetAt: new Date(Date.now() - 2 * 24 * 3_600_000) })
      .where(eq(agentPresence.userId, agent.userId));
    expect(await board(agent)).toContain(away.id);
    expect((await destination(agent)).body).toMatchObject({ destination: null });
  });
});
