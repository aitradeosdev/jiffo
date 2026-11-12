import { eq } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { devices } from '../src/db/schema';
import { act, createErrand, createTestApp, signIn, type Person, type TestApp } from './helpers';

describe('chat, realtime and push', () => {
  let t: TestApp;
  let customer: Person;
  let agent: Person;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    [customer, agent] = await Promise.all([signIn(t, 'customer'), signIn(t, 'agent')]);
    for (const [person, token] of [
      [customer, 'customer-push-token-1'],
      [agent, 'agent-push-token-1'],
    ] as const) {
      await request(t.http).put('/v1/devices/current/push-token').set(person.headers).send({ token }).expect(204);
    }
  });
  afterEach(() => {
    sockets.splice(0).forEach((s) => s.disconnect());
  });
  afterAll(() => t.close());

  const send = (person: Person, errandId: string, body: string, clientId: string = crypto.randomUUID()) =>
    request(t.http).post(`/v1/errands/${errandId}/messages`).set(person.headers).send({ body, clientId });
  const list = (person: Person, errandId: string, query = '') =>
    request(t.http).get(`/v1/errands/${errandId}/messages${query}`).set(person.headers);
  const pushesTo = (token: string) => t.push.sent.filter((p) => p.token === token);

  function connect(person: Person | null, token = person?.accessToken): Promise<Socket> {
    const socket = io(`${t.url}/realtime`, { auth: { token }, transports: ['websocket'], forceNew: true });
    sockets.push(socket);
    return new Promise((resolve, reject) => {
      socket.once('ready', () => resolve(socket));
      socket.once('auth_error', (e) => reject(new Error(e.code)));
      socket.once('connect_error', reject);
    });
  }
  const next = <T = unknown>(socket: Socket, event: string) =>
    new Promise<T>((resolve) => socket.once(event, (payload: T) => resolve(payload)));

  it('opens the chat when an agent accepts, with timeline notes', async () => {
    const errand = await createErrand(t, customer);
    expect((await list(customer, errand.id).expect(404)).body.error.code).toBe('chat_not_open');
    await act(t, agent, errand.id, 'accept');

    const res = await list(customer, errand.id).expect(200);
    expect(res.body.conversation).toMatchObject({ open: true, access: { provider: 'builtin', transport: 'realtime' } });
    expect(res.body.messages).toEqual([
      expect.objectContaining({ kind: 'system', senderRole: 'system', body: 'Agent accepted the errand' }),
    ]);
  });

  it('delivers messages both ways, once each, with a push to the other side', async () => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    const before = pushesTo('agent-push-token-1').length;

    const clientId = 'msg-1';
    const first = await send(customer, errand.id, 'Please call at the gate', clientId).expect(201);
    const retry = await send(customer, errand.id, 'Please call at the gate', clientId).expect(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(pushesTo('agent-push-token-1')).toHaveLength(before + 1);
    expect(pushesTo('agent-push-token-1').at(-1)).toMatchObject({
      title: 'Ada',
      body: 'Please call at the gate',
      data: { type: 'chat.message', errandId: errand.id },
    });

    await send(agent, errand.id, 'Okay, 5 minutes away').expect(201);
    const all = await list(agent, errand.id).expect(200);
    const texts = all.body.messages.filter((m: { kind: string }) => m.kind === 'text');
    expect(texts.map((m: { body: string; senderRole: string }) => [m.senderRole, m.body])).toEqual([
      ['customer', 'Please call at the gate'],
      ['agent', 'Okay, 5 minutes away'],
    ]);
    const after = await list(agent, errand.id, `?after=${first.body.id}`).expect(200);
    expect(after.body.messages.map((m: { body: string }) => m.body)).toEqual(['Okay, 5 minutes away']);
  });

  it('gives a new agent a fresh conversation and closes the chat when the errand ends', async () => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await send(customer, errand.id, 'Private note for the first agent').expect(201);
    await act(t, customer, errand.id, 'release_agent');
    expect((await send(agent, errand.id, 'Still here?').expect(409)).body.error.code).toBe('chat_closed');

    const second = await signIn(t, 'agent');
    await act(t, second, errand.id, 'accept');
    const seen = await list(second, errand.id).expect(200);
    expect(JSON.stringify(seen.body.messages)).not.toContain('Private note');

    await act(t, customer, errand.id, 'cancel', { reason: 'Changed my mind' });
    expect((await list(customer, errand.id).expect(200)).body.conversation.open).toBe(false);
    expect((await send(customer, errand.id, 'hello').expect(409)).body.error.code).toBe('chat_closed');
  });

  it('keeps chat to the errand’s own people', async () => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    const outsider = await signIn(t, 'agent');
    await list(outsider, errand.id).expect(404);
    await send(outsider, errand.id, 'hi').expect(404);
    await send(customer, errand.id, '   ').expect(400);
  });

  it('pushes errand updates to the other side', async () => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    expect(pushesTo('customer-push-token-1').at(-1)).toMatchObject({
      title: 'Agent on the way',
      data: { type: 'errand.updated', errandId: errand.id, event: 'accept', status: 'accepted' },
    });
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'mark_delivered');
    expect(pushesTo('customer-push-token-1').at(-1)).toMatchObject({ title: 'Your agent has arrived' });
  });

  it('clears push tokens the provider reports as dead, and stops pushing after logout', async () => {
    const person = await signIn(t, 'customer');
    await request(t.http)
      .put('/v1/devices/current/push-token')
      .set(person.headers)
      .send({ token: 'dead-token-123' })
      .expect(204);
    t.push.dead.add('dead-token-123');
    const errand = await createErrand(t, person);
    await act(t, agent, errand.id, 'accept');
    const [row] = await t.db.select().from(devices).where(eq(devices.pushToken, 'dead-token-123'));
    expect(row).toBeUndefined();

    const leaver = await signIn(t, 'agent');
    await request(t.http)
      .put('/v1/devices/current/push-token')
      .set(leaver.headers)
      .send({ token: 'leaver-token-1' })
      .expect(204);
    const job = await createErrand(t, customer);
    await act(t, leaver, job.id, 'accept');
    await send(customer, job.id, 'First message').expect(201);
    expect(pushesTo('leaver-token-1')).toHaveLength(1);
    await request(t.http).post('/v1/auth/logout').set(leaver.headers).expect(204);
    await send(customer, job.id, 'Second message').expect(201);
    expect(pushesTo('leaver-token-1')).toHaveLength(1);
  });

  describe('socket', () => {
    it('refuses connections without a valid session', async () => {
      await expect(connect(null, 'nope')).rejects.toThrow('invalid_token');
    });

    it('streams messages and errand updates to subscribers', async () => {
      const errand = await createErrand(t, customer);
      const customerSocket = await connect(customer);
      const userUpdate = next<{ event: string }>(customerSocket, 'errand.updated');
      await act(t, agent, errand.id, 'accept');
      expect(await userUpdate).toMatchObject({ errandId: errand.id, event: 'accept', status: 'accepted' });

      const agentSocket = await connect(agent);
      expect(await agentSocket.emitWithAck('errand.subscribe', { errandId: errand.id })).toEqual({ ok: true });
      expect(await customerSocket.emitWithAck('errand.subscribe', { errandId: errand.id })).toEqual({ ok: true });

      const incoming = next<{ message: { body: string } }>(agentSocket, 'message.created');
      await send(customer, errand.id, 'At the gate').expect(201);
      expect((await incoming).message.body).toBe('At the gate');

      const started = next<{ status: string }>(customerSocket, 'errand.updated');
      await act(t, agent, errand.id, 'start');
      expect((await started).status).toBe('started');
    });

    it('will not subscribe someone to another person’s errand', async () => {
      const errand = await createErrand(t, customer);
      const outsider = await signIn(t, 'customer');
      const socket = await connect(outsider);
      expect(await socket.emitWithAck('errand.subscribe', { errandId: errand.id })).toMatchObject({
        ok: false,
        error: { code: 'errand_not_found' },
      });
      expect(await socket.emitWithAck('errand.subscribe', { errandId: 'x' })).toMatchObject({ ok: false });
    });

    it('drops a released agent from the errand and disconnects on logout', async () => {
      const errand = await createErrand(t, customer);
      const leaving = await signIn(t, 'agent');
      await act(t, leaving, errand.id, 'accept');
      const socket = await connect(leaving);
      await socket.emitWithAck('errand.subscribe', { errandId: errand.id });
      await act(t, customer, errand.id, 'release_agent');

      let leaked = false;
      socket.on('message.created', () => (leaked = true));
      await act(t, agent, errand.id, 'accept');
      await send(customer, errand.id, 'Only for the new agent').expect(201);
      await new Promise((r) => setTimeout(r, 150));
      expect(leaked).toBe(false);

      const gone = next(socket, 'disconnect');
      await request(t.http).post('/v1/auth/logout').set(leaving.headers).expect(204);
      await gone;
    });
  });
});
