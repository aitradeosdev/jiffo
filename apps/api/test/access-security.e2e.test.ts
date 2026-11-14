import { eq } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { providerEvents } from '../src/db/schema';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import {
  act,
  adminAs,
  agentWithMoney,
  createErrand,
  createTestApp,
  deliverWebhook,
  fund,
  LAGOS_STOPS,
  photo,
  signIn,
  type Person,
  type TestApp,
} from './helpers';

const PICKUP = { lat: LAGOS_STOPS[0]!.lat, lng: LAGOS_STOPS[0]!.lng };
const DROPOFF = LAGOS_STOPS[1]!;

/** Abuse cases for who may see and do what. */
describe('access rules', () => {
  let t: TestApp;
  let customer: Person;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    t = await createTestApp();
    customer = await signIn(t, 'customer');
    await fund(t, customer, 5_000_000);
  });
  afterEach(() => sockets.splice(0).forEach((s) => s.disconnect()));
  afterAll(() => t.close());

  const here = (agent: Person, at: { lat: number; lng: number }) =>
    request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, ...at })
      .expect(200);
  const board = (agent: Person, at: { lat: number; lng: number }) =>
    request(t.http).get(`/v1/errands/board?lat=${at.lat}&lng=${at.lng}&radiusKm=5`).set(agent.headers);

  describe('requests', () => {
    it('refuses fields an endpoint does not take', async () => {
      const res = await request(t.http).patch('/v1/me').set(customer.headers).send({ firstName: 'Ada', role: 'admin' });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('invalid_request');
      const errand = await request(t.http).post('/v1/errands').set(customer.headers).send({
        categoryKey: 'parcel',
        description: 'A small parcel to deliver',
        feeKobo: 250_000,
        stops: LAGOS_STOPS,
        status: 'completed',
      });
      expect(errand.status).toBe(400);
    });
  });

  describe('waiting errands', () => {
    it('are closed to agents who aren’t approved', async () => {
      const errand = await createErrand(t, customer);
      const unapproved = await signIn(t, 'agent', { unapproved: true });
      await request(t.http).get(`/v1/errands/${errand.id}`).set(unapproved.headers).expect(404);
    });

    it('show an approved agent the drop-off area only, until they accept', async () => {
      const errand = await createErrand(t, customer);
      const agent = await signIn(t, 'agent');
      const view = (await request(t.http).get(`/v1/errands/${errand.id}`).set(agent.headers).expect(200)).body;
      const dropoff = view.stops.find((s: { kind: string }) => s.kind === 'dropoff');
      expect(dropoff.address).not.toBe(DROPOFF.address);
      expect(dropoff.lat).not.toBe(DROPOFF.lat);
      expect(Math.abs(dropoff.lat - DROPOFF.lat)).toBeLessThan(0.01);
      await act(t, agent, errand.id, 'accept');
      const accepted = (await request(t.http).get(`/v1/errands/${errand.id}`).set(agent.headers).expect(200)).body;
      expect(accepted.stops.find((s: { kind: string }) => s.kind === 'dropoff').address).toBe(DROPOFF.address);
    });

    it('are listed on the board only around where the agent is', async () => {
      const agent = await signIn(t, 'agent');
      expect((await board(agent, PICKUP)).body.error.code).toBe('location_needed');
      await here(agent, PICKUP);
      expect((await board(agent, PICKUP)).status).toBe(200);
      // Asking about the other side of the country from Lekki.
      const abuja = { lat: 9.0765, lng: 7.3986 };
      expect((await board(agent, abuja)).body.error.code).toBe('not_here');
    });
  });

  describe('live connections', () => {
    it('are dropped when the account is suspended', async () => {
      const agent = await signIn(t, 'agent');
      const socket = io(`${t.url}/realtime`, {
        auth: { token: agent.accessToken },
        transports: ['websocket'],
        forceNew: true,
      });
      sockets.push(socket);
      await new Promise((resolve) => socket.once('ready', resolve));
      const dropped = new Promise((resolve) => socket.once('disconnect', resolve));
      const ops = await adminAs(t, 'operations');
      await request(t.http)
        .post(`/v1/admin/people/${agent.userId}/suspend`)
        .set(ops.headers)
        .send({ note: 'Testing the socket drop' })
        .expect(200);
      // Dropped at once on this server, and by the sweep on any other.
      await t.app.get(RealtimeGateway).sweep();
      await dropped;
      expect(socket.connected).toBe(false);
    });
  });

  describe('the agent’s position', () => {
    it('stops being shared with the customer after the drop-off photo', async () => {
      const agent = await signIn(t, 'agent');
      const errand = await createErrand(t, customer);
      await act(t, agent, errand.id, 'accept');
      await act(t, agent, errand.id, 'start');
      await act(t, agent, errand.id, 'mark_delivered');
      const before = (await request(t.http).get(`/v1/errands/${errand.id}`).set(customer.headers).expect(200)).body;
      expect(before.agentLocation).toBeTruthy();
      await act(t, agent, errand.id, 'send_dropoff_photo', {
        photo: await photo(t, agent, errand.id, 'dropoff_photo'),
      });
      const after = (await request(t.http).get(`/v1/errands/${errand.id}`).set(customer.headers).expect(200)).body;
      expect(after.agentLocation ?? null).toBeNull();
    });
  });

  describe('provider details', () => {
    it("tell agents the bank refused a withdrawal without the provider's words", async () => {
      const agent = await agentWithMoney(t, 300_000);
      t.payments.rejectNextTransfer = 'Recipient RCP_058_0123 account 0123456789 is not valid';
      const res = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(agent.headers)
        .send({ amountKobo: 100_000, speed: 'instant', requestId: crypto.randomUUID() })
        .expect(201);
      expect(res.body.status).toBe('failed');
      expect(res.body.failureReason).not.toContain('0123456789');
    });

    it('keep account numbers out of stored webhook bodies', async () => {
      const hook = t.payments.webhook('charge.success', {
        id: 91,
        reference: `jd-${crypto.randomUUID()}`,
        authorization: { sender_bank_account_number: '0123456789', account_number: '9876543210' },
        customer: { phone: '+2348030000000' },
      });
      await deliverWebhook(t, hook).expect(200);
      const [stored] = await t.db.select().from(providerEvents).where(eq(providerEvents.eventKey, 'charge.success:91'));
      const text = JSON.stringify(stored!.payload);
      expect(text).not.toContain('0123456789');
      expect(text).not.toContain('9876543210');
      expect(text).not.toContain('+2348030000000');
    });
  });
});
