import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countries, errands, users } from '../src/db/schema';
import {
  act,
  createErrand,
  createTestApp,
  photo,
  errandBody,
  fund,
  LAGOS_STOPS,
  signIn,
  type Person,
  type TestApp,
} from './helpers';

describe('errands', () => {
  let t: TestApp;
  let customer: Person;
  let agent: Person;
  let otherAgent: Person;

  beforeAll(async () => {
    t = await createTestApp();
    [customer, agent, otherAgent] = await Promise.all([signIn(t, 'customer'), signIn(t, 'agent'), signIn(t, 'agent')]);
    await fund(t, customer, 50_000_000);
  });
  afterAll(() => t.close());

  const get = (person: Person, id: string, status = 200) =>
    request(t.http).get(`/v1/errands/${id}`).set(person.headers).expect(status);
  const pin = async (id: string) =>
    (await request(t.http).get(`/v1/errands/${id}/pin`).set(customer.headers).expect(200)).body.pin as string;

  describe('creating', () => {
    it('creates a requested errand with its stops, taking buy from the category', async () => {
      const errand = await createErrand(t, customer, { categoryKey: 'groceries' });
      expect(errand).toMatchObject({
        status: 'requested',
        version: 0,
        buy: true,
        role: 'customer',
        allowedEvents: ['cancel', 'raise_fee'],
      });
      const parcel = await createErrand(t, customer);
      expect(parcel.buy).toBe(false);
      const override = await createErrand(t, customer, { categoryKey: 'groceries', buy: false });
      expect(override.buy).toBe(false);

      const { body } = await get(customer, errand.id);
      expect(body.stops).toEqual(LAGOS_STOPS.map((s, seq) => ({ seq, ...s })));
      expect(body.customer).toEqual({ id: customer.userId, firstName: 'Ada' });
      expect(body.agent).toBeNull();
    });

    it('refuses errands that break the country rules', async () => {
      const send = (overrides: Record<string, unknown>) =>
        request(t.http).post('/v1/errands').set(customer.headers).send(errandBody(overrides));
      expect((await send({ feeKobo: 50_000 }).expect(422)).body.error).toMatchObject({
        code: 'fee_too_low',
        minFeeKobo: 100_000,
      });
      expect((await send({ categoryKey: 'rockets' }).expect(422)).body.error.code).toBe('category_not_available');
      expect((await send({ stateCode: 'XX' }).expect(422)).body.error.code).toBe('state_not_available');
      expect((await send({ stops: [...LAGOS_STOPS].reverse() }).expect(400)).body.error.code).toBe('invalid_request');
      expect((await send({ stops: [LAGOS_STOPS[0]] }).expect(400)).body.error.code).toBe('invalid_request');
      const soon = new Date(Date.now() + 60_000).toISOString();
      expect((await send({ scheduledFor: soon }).expect(422)).body.error.code).toBe('schedule_too_soon');
    });

    it('needs a name first, and only from the customer app', async () => {
      const nameless = await signIn(t, 'customer', { firstName: null });
      const res = await request(t.http).post('/v1/errands').set(nameless.headers).send(errandBody()).expect(409);
      expect(res.body.error.code).toBe('profile_incomplete');
      const fromAgentApp = await request(t.http).post('/v1/errands').set(agent.headers).send(errandBody()).expect(403);
      expect(fromAgentApp.body.error.code).toBe('wrong_app');
    });
  });

  describe('a delivery without purchase', () => {
    it('runs from request to PIN hand-off, with a new price on the way', async () => {
      const errand = await createErrand(t, customer);

      const prospect = await get(agent, errand.id);
      expect(prospect.body).toMatchObject({ role: 'prospect', allowedEvents: ['accept'] });

      const accepted = await act(t, agent, errand.id, 'accept');
      expect(accepted).toMatchObject({
        status: 'accepted',
        role: 'agent',
        agent: { id: agent.userId, firstName: 'Tunde' },
      });
      expect(accepted.allowedEvents).toEqual(expect.arrayContaining(['withdraw', 'send_offer', 'start']));
      // Another agent can no longer see it once it is taken.
      await get(otherAgent, errand.id, 404);

      const offered = await act(t, agent, errand.id, 'send_offer', { amountKobo: 300_000 });
      expect(offered).toMatchObject({ pendingOfferKobo: 300_000, feeKobo: 250_000 });
      expect(offered.allowedEvents).not.toContain('start');
      expect((await act(t, agent, errand.id, 'start', {}, 409)).error.code).toBe('errand_blocked');

      const customerView = await get(customer, errand.id);
      // What accepting would hold is worked out with the errand's own settings: 10% service fee.
      expect(customerView.body.pendingOfferServiceFeeKobo).toBe(30_000);
      expect(customerView.body.allowedEvents).toEqual(
        expect.arrayContaining(['accept_offer', 'decline_offer', 'cancel', 'release_agent']),
      );
      const agreed = await act(t, customer, errand.id, 'accept_offer');
      expect(agreed).toMatchObject({ feeKobo: 300_000, pendingOfferKobo: null });

      await act(t, agent, errand.id, 'start');
      // New prices stop once the service has started.
      expect((await act(t, agent, errand.id, 'send_offer', { amountKobo: 400_000 }, 409)).error.code).toBe(
        'errand_invalid_state',
      );

      const early = await request(t.http).get(`/v1/errands/${errand.id}/pin`).set(customer.headers).expect(409);
      expect(early.body.error.code).toBe('pin_not_available');

      await act(t, agent, errand.id, 'mark_delivered');
      const code = await pin(errand.id);
      expect(code).toMatch(/^\d{4}$/);

      const wrong = code === '0000' ? '1111' : '0000';
      const miss = await act(t, agent, errand.id, 'confirm_pin', { pin: wrong }, 422);
      expect(miss.error).toMatchObject({ code: 'wrong_pin', attemptsLeft: 4 });

      const done = await act(t, agent, errand.id, 'confirm_pin', { pin: code });
      expect(done).toMatchObject({ status: 'completed', allowedEvents: [] });
      expect(done.completedAt).toBeTruthy();
      expect((await get(customer, errand.id)).body.completedBy).toBe('pin');

      const events = await request(t.http).get(`/v1/errands/${errand.id}/events`).set(customer.headers).expect(200);
      expect(events.body.map((e: { event: string }) => e.event)).toEqual([
        'create',
        'accept',
        'send_offer',
        'accept_offer',
        'start',
        'mark_delivered',
        // The wrong PIN tried above is on the record, without its digits.
        'pin_wrong',
        'confirm_pin',
      ]);
      expect(JSON.stringify(events.body)).not.toContain(code);
    });

    it('freezes the errand for support after five wrong PINs, with no photo route round it', async () => {
      const errand = await createErrand(t, customer);
      await act(t, agent, errand.id, 'accept');
      await act(t, agent, errand.id, 'start');
      await act(t, agent, errand.id, 'mark_delivered');
      const code = await pin(errand.id);
      const wrong = code === '0000' ? '1111' : '0000';
      for (let i = 0; i < 4; i++) await act(t, agent, errand.id, 'confirm_pin', { pin: wrong }, 422);
      expect((await act(t, agent, errand.id, 'confirm_pin', { pin: wrong }, 423)).error.code).toBe('pin_locked');
      // Even the right PIN, or a photo, does nothing now: support settles it.
      await act(t, agent, errand.id, 'confirm_pin', { pin: code }, 409);
      await act(
        t,
        agent,
        errand.id,
        'send_dropoff_photo',
        { photo: await photo(t, agent, errand.id, 'dropoff_photo') },
        409,
      );
    });
  });

  describe('a purchase errand', () => {
    it('needs the item amount locked before delivery', async () => {
      const errand = await createErrand(t, customer, {
        categoryKey: 'groceries',
        description: 'Rice, oil and tomatoes',
      });
      await act(t, agent, errand.id, 'accept');
      await act(t, agent, errand.id, 'start');
      expect((await act(t, agent, errand.id, 'mark_delivered', {}, 409)).error.code).toBe('errand_blocked');

      const bad = await act(t, agent, errand.id, 'send_item_amount', { amountKobo: 1_500_000 }, 400);
      expect(bad.error.code).toBe('invalid_request');
      const pending = await act(t, agent, errand.id, 'send_item_amount', {
        amountKobo: 1_500_000,
        photos: [await photo(t, agent, errand.id, 'receipt')],
      });
      expect(pending).toMatchObject({ status: 'item_pending', itemAmountKobo: 1_500_000 });

      const lockedIn = await act(t, customer, errand.id, 'lock_item_amount');
      expect(lockedIn.status).toBe('items_locked');
      await act(t, agent, errand.id, 'mark_delivered');
      await act(t, agent, errand.id, 'confirm_pin', { pin: await pin(errand.id) });
      expect((await get(customer, errand.id)).body.status).toBe('completed');
    });
  });

  describe('who may do what', () => {
    it('derives the actor from the session, never from the request', async () => {
      const errand = await createErrand(t, customer);
      expect((await act(t, customer, errand.id, 'accept', {}, 403)).error.code).toBe('errand_not_allowed');
      await act(t, agent, errand.id, 'accept');
      expect((await act(t, customer, errand.id, 'start', {}, 403)).error.code).toBe('errand_not_allowed');
      expect((await act(t, otherAgent, errand.id, 'start', {}, 404)).error.code).toBe('errand_not_found');
      expect((await act(t, customer, errand.id, 'resolve_complete', {}, 403)).error.code).toBe('errand_not_allowed');
      expect((await act(t, agent, errand.id, 'fly_away', {}, 400)).error.code).toBe('errand_unknown_event');
    });

    it('hides other people’s errands and refuses the PIN to the agent', async () => {
      const errand = await createErrand(t, customer);
      const stranger = await signIn(t, 'customer');
      await get(stranger, errand.id, 404);
      await request(t.http).get('/v1/errands/not-a-uuid').set(customer.headers).expect(404);
      await act(t, agent, errand.id, 'accept');
      await request(t.http).get(`/v1/errands/${errand.id}/pin`).set(agent.headers).expect(403);
    });

    it('refuses an event made against an old version', async () => {
      const errand = await createErrand(t, customer);
      await act(t, agent, errand.id, 'accept');
      const res = await request(t.http)
        .post(`/v1/errands/${errand.id}/events`)
        .set(customer.headers)
        .send({ event: 'cancel', version: 0 })
        .expect(409);
      expect(res.body.error).toMatchObject({ code: 'errand_changed', version: 1 });
    });

    it('lets only one of two agents win the same errand', async () => {
      const errand = await createErrand(t, customer);
      const results = await Promise.all(
        [agent, otherAgent].map((a) =>
          request(t.http).post(`/v1/errands/${errand.id}/events`).set(a.headers).send({ event: 'accept' }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 404]);
    });
  });

  describe('countries', () => {
    it('keeps agents to errands in their own country', async () => {
      await t.db
        .insert(countries)
        .values({ code: 'GH', name: 'Ghana', currency: 'GHS', phonePrefix: '+233', timezone: 'Africa/Accra' })
        .onConflictDoNothing();
      const abroad = await signIn(t, 'agent');
      await t.db.update(users).set({ countryCode: 'GH' }).where(eq(users.id, abroad.userId));
      const errand = await createErrand(t, customer);

      await get(abroad, errand.id, 404);
      await act(t, abroad, errand.id, 'accept', {}, 404);
      const board = await request(t.http)
        .get('/v1/errands/board?lat=6.4480&lng=3.4700')
        .set(abroad.headers)
        .expect(200);
      expect(board.body).toEqual({ errands: [], hiddenByPreferences: 0 });
    });
  });

  describe('changing agents', () => {
    it('sends the errand back to the board with a fresh PIN', async () => {
      const errand = await createErrand(t, customer);
      await act(t, agent, errand.id, 'accept');
      const released = await act(t, customer, errand.id, 'release_agent');
      expect(released).toMatchObject({ status: 'requested', agent: null });
      await get(agent, errand.id); // back on the board, so visible as a prospect again

      await act(t, otherAgent, errand.id, 'accept');
      await get(agent, errand.id, 404);
      const withdrawn = await act(t, otherAgent, errand.id, 'withdraw');
      expect(withdrawn.status).toBe('requested');
    });
  });

  describe('lists and the board', () => {
    it('lists each person’s own errands per app', async () => {
      const person = await signIn(t, 'customer');
      await fund(t, person);
      const a = await createErrand(t, person);
      const b = await createErrand(t, person);
      const mine = await request(t.http).get('/v1/errands').set(person.headers).expect(200);
      expect(mine.body.map((e: { id: string }) => e.id)).toEqual([b.id, a.id]);
      const page = await request(t.http).get('/v1/errands?limit=1').set(person.headers).expect(200);
      expect(page.body).toHaveLength(1);
    });

    it('shows open errands near the agent, nearest first', async () => {
      const person = await signIn(t, 'customer');
      await fund(t, person);
      const lekki = await createErrand(t, person);
      const ikeja = await createErrand(t, person, {
        stops: [
          { kind: 'pickup', address: 'Allen Avenue, Ikeja, Lagos', lat: 6.6018, lng: 3.3515 },
          { kind: 'dropoff', address: 'Opebi Road, Ikeja, Lagos', lat: 6.5944, lng: 3.3637 },
        ],
      });
      const near = await request(t.http)
        .get('/v1/errands/board?lat=6.4480&lng=3.4700&radiusKm=5')
        .set(agent.headers)
        .expect(200);
      const ids = near.body.errands.map((e: { id: string }) => e.id);
      expect(ids).toContain(lekki.id);
      expect(ids).not.toContain(ikeja.id);
      const mine = near.body.errands.find((e: { id: string }) => e.id === lekki.id);
      expect(mine).toMatchObject({ role: 'prospect', allowedEvents: ['accept'] });
      expect(mine.distanceMeters).toBeLessThan(500);

      const wide = await request(t.http)
        .get('/v1/errands/board?lat=6.4480&lng=3.4700&radiusKm=30')
        .set(agent.headers)
        .expect(200);
      const order = wide.body.errands.map((e: { id: string }) => e.id);
      expect(order.indexOf(lekki.id)).toBeLessThan(order.indexOf(ikeja.id));

      await request(t.http).get('/v1/errands/board?lat=6.4&lng=3.4').set(customer.headers).expect(403);
    });
  });

  describe('timers', () => {
    it('rolls the change back when its timer cannot be stored', async () => {
      const errand = await createErrand(t, customer);
      await act(t, agent, errand.id, 'accept');
      await act(t, agent, errand.id, 'start');
      await act(t, agent, errand.id, 'mark_delivered');

      const schedule = t.timers.schedule;
      t.timers.schedule = async () => {
        throw new Error('Redis is down');
      };
      try {
        await act(
          t,
          agent,
          errand.id,
          'send_dropoff_photo',
          { photo: await photo(t, agent, errand.id, 'dropoff_photo') },
          500,
        );
      } finally {
        t.timers.schedule = schedule;
      }
      const [row] = await t.db.select().from(errands).where(eq(errands.id, errand.id));
      expect(row).toMatchObject({ status: 'delivered', version: 3 });

      // Once the timer store is back, the same request goes through and its timer is set.
      await act(t, agent, errand.id, 'send_dropoff_photo', {
        photo: await photo(t, agent, errand.id, 'dropoff_photo'),
      });
      expect(t.timers.pending.some((p) => p.job.errandId === errand.id && p.job.event === 'auto_release')).toBe(true);
    });

    it('expires an urgent errand nobody took', async () => {
      const errand = await createErrand(t, customer, { urgent: true });
      expect(t.timers.pending.find((p) => p.job.errandId === errand.id)).toMatchObject({
        job: { event: 'expire', status: 'requested', version: 0 },
        delayMs: 30 * 60_000,
      });
      await t.timers.fireAll(errand.id);
      expect((await get(customer, errand.id)).body.status).toBe('expired');
    });

    it('ignores a timer once the errand has moved on', async () => {
      const errand = await createErrand(t, customer, { categoryKey: 'groceries' });
      await act(t, agent, errand.id, 'accept');
      await act(t, agent, errand.id, 'start');
      await act(t, agent, errand.id, 'send_item_amount', {
        amountKobo: 900_000,
        photos: [await photo(t, agent, errand.id, 'receipt')],
      });
      await act(t, customer, errand.id, 'lock_item_amount');
      const fired = await t.timers.fireAll(errand.id);
      expect(fired.map((j) => j.event)).toEqual(['item_lock_timeout']);
      expect((await get(customer, errand.id)).body.status).toBe('items_locked');
    });

    it('sends an unlocked item amount to a dispute, and auto-approves a drop-off photo', async () => {
      const buy = await createErrand(t, customer, { categoryKey: 'groceries' });
      await act(t, agent, buy.id, 'accept');
      await act(t, agent, buy.id, 'start');
      await act(t, agent, buy.id, 'send_item_amount', {
        amountKobo: 900_000,
        photos: [await photo(t, agent, buy.id, 'receipt')],
      });
      const disputes = async () =>
        (await request(t.http).get('/v1/me/stats').set(customer.headers).expect(200)).body.disputes as number;
      const before = await disputes();
      await t.timers.fireAll(buy.id);
      expect((await get(customer, buy.id)).body).toMatchObject({ status: 'disputed', itemsLocked: false });
      // A missed deadline counts as a dispute on the account, like one either side opens.
      expect(await disputes()).toBe(before + 1);

      const drop = await createErrand(t, customer);
      await act(t, agent, drop.id, 'accept');
      await act(t, agent, drop.id, 'start');
      await act(t, agent, drop.id, 'mark_delivered');
      await act(t, agent, drop.id, 'send_dropoff_photo', { photo: await photo(t, agent, drop.id, 'dropoff_photo') });
      const [job] = await t.timers.fireAll(drop.id);
      expect(job).toMatchObject({ event: 'auto_release' });
      expect((await get(customer, drop.id)).body.status).toBe('completed');
      const events = await request(t.http).get(`/v1/errands/${drop.id}/events`).set(customer.headers).expect(200);
      expect(events.body.at(-1)).toMatchObject({ event: 'auto_release', actorRole: 'system' });
    });
  });
});
