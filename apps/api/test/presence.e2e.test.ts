import { eq } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentPresence } from '../src/db/schema';
import { act, balanceOf, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

describe('agent presence and live location', () => {
  let t: TestApp;
  let customer: Person;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    customer = await signIn(t, 'customer');
    await fund(t, customer, 20_000_000);
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await t.close();
  });

  const put = (person: Person, body: Record<string, unknown>, status = 200) =>
    request(t.http).put('/v1/agent/presence').set(person.headers).send(body).expect(status);
  const view = async (person: Person, id: string) =>
    (await request(t.http).get(`/v1/errands/${id}`).set(person.headers).expect(200)).body;
  const pin = async (id: string) =>
    (await request(t.http).get(`/v1/errands/${id}/pin`).set(customer.headers).expect(200)).body.pin as string;
  const presenceOf = async (agent: Person) =>
    (await t.db.select().from(agentPresence).where(eq(agentPresence.userId, agent.userId)))[0];

  it('counts online agents near the pickup while matching, never saying who or where', async () => {
    const [near, far] = await Promise.all([signIn(t, 'agent'), signIn(t, 'agent')]);
    const errand = await createErrand(t, customer);
    const count = async () => (await view(customer, errand.id)).nearbyAgents;
    const before = (await count()).count;

    await put(near, { online: true, lat: 6.448, lng: 3.47 });
    await put(far, { online: true, lat: 9.0765, lng: 7.3986 }); // Abuja
    expect(await count()).toEqual({ count: before + 1, radiusKm: 3 });
    expect((await request(t.http).get('/v1/agent/presence').set(near.headers).expect(200)).body).toEqual({
      online: true,
      onErrand: false,
    });

    // Going offline with nothing running stops counting and forgets where the agent was.
    await put(near, { online: false });
    expect((await count()).count).toBe(before);
    expect(await presenceOf(near)).toMatchObject({ online: false, lat: null, location: null });

    await put(customer, { online: true }, 403);
    await put(near, { online: true, lat: 6.4 }, 400);
  });

  it('deletes positions nobody refreshed for half an hour', async () => {
    const agent = await signIn(t, 'agent');
    await put(agent, { online: true, lat: 6.448, lng: 3.47 });
    await t.db
      .update(agentPresence)
      .set({ locatedAt: new Date(Date.now() - 31 * 60_000) })
      .where(eq(agentPresence.userId, agent.userId));
    await t.jobs.run('presence.sweep');
    expect(await presenceOf(agent)).toMatchObject({ online: false, lat: null, location: null, locatedAt: null });
  });

  it('shows the customer their agent live during the errand, and forgets it once it ends', async () => {
    const agent = await signIn(t, 'agent');
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    expect((await view(customer, errand.id)).agentLocation).toBeNull();
    // The agent app learns it should keep sharing while the errand runs, even offline.
    expect((await request(t.http).get('/v1/agent/presence').set(agent.headers).expect(200)).body).toEqual({
      online: false,
      onErrand: true,
    });

    const socket = io(`${t.url}/realtime`, {
      auth: { token: customer.accessToken },
      transports: ['websocket'],
      forceNew: true,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('ready', resolve));
    const moved = new Promise<{ errandId: string; lat: number; lng: number }>((resolve) =>
      socket.once('agent.location', resolve),
    );

    // Offline but on an errand: the customer still sees where their agent is.
    await put(agent, { online: false, lat: 6.45, lng: 3.471 });
    expect(await moved).toMatchObject({ errandId: errand.id, lat: 6.45, lng: 3.471 });
    expect((await view(customer, errand.id)).agentLocation).toMatchObject({ lat: 6.45, lng: 3.471 });
    expect((await view(agent, errand.id)).agentLocation).toBeNull();

    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'mark_delivered');
    await act(t, agent, errand.id, 'confirm_pin', { pin: await pin(errand.id) });
    expect(await presenceOf(agent)).toMatchObject({ lat: null, location: null });

    // The agent's day so far: their share of the ₦2,500 fee after Bronze's 15%, not the item money.
    expect((await balanceOf(t, agent)).todayKobo).toBe(212_500);
  });
});
