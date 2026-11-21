import { eq, sql } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { agentPresence } from '../src/db/schema';
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

/** Ikeja GRA, away from the other tests' errands. */
const IKEJA = { lat: 6.58, lng: 3.355 };
const east = (km: number) => ({ lat: IKEJA.lat, lng: IKEJA.lng + km / 111 });
/** Epe, seventy km off. */
const EPE = { lat: 6.585, lng: 3.98 };

/**
 * The open board (docs/matching.md, M11): errands from the board in "Best for you" order, and kept live over
 * Socket.IO for agents watching the area, so a taken errand leaves everyone's board at once.
 */
describe('the board', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let original: { settings: { matching: Record<string, unknown> } };
  let customer: Person;
  const sockets: Socket[] = [];

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
  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
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
  const errandAt = (at: { lat: number; lng: number }, feeKobo = 250_000, dropoffKm = 1) =>
    createErrand(t, customer, {
      feeKobo,
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Isaac John St, Ikeja GRA', ...at },
        { kind: 'dropoff', label: 'Home', address: 'Allen Avenue, Ikeja', lat: at.lat + dropoffKm / 111, lng: at.lng },
      ],
    });
  const board = async (agent: Person, at = IKEJA) =>
    (
      await request(t.http)
        .get(`/v1/errands/board?lat=${at.lat}&lng=${at.lng}&radiusKm=50`)
        .set(agent.headers)
        .expect(200)
    ).body as {
      errands: Array<{
        id: string;
        travelSeconds: number;
        travelEstimated: boolean;
        perKmKobo: number;
        agentEarnsKobo: number;
      }>;
    };
  function connect(person: Person): Promise<Socket> {
    const socket = io(`${t.url}/realtime`, {
      auth: { token: person.accessToken },
      transports: ['websocket'],
      forceNew: true,
    });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('ready', () => resolve(socket));
      socket.once('connect_error', reject);
    });
  }
  const watch = (socket: Socket, at: { lat: number; lng: number }) =>
    socket.emitWithAck('board.watch', at) as Promise<{ ok: boolean; error?: { code: string } }>;
  /** The board changes this socket heard of, collected as they come. */
  const heard = (socket: Socket) => {
    const got: Array<{ errandId: string; change: string }> = [];
    socket.on('board.changed', (c: { errandId: string; change: string }) => got.push(c));
    return got;
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  it('orders the board best for you: quickest to reach, then most per km, then newest', async () => {
    const agent = await agentAt(IKEJA);
    // About the same way to go: the one that pays more per km first.
    const cheap = await errandAt(east(0.3), 200_000);
    const dear = await errandAt(east(0.4), 400_000);
    // Further away, though it pays the most.
    const far = await errandAt(east(6), 900_000);
    const mine = new Set([cheap.id, dear.id, far.id]);
    const shown = (await board(agent)).errands.filter((e) => mine.has(e.id));
    expect(shown.map((e) => e.id)).toEqual([dear.id, cheap.id, far.id]);
    for (const e of shown) {
      expect(e.travelSeconds).toBeGreaterThan(0);
      expect(e.travelEstimated).toBe(true);
      expect(e.perKmKobo).toBeGreaterThan(0);
    }
  });

  it('asks the maps provider for the travel times where the settings say so', async () => {
    await matching({ boardTravelTimes: true });
    try {
      const agent = await agentAt(east(-0.5));
      const errand = await errandAt(east(-0.2));
      const shown = (await board(agent, east(-0.5))).errands.find((e) => e.id === errand.id)!;
      expect(shown.travelEstimated).toBe(false);
    } finally {
      await matching({ boardTravelTimes: false });
    }
  });

  it('tells agents watching the area at once when an errand goes on the board, and when it is taken', async () => {
    const watcher = await agentAt(IKEJA);
    const taker = await agentAt(east(0.2));
    const elsewhere = await agentAt(EPE);
    const near = await connect(watcher);
    const far = await connect(elsewhere);
    expect(await watch(near, IKEJA)).toEqual({ ok: true });
    expect(await watch(far, EPE)).toEqual({ ok: true });
    const nearHeard = heard(near);
    const farHeard = heard(far);

    const errand = await errandAt(east(0.5));
    await settle();
    expect(nearHeard).toContainEqual({ errandId: errand.id, change: 'added' });
    await act(t, taker, errand.id, 'accept');
    await settle();
    expect(nearHeard).toContainEqual({ errandId: errand.id, change: 'removed' });
    // Seventy km away: never told of it. (Those within a cell or two are, and their board leaves it out.)
    expect(farHeard.some((c) => c.errandId === errand.id)).toBe(false);
  });

  it("watches only around where the agent's phone last said they are", async () => {
    const agent = await agentAt(IKEJA);
    const socket = await connect(agent);
    expect(await watch(socket, { lat: 6.45, lng: 3.47 })).toMatchObject({ ok: false, error: { code: 'not_here' } });
    const customerSocket = await connect(customer);
    expect(await watch(customerSocket, IKEJA)).toMatchObject({ ok: false });
  });

  it('works the order out from where the stops really are, not the rounded places agents see', async () => {
    // Twenty metres apart, either side of where the places agents see are rounded to.
    const pickup = { lat: 6.5849, lng: 3.36 };
    const agent = await agentAt(pickup);
    const errand = await createErrand(t, customer, {
      stops: [
        { kind: 'pickup', label: 'Shop', address: 'Oba Akinjobi Way, Ikeja', ...pickup },
        { kind: 'dropoff', label: 'Home', address: 'Oba Akinjobi Way, Ikeja', lat: 6.5851, lng: 3.36 },
      ],
    });
    const shown = (await board(agent, pickup)).errands.find((e) => e.id === errand.id)!;
    // A trip under a km counts as one: they earn it all per km.
    expect(shown.perKmKobo).toBe(shown.agentEarnsKobo);
  });

  it('tells watchers of an urgent errand on the board where offers are off, and not of one being offered', async () => {
    const watcher = await agentAt(IKEJA);
    const socket = await connect(watcher);
    expect(await watch(socket, IKEJA)).toEqual({ ok: true });
    const got = heard(socket);
    const urgentAt = (at: { lat: number; lng: number }) =>
      createErrand(t, customer, {
        urgent: true,
        stops: [
          { kind: 'pickup', label: 'Shop', address: 'Isaac John St, Ikeja GRA', ...at },
          { kind: 'dropoff', label: 'Home', address: 'Allen Avenue, Ikeja', lat: at.lat + 0.01, lng: at.lng },
        ],
      });
    // Offered one at a time: not on the board, so nothing to say about it.
    const offered = await urgentAt(east(0.4));
    await settle();
    expect(got.some((c) => c.errandId === offered.id)).toBe(false);
    await matching({ offers: false });
    try {
      const open = await urgentAt(east(0.6));
      await settle();
      expect(got).toContainEqual({ errandId: open.id, change: 'added' });
    } finally {
      await matching({ offers: true });
    }
  });

  it('lets only an approved agent online with a recent position watch', async () => {
    const offline = await agentAt(IKEJA);
    await t.db.update(agentPresence).set({ online: false }).where(eq(agentPresence.userId, offline.userId));
    expect(await watch(await connect(offline), IKEJA)).toMatchObject({ ok: false, error: { code: 'go_online' } });

    const stale = await agentAt(IKEJA);
    await t.db
      .update(agentPresence)
      .set({ locatedAt: sql`now() - interval '1 hour'` })
      .where(eq(agentPresence.userId, stale.userId));
    expect(await watch(await connect(stale), IKEJA)).toMatchObject({ ok: false, error: { code: 'go_online' } });

    const applying = await signIn(t, 'agent', { unapproved: true });
    await t.db.insert(agentPresence).values({
      userId: applying.userId,
      countryCode: 'NG',
      online: true,
      lat: IKEJA.lat,
      lng: IKEJA.lng,
      location: sql`ST_SetSRID(ST_MakePoint(${IKEJA.lng}, ${IKEJA.lat}), 4326)::geography`,
      locatedAt: new Date(),
    });
    expect(await watch(await connect(applying), IKEJA)).toMatchObject({
      ok: false,
      error: { code: 'application_pending' },
    });
  });
});
