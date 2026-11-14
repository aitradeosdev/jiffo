import { eq } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { providerEvents, sessions } from '../src/db/schema';
import { TokensService } from '../src/auth/tokens.service';
import { RealtimeGateway } from '../src/realtime/realtime.gateway';
import {
  act,
  adminAs,
  agentWithMoney,
  createErrand,
  createTestApp,
  deliverWebhook,
  errandBody,
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

    it('refuses unknown fields inside nested objects and in an event’s data', async () => {
      const nested = await request(t.http)
        .post('/v1/errands')
        .set(customer.headers)
        .send(errandBody({ stops: [{ ...LAGOS_STOPS[0], status: 'paid' }, LAGOS_STOPS[1]] }));
      expect(nested.status).toBe(400);
      expect(nested.body.error.issues).toEqual([{ path: 'stops.0.status', message: expect.any(String) }]);

      const errand = await createErrand(t, customer);
      const agent = await signIn(t, 'agent');
      // An event that takes no data, and one that takes an amount only.
      await act(t, agent, errand.id, 'accept', { agentId: customer.userId }, 400);
      await act(t, agent, errand.id, 'accept');
      const offer = await request(t.http)
        .post(`/v1/errands/${errand.id}/events`)
        .set(agent.headers)
        .send({ event: 'send_offer', data: { amountKobo: 300_000, feeKobo: 1 } });
      expect(offer.status).toBe(400);
      expect(offer.body.error.issues).toEqual([{ path: 'data.feeKobo', message: expect.any(String) }]);
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

    it('show no street, house number or label for any stop until they accept', async () => {
      const errand = await createErrand(t, customer, {
        stops: [
          { kind: 'pickup', label: 'My house', address: 'Flat 3, 12 Bode Thomas Street, Surulere, Lagos', ...PICKUP },
          { kind: 'dropoff', label: 'Office', address: '12 Admiralty Way Lekki', lat: DROPOFF.lat, lng: DROPOFF.lng },
        ],
      });
      const agent = await signIn(t, 'agent');
      const view = (await request(t.http).get(`/v1/errands/${errand.id}`).set(agent.headers).expect(200)).body;
      expect(view.stops.map((s: { label: string | null; address: string }) => [s.label, s.address])).toEqual([
        [null, 'Surulere, Lagos'],
        [null, 'Drop-off area'],
      ]);
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

    it('are searched around the agent’s own position, not the place the app asks about', async () => {
      // About 8 km east of the agent: out of a 5 km board, even asked from 4.4 km east.
      const far = await createErrand(t, customer, {
        stops: [{ ...LAGOS_STOPS[0], lng: PICKUP.lng + 0.072 }, LAGOS_STOPS[1]],
      });
      const agent = await signIn(t, 'agent');
      await here(agent, PICKUP);
      const ids = async (at: { lat: number; lng: number }, radiusKm: number) =>
        (
          await request(t.http)
            .get(`/v1/errands/board?lat=${at.lat}&lng=${at.lng}&radiusKm=${radiusKm}`)
            .set(agent.headers)
            .expect(200)
        ).body.errands.map((e: { id: string }) => e.id);
      expect(await ids({ lat: PICKUP.lat, lng: PICKUP.lng + 0.04 }, 5)).not.toContain(far.id);
      expect(await ids(PICKUP, 10)).toContain(far.id);
    });

    it('never tell anyone which agents took and left the errand', async () => {
      const errand = await createErrand(t, customer);
      const [first, second] = [await signIn(t, 'agent'), await signIn(t, 'agent')];
      await act(t, first, errand.id, 'accept');
      await act(t, first, errand.id, 'withdraw');
      await act(t, second, errand.id, 'accept');
      for (const who of [customer, second]) {
        const events = (await request(t.http).get(`/v1/errands/${errand.id}/events`).set(who.headers).expect(200)).body;
        expect(JSON.stringify(events)).not.toContain(first.userId);
      }
    });
  });

  describe('live connections', () => {
    // A second API server on the same database and Redis, as in production behind a load balancer.
    let other: TestApp;
    beforeAll(async () => {
      other = await createTestApp();
    });
    afterAll(() => other.close());

    const connect = (server: TestApp, person: Person) => {
      const socket = io(`${server.url}/realtime`, {
        auth: { token: person.accessToken },
        transports: ['websocket'],
        forceNew: true,
      });
      sockets.push(socket);
      return new Promise<Socket>((resolve) => socket.once('ready', () => resolve(socket)));
    };
    const dropped = (socket: Socket) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('still connected')), 3_000);
        socket.once('disconnect', () => {
          clearTimeout(timer);
          resolve();
        });
      });

    it('are dropped on every server when the account is suspended', async () => {
      const agent = await signIn(t, 'agent');
      const [here, there] = [await connect(t, agent), await connect(other, agent)];
      const gone = Promise.all([dropped(here), dropped(there)]);
      const ops = await adminAs(t, 'operations');
      await request(t.http)
        .post(`/v1/admin/people/${agent.userId}/suspend`)
        .set(ops.headers)
        .send({ note: 'Testing the socket drop' })
        .expect(200);
      // No sweep needed: the disconnect goes through Redis to the other server.
      await gone;
    });

    it('are dropped on every server when that phone signs out, and only that phone', async () => {
      const phone = await signIn(t, 'customer');
      const socket = await connect(other, phone);
      const gone = dropped(socket);
      await request(t.http).post('/v1/auth/logout').set(phone.headers).expect(204);
      await gone;
    });

    it('are re-checked by the sweep, for a session that ended without a sign-out', async () => {
      const phone = await signIn(t, 'customer');
      const socket = await connect(other, phone);
      const gone = dropped(socket);
      const { sessionId } = await t.app.get(TokensService).verifyAccess(phone.accessToken);
      await t.db
        .update(sessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(sessions.id, sessionId));
      await other.app.get(RealtimeGateway).sweep();
      await gone;
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

  describe('an agent holding two errands', () => {
    it('is followed only by the customer whose errand is under way', async () => {
      const other = await signIn(t, 'customer');
      await fund(t, other, 5_000_000);
      const agent = await signIn(t, 'agent');
      const underWay = await createErrand(t, customer);
      const waiting = await createErrand(t, other);
      await act(t, agent, underWay.id, 'accept');
      await act(t, agent, underWay.id, 'start');
      await act(t, agent, waiting.id, 'accept');
      await here(agent, PICKUP);
      const locationFor = async (who: Person, id: string) =>
        (await request(t.http).get(`/v1/errands/${id}`).set(who.headers).expect(200)).body.agentLocation ?? null;
      expect(await locationFor(customer, underWay.id)).toBeTruthy();
      expect(await locationFor(other, waiting.id)).toBeNull();
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
      expect(res.body.failureReason).toContain('bank account details');
    });

    it('don’t send agents to change good bank details when the failure is on the provider’s side', async () => {
      const agent = await agentWithMoney(t, 300_000);
      t.payments.rejectNextTransfer = 'Insufficient balance in your Paystack balance';
      const res = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(agent.headers)
        .send({ amountKobo: 100_000, speed: 'instant', requestId: crypto.randomUUID() })
        .expect(201);
      expect(res.body.status).toBe('failed');
      expect(res.body.failureReason).not.toContain('bank account details');
      expect(res.body.failureReason).toContain('back in your balance');
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
