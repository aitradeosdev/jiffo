import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { customerVerifications, deposits, fixedAccounts } from '../src/db/schema';
import { adminAs, balanceOf, createTestApp, deliverWebhook, signIn, type Person, type TestApp } from './helpers';

/** Abuse cases for top-ups: forged routes, unknown references, races, and own account numbers. */
describe('top-ups under abuse', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let finance: Awaited<ReturnType<typeof adminAs>>;
  let original: { settings: { topUps: { oneTimeAccount: boolean; fixedAccount: boolean } } };

  beforeAll(async () => {
    t = await createTestApp();
    [owner, finance] = await Promise.all([adminAs(t, 'owner'), adminAs(t, 'finance')]);
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    await topUps(true, true);
  });
  afterAll(async () => {
    await topUps(original.settings.topUps.oneTimeAccount, original.settings.topUps.fixedAccount);
    await t.close();
  });

  async function topUps(oneTimeAccount: boolean, fixedAccount: boolean) {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    settings.topUps = { oneTimeAccount, fixedAccount };
    await request(t.http)
      .post('/v1/admin/settings?country=NG')
      .set(owner.headers)
      .send({ basedOn: now.version, settings, note: 'Ways to add money for a test' })
      .expect(200);
  }
  const alertsOf = async (kind: string) =>
    (
      (await request(t.http).get('/v1/admin/alerts?country=NG').set(finance.headers).expect(200)).body.alerts as Array<{
        kind: string;
        resolvedAt: string | null;
      }>
    ).filter((a) => a.kind === kind && !a.resolvedAt);
  const deposit = (who: Person, body: Record<string, unknown> = {}) =>
    request(t.http)
      .post('/v1/wallet/deposits')
      .set(who.headers)
      .send({ amountKobo: 500_000, ...body });
  async function customer() {
    const who = await signIn(t, 'customer');
    await request(t.http).patch('/v1/me').set(who.headers).send({ lastName: 'Okafor' }).expect(200);
    return who;
  }

  describe('the own-account route', () => {
    it('never credits one of our one-time references as a transfer into an own account', async () => {
      const who = await customer();
      const res = await deposit(who).expect(201);
      const [row] = await t.db.select().from(deposits).where(eq(deposits.id, res.body.id));
      // A signed event dressed up as a dedicated-account payment, naming a one-time top-up's reference.
      t.payments.pay(row!.reference);
      const forged = t.payments.webhook('charge.success', {
        id: 77,
        reference: row!.reference,
        channel: 'dedicated_nuban',
      });
      await deliverWebhook(t, forged);
      const all = await t.db.select().from(deposits).where(eq(deposits.userId, who.userId));
      expect(all.filter((d) => d.method === 'fixed')).toHaveLength(0);
    });
  });

  describe('unknown references', () => {
    it('raises an alert for a paid top-up nobody here knows', async () => {
      const hook = t.payments.webhook('charge.success', { id: 78, reference: `jd-${randomUUID()}` });
      await deliverWebhook(t, hook).expect(200);
      expect(await alertsOf('deposit_unknown')).not.toHaveLength(0);
    });
  });

  describe('races', () => {
    it('opens no more than three top-ups from ten requests at once', async () => {
      const who = await customer();
      const results = await Promise.all(Array.from({ length: 10 }, () => deposit(who)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(3);
      expect(results.filter((r) => r.status !== 201).every((r) => r.status === 429)).toBe(true);
    });

    it('makes one top-up from ten identical requests with one key', async () => {
      const who = await customer();
      const requestId = randomUUID();
      const results = await Promise.all(Array.from({ length: 10 }, () => deposit(who, { requestId })));
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await t.db.select().from(deposits).where(eq(deposits.userId, who.userId))).toHaveLength(1);
    });
  });

  describe('own account numbers', () => {
    it('are issued in the verified legal name, not the name typed in the profile', async () => {
      const who = await customer();
      await t.db
        .update(customerVerifications)
        .set({ legalName: 'Chioma Adaeze Nwosu' })
        .where(eq(customerVerifications.userId, who.userId));
      const res = await request(t.http)
        .post('/v1/wallet/fixed-account')
        .set(who.headers)
        .send({ bvn: '22212345678' })
        .expect(201);
      expect(res.body.accountName).toBe('Jiffo Chioma Nwosu');
    });

    it('take only a few failed tries a day, and say why in general terms', async () => {
      const who = await customer();
      const issue = (bvn: string) => request(t.http).post('/v1/wallet/fixed-account').set(who.headers).send({ bvn });
      for (let i = 0; i < 3; i++) {
        const failed = (await issue('22212340000').expect(201)).body;
        expect(failed.status).toBe('failed');
        // The provider's own words stay with support.
        expect(failed.failureReason).not.toContain('BVN not found');
      }
      const blocked = await issue('22212345678');
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('too_many_tries');
      const [row] = await t.db.select().from(fixedAccounts).where(eq(fixedAccounts.userId, who.userId));
      expect(row!.failureReason).toBe('BVN not found');
      expect((await balanceOf(t, who)).balanceKobo).toBe(0);
    });
  });
});
