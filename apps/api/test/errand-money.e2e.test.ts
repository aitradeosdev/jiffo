import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decrypt } from '../src/common/crypto';
import { agentPresence, errandEvents, errands } from '../src/db/schema';
import { WalletService } from '../src/money/wallet.service';
import {
  act,
  adminAs,
  atDropoff,
  balanceOf,
  createErrand,
  createTestApp,
  fund,
  LAGOS_STOPS,
  photo,
  signIn,
  waitedAtDropoff,
  type Person,
  type TestApp,
  approved,
} from './helpers';

/** Fee 250,000 kobo; service fee 10% = 25,000. */
const FEE = 250_000;
const SERVICE = 25_000;
const PICKUP = { lat: LAGOS_STOPS[0]!.lat, lng: LAGOS_STOPS[0]!.lng };

/** Abuse cases for the money an errand holds: the hand-off PIN, the drop-off, limits. */
describe('the errand money path', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let original: { version: number; settings: { security: Record<string, number> } };

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
  });
  afterAll(async () => {
    // Errands made here keep the settings version they were made under, so the versions stay and the
    // original values are saved back as a new one.
    await security(original.settings.security);
    await t.close();
  });

  const trialBalance = () => t.app.get(WalletService).trialBalance();
  const event = (who: Person, id: string, name: string, data: Record<string, unknown> = {}) =>
    request(t.http).post(`/v1/errands/${id}/events`).set(who.headers).send({ event: name, data });
  const errandRow = async (id: string) => (await t.db.select().from(errands).where(eq(errands.id, id)))[0]!;
  async function security(changes: Record<string, number>) {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    Object.assign(settings.security, changes);
    expect(
      (
        await approved(t, 'owner', (h) =>
          request(t.http)
            .post('/v1/admin/settings?country=NG')
            .set(h)
            .send({ basedOn: now.version, settings, note: 'Security limits for a test' }),
        )
      ).status,
    ).toBe(200);
  }
  async function underway(overrides: Record<string, unknown> = {}) {
    const customer = await signIn(t, 'customer');
    await fund(t, customer, 5_000_000);
    const agent = await signIn(t, 'agent');
    const errand = await createErrand(t, customer, overrides);
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    return { customer, agent, errand };
  }

  describe('the hand-off PIN', () => {
    it('freezes both escrows for support after the last wrong PIN, and pays nobody', async () => {
      const { customer, agent, errand } = await underway();
      await act(t, agent, errand.id, 'mark_delivered');
      const real = (await request(t.http).get(`/v1/errands/${errand.id}/pin`).set(customer.headers).expect(200)).body
        .pin;
      const wrong = real === '9173' ? '4826' : '9173';
      for (let i = 0; i < 4; i++)
        expect((await event(agent, errand.id, 'confirm_pin', { pin: wrong })).status).toBe(422);
      const last = await event(agent, errand.id, 'confirm_pin', { pin: wrong });
      expect(last.status).toBe(423);
      expect(last.body.error.code).toBe('pin_locked');
      expect((await errandRow(errand.id)).status).toBe('disputed');
      // No way round it: the photo route is closed, and nothing is paid or given back by itself.
      await waitedAtDropoff(t, errand.id);
      const photoRes = await event(agent, errand.id, 'send_dropoff_photo', {
        photo: await photo(t, agent, errand.id, 'dropoff_photo'),
      });
      expect(photoRes.status).toBe(409);
      expect((await balanceOf(t, customer)).balanceKobo).toBe(5_000_000 - FEE - SERVICE);
      expect((await balanceOf(t, agent)).heldKobo).toBe(0);
      // Each wrong entry is on the errand's record, without the digits tried.
      const events = await t.db.select().from(errandEvents).where(eq(errandEvents.errandId, errand.id));
      expect(events.filter((e) => e.event === 'pin_wrong')).toHaveLength(4);
      expect(events.find((e) => e.event === 'pin_locked')).toMatchObject({ toStatus: 'disputed' });
      expect(JSON.stringify(events)).not.toContain(wrong);
      expect(await trialBalance()).toBe(0);
    });

    it('freezes an errand locked before this rule, rather than opening it again', async () => {
      const { customer, agent, errand } = await underway();
      await act(t, agent, errand.id, 'mark_delivered');
      const pin = (await request(t.http).get(`/v1/errands/${errand.id}/pin`).set(customer.headers).expect(200)).body
        .pin;
      await t.db.update(errands).set({ pinAttempts: 5 }).where(eq(errands.id, errand.id));
      expect((await event(agent, errand.id, 'confirm_pin', { pin })).status).toBe(423);
      expect((await errandRow(errand.id)).status).toBe('disputed');
    });

    it('takes the PIN, and marks delivered, only at the drop-off', async () => {
      const { customer, agent, errand } = await underway();
      await atDropoff(t, agent, errand.id, PICKUP);
      const far = await event(agent, errand.id, 'mark_delivered');
      expect(far.status).toBe(422);
      expect(far.body.error.code).toBe('not_at_dropoff');
      await atDropoff(t, agent, errand.id);
      expect((await event(agent, errand.id, 'mark_delivered')).status).toBe(200);
      const pin = (await request(t.http).get(`/v1/errands/${errand.id}/pin`).set(customer.headers).expect(200)).body
        .pin;
      await atDropoff(t, agent, errand.id, PICKUP);
      expect((await event(agent, errand.id, 'confirm_pin', { pin })).body.error.code).toBe('not_at_dropoff');
      // A position that is too old doesn't count either.
      await atDropoff(t, agent, errand.id);
      await t.db.execute(
        `update agent_presence set located_at = now() - interval '1 hour' where user_id = '${agent.userId}'` as never,
      );
      expect((await event(agent, errand.id, 'confirm_pin', { pin })).body.error.code).toBe('location_needed');
      await atDropoff(t, agent, errand.id);
      expect((await event(agent, errand.id, 'confirm_pin', { pin })).status).toBe(200);
    });

    it('keeps the PIN under the errand’s own key, and forgets it when the errand ends', async () => {
      const { customer, agent, errand } = await underway();
      const row = await errandRow(errand.id);
      expect(row.pinCipher).toMatch(/^v2:/);
      expect(row.pinHmac).toBeTruthy();
      // The global key alone opens nothing.
      expect(() => decrypt(process.env.PIN_KEY!, row.pinCipher!.slice(3))).toThrow();
      await act(t, agent, errand.id, 'mark_delivered');
      const pin = (await request(t.http).get(`/v1/errands/${errand.id}/pin`).set(customer.headers).expect(200)).body
        .pin;
      await act(t, agent, errand.id, 'confirm_pin', { pin });
      const after = await errandRow(errand.id);
      expect(after.pinCipher).toBeNull();
      expect(after.pinHmac).toBeNull();
    });
  });

  describe('the drop-off photo', () => {
    it('is accepted only after the agent has waited at the drop-off', async () => {
      const { agent, errand } = await underway();
      await act(t, agent, errand.id, 'mark_delivered');
      const shot = await photo(t, agent, errand.id, 'dropoff_photo');
      const early = await event(agent, errand.id, 'send_dropoff_photo', { photo: shot });
      expect(early.status).toBe(409);
      expect(early.body.error.code).toBe('dropoff_wait');
      await waitedAtDropoff(t, errand.id);
      // Waiting doesn't count from somewhere else: the agent must still be at the drop-off.
      await atDropoff(t, agent, errand.id, PICKUP);
      expect((await event(agent, errand.id, 'send_dropoff_photo', { photo: shot })).body.error.code).toBe(
        'not_at_dropoff',
      );
      await atDropoff(t, agent, errand.id);
      expect((await event(agent, errand.id, 'send_dropoff_photo', { photo: shot })).status).toBe(200);
    });
  });

  describe('limits', () => {
    it('reads the board’s distance and how recent a position must be from the settings', async () => {
      const agent = await signIn(t, 'agent');
      await request(t.http)
        .put('/v1/agent/presence')
        .set(agent.headers)
        .send({ online: true, ...PICKUP })
        .expect(200);
      // About 2.2 km east of where the agent reported being.
      const board = () =>
        request(t.http)
          .get(`/v1/errands/board?lat=${PICKUP.lat}&lng=${PICKUP.lng + 0.02}&radiusKm=5`)
          .set(agent.headers);
      expect((await board()).status).toBe(200);
      const before = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body
        .settings.security;
      try {
        await security({ boardNearKm: 1 });
        expect((await board()).body.error.code).toBe('not_here');
        await security({ boardNearKm: before.boardNearKm });

        // A position three minutes old counts under the default five, not under two.
        await t.db
          .update(agentPresence)
          .set({ locatedAt: new Date(Date.now() - 3 * 60_000) })
          .where(eq(agentPresence.userId, agent.userId));
        expect((await board()).status).toBe(200);
        await security({ positionFreshMinutes: 2 });
        expect((await board()).body.error.code).toBe('location_needed');
      } finally {
        await security({ boardNearKm: before.boardNearKm, positionFreshMinutes: before.positionFreshMinutes });
      }
    });

    it('holds no more item money than a new agent may carry', async () => {
      const { agent, errand } = await underway({ categoryKey: 'groceries' });
      const res = await event(agent, errand.id, 'send_item_amount', {
        amountKobo: 3_000_001,
        photos: [await photo(t, agent, errand.id, 'receipt')],
      });
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'item_limit', limitKobo: 3_000_000 });
    });

    it('lets an agent hold only so many errands at once, as admin sets it now', async () => {
      const customer = await signIn(t, 'customer');
      await fund(t, customer, 5_000_000);
      const agent = await signIn(t, 'agent');
      const waiting = await Promise.all([0, 1, 2].map(() => createErrand(t, customer)));
      // Set after the errands were made: it still applies to them.
      await security({ maxActiveErrandsPerAgent: 2 });
      for (const e of waiting.slice(0, 2)) await act(t, agent, e.id, 'accept');
      const third = await event(agent, waiting[2]!.id, 'accept');
      expect(third.status).toBe(409);
      expect(third.body.error.code).toBe('too_many_errands');
      await security({ maxActiveErrandsPerAgent: 0 });
    });

    it('takes no more than 5 counter-offers a minute on an errand', async () => {
      const customer = await signIn(t, 'customer');
      await fund(t, customer, 5_000_000);
      const agent = await signIn(t, 'agent');
      const errand = await createErrand(t, customer);
      await act(t, agent, errand.id, 'accept');
      for (let i = 0; i < 5; i++) {
        await act(t, agent, errand.id, 'send_offer', { amountKobo: 300_000 + i * 10_000 });
        await act(t, customer, errand.id, 'decline_offer');
      }
      const sixth = await event(agent, errand.id, 'send_offer', { amountKobo: 400_000 });
      expect(sixth.status).toBe(429);
      expect(sixth.body.error.code).toBe('too_many_offers');
    });
  });
});
