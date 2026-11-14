import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deposits } from '../src/db/schema';
import { LedgerService } from '../src/money/ledger.service';
import { ReconciliationService } from '../src/money/reconciliation.service';
import { WalletService } from '../src/money/wallet.service';
import {
  act,
  adminAs,
  balanceOf,
  clearReconciliationPauses,
  createErrand,
  createTestApp,
  deliverWebhook,
  fund,
  photo,
  signIn,
  type Person,
  type TestApp,
  approved,
} from './helpers';

/** Fee 250,000 kobo; service fee 10% = 25,000; Bronze commission 15% = 37,500. */
const FEE = 250_000;
const SERVICE = 25_000;
const COMMISSION = 37_500;

/** 50 copies of a request at once. */
const burst = <T>(make: () => Promise<T>, n = 50) => Promise.all(Array.from({ length: n }, make));
/**
 * How many of a burst went through. The rest must be clean refusals (409) or repeats answered the same,
 * never errors: a deadlock or a unique-key crash under load counts as a failure.
 */
const succeeded = (results: Array<{ status: number }>, refusals = [409]) => {
  expect(results.map((r) => r.status).filter((s) => s >= 300 && !refusals.includes(s))).toEqual([]);
  return results.filter((r) => r.status < 300).length;
};

describe('ledger guards', () => {
  let t: TestApp;
  let finance: Awaited<ReturnType<typeof adminAs>>;
  let ops: Awaited<ReturnType<typeof adminAs>>;

  beforeAll(async () => {
    t = await createTestApp();
    [finance, ops] = await Promise.all([adminAs(t, 'finance'), adminAs(t, 'operations')]);
  });
  afterAll(() => t.close());

  const trialBalance = () => t.app.get(WalletService).trialBalance();
  const event = (who: Person, id: string, name: string, data: Record<string, unknown> = {}) =>
    request(t.http).post(`/v1/errands/${id}/events`).set(who.headers).send({ event: name, data });
  const pinOf = async (customer: Person, id: string) =>
    (await request(t.http).get(`/v1/errands/${id}/pin`).set(customer.headers).expect(200)).body.pin as string;
  async function agent() {
    const who = await signIn(t, 'agent');
    await request(t.http).patch('/v1/me').set(who.headers).send({ lastName: 'Bakare' }).expect(200);
    return who;
  }
  async function customer(kobo = 2_000_000) {
    const who = await signIn(t, 'customer');
    await fund(t, who, kobo);
    return who;
  }

  describe('the database itself', () => {
    it('never lets a journal row be changed or deleted', async () => {
      await customer(); // at least one journal
      for (const statement of [
        sql`update postings set amount = amount where id = (select id from postings limit 1)`,
        sql`delete from postings where id = (select id from postings limit 1)`,
        sql`update journal_entries set memo = 'changed' where id = (select id from journal_entries limit 1)`,
        sql`delete from journal_entries where id = (select id from journal_entries limit 1)`,
        sql`truncate postings, journal_entries cascade`,
      ]) {
        await expect(t.db.execute(statement)).rejects.toThrow(/append-only/);
      }
    });

    it('never lets a person’s balance go below zero', async () => {
      const who = await customer();
      await expect(
        t.db.execute(sql`update ledger_accounts set balance = -1 where owner_id = ${who.userId}`),
      ).rejects.toThrow(/ledger_accounts_balance_ck/);
    });
  });

  describe('50 identical requests at once move money once', () => {
    it('a top-up webhook', async () => {
      const who = await signIn(t, 'customer');
      const res = await request(t.http)
        .post('/v1/wallet/deposits')
        .set(who.headers)
        .send({ amountKobo: 500_000 })
        .expect(201);
      const [row] = await t.db.select().from(deposits).where(eq(deposits.id, res.body.id));
      const hook = t.payments.pay(row!.reference);
      const results = await burst(() => deliverWebhook(t, hook));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect((await balanceOf(t, who)).balanceKobo).toBe(500_000);
    });

    it('accepting an errand', async () => {
      const buyer = await customer();
      const errand = await createErrand(t, buyer);
      const agents = await Promise.all(Array.from({ length: 10 }, agent));
      const results = await burst(() => event(agents[Math.floor(Math.random() * agents.length)]!, errand.id, 'accept'));
      // Once taken, the errand is gone for other agents (404).
      expect(succeeded(results, [409, 404])).toBe(1);
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(2_000_000 - FEE - SERVICE);
      expect(await trialBalance()).toBe(0);
    });

    it('accepting a counter-offer', async () => {
      const buyer = await customer();
      const runner = await agent();
      const errand = await createErrand(t, buyer);
      await act(t, runner, errand.id, 'accept');
      await act(t, runner, errand.id, 'send_offer', { amountKobo: 400_000 });
      const results = await burst(() => event(buyer, errand.id, 'accept_offer'));
      expect(succeeded(results)).toBe(1);
      // The fee rose once, from 250,000 to 400,000, with the service fee on the new fee.
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(2_000_000 - 400_000 - 40_000);
    });

    it('locking item money', async () => {
      const buyer = await customer(5_000_000);
      const runner = await agent();
      const errand = await createErrand(t, buyer, { categoryKey: 'groceries' });
      await act(t, runner, errand.id, 'accept');
      await act(t, runner, errand.id, 'start');
      await act(t, runner, errand.id, 'send_item_amount', {
        amountKobo: 1_000_000,
        photos: [await photo(t, runner, errand.id, 'receipt')],
      });
      const results = await burst(() => event(buyer, errand.id, 'lock_item_amount'));
      expect(succeeded(results)).toBe(1);
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(5_000_000 - FEE - SERVICE - 1_000_000);
    });

    it('entering the hand-off PIN', async () => {
      const buyer = await customer();
      const runner = await agent();
      const errand = await createErrand(t, buyer);
      await act(t, runner, errand.id, 'accept');
      await act(t, runner, errand.id, 'start');
      await act(t, runner, errand.id, 'mark_delivered');
      const pin = await pinOf(buyer, errand.id);
      const results = await burst(() => event(runner, errand.id, 'confirm_pin', { pin }));
      expect(succeeded(results)).toBe(1);
      expect((await balanceOf(t, runner)).heldKobo).toBe(FEE - COMMISSION);
      expect(await trialBalance()).toBe(0);
    });

    it('a tip', async () => {
      const buyer = await customer();
      const runner = await agent();
      const errand = await createErrand(t, buyer);
      await act(t, runner, errand.id, 'accept');
      await act(t, runner, errand.id, 'start');
      await act(t, runner, errand.id, 'mark_delivered');
      await act(t, runner, errand.id, 'confirm_pin', { pin: await pinOf(buyer, errand.id) });
      const before = (await balanceOf(t, buyer)).balanceKobo;
      const results = await burst(() =>
        request(t.http).post(`/v1/errands/${errand.id}/tip`).set(buyer.headers).send({ amountKobo: 50_000 }),
      );
      expect(succeeded(results)).toBe(1);
      expect(before - (await balanceOf(t, buyer)).balanceKobo).toBe(50_000);
    });

    it('an admin adjustment', async () => {
      const who = await signIn(t, 'customer');
      const body = {
        personId: who.userId,
        account: 'customer_wallet',
        direction: 'credit',
        amountKobo: 70_000,
        note: 'Goodwill for a late delivery',
        requestId: randomUUID(),
      };
      // Asked once; then approved by many at once (or one approver's double click): it runs once.
      const asked = await request(t.http)
        .post('/v1/admin/money/adjustments')
        .set(finance.headers)
        .send(body)
        .expect(202);
      const approver = await adminAs(t, 'owner');
      const results = await burst(() =>
        request(t.http).post(`/v1/admin/approvals/${asked.body.approval.id}/approve`).set(approver.headers).send({}),
      );
      expect(succeeded(results)).toBe(1);
      expect(results.filter((r) => r.status !== 200).every((r) => r.status === 409)).toBe(true);
      // The same form sent again and approved too still moves the money once.
      const again = await approved(t, 'finance', (h) =>
        request(t.http).post('/v1/admin/money/adjustments').set(h).send(body),
      );
      expect(again.body).toMatchObject({ posted: false });
      expect((await balanceOf(t, who)).balanceKobo).toBe(70_000);
    });

    it('settling a dispute', async () => {
      const buyer = await customer();
      const runner = await agent();
      const errand = await createErrand(t, buyer);
      await act(t, runner, errand.id, 'accept');
      await act(t, runner, errand.id, 'start');
      await act(t, buyer, errand.id, 'open_dispute', { reason: 'The agent went to the wrong shop' });
      const version = (await request(t.http).get(`/v1/admin/errands/${errand.id}`).set(ops.headers).expect(200)).body
        .errand.version;
      const results = await burst(() =>
        request(t.http)
          .post(`/v1/admin/errands/${errand.id}/actions`)
          .set(ops.headers)
          .send({ event: 'resolve_complete', version, note: 'Delivered fine after all' }),
      );
      expect(succeeded(results)).toBe(1);
      expect((await balanceOf(t, runner)).heldKobo).toBe(FEE - COMMISSION);
      expect(await trialBalance()).toBe(0);
    });
  });

  describe('revenue', () => {
    it('raises an alert when platform revenue goes below zero', async () => {
      const who = await signIn(t, 'customer');
      const revenue = await t.app.get(LedgerService).balance(t.db, { type: 'platform_revenue' }, 'NG');
      // Goodwill credits bigger than everything earned so far.
      const adjust = async (direction: 'credit' | 'debit') =>
        expect(
          (
            await approved(t, 'finance', (h) =>
              request(t.http)
                .post('/v1/admin/money/adjustments')
                .set(h)
                .send({
                  personId: who.userId,
                  account: 'customer_wallet',
                  direction,
                  amountKobo: Math.max(0, revenue) + 100_000,
                  note: 'Goodwill bigger than revenue',
                  requestId: randomUUID(),
                }),
            )
          ).status,
        ).toBe(200);
      const open = async () =>
        (
          (await request(t.http).get('/v1/admin/alerts?country=NG').set(finance.headers).expect(200)).body
            .alerts as Array<{
            kind: string;
            resolvedAt: string | null;
          }>
        ).some((a) => a.kind === 'revenue_negative' && !a.resolvedAt);
      await adjust('credit');
      await t.app.get(ReconciliationService).run();
      await clearReconciliationPauses(t);
      expect(await open()).toBe(true);
      // Taken back, so the files after this one start from where revenue was. The alert closes by itself
      // once revenue is back above zero (other files in the run may already have taken it below).
      await adjust('debit');
      await t.app.get(ReconciliationService).run();
      await clearReconciliationPauses(t);
      expect(await open()).toBe(revenue < 0);
    });
  });

  describe('frozen escrow', () => {
    const intervene = async (id: string) => {
      const version = (await request(t.http).get(`/v1/admin/errands/${id}`).set(ops.headers).expect(200)).body.errand
        .version;
      return request(t.http)
        .post(`/v1/admin/errands/${id}/actions`)
        .set(ops.headers)
        .send({ event: 'admin_intervene', version, note: 'Looks like fraud, holding it' });
    };

    it('can be frozen by admin at any point while money is held, and then only admin moves it', async () => {
      const buyer = await customer();
      const runner = await agent();
      const errand = await createErrand(t, buyer);
      await act(t, runner, errand.id, 'accept');
      expect((await intervene(errand.id)).status).toBe(200);
      // Nobody else can move the money now.
      await act(t, runner, errand.id, 'start', {}, 409);
      await act(t, buyer, errand.id, 'cancel', {}, 409);
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(2_000_000 - FEE - SERVICE);

      const delivered = await createErrand(t, buyer);
      await act(t, runner, delivered.id, 'accept');
      await act(t, runner, delivered.id, 'start');
      await act(t, runner, delivered.id, 'mark_delivered');
      const pin = await pinOf(buyer, delivered.id);
      expect((await intervene(delivered.id)).status).toBe(200);
      await act(t, runner, delivered.id, 'confirm_pin', { pin }, 409);
      await act(
        t,
        runner,
        delivered.id,
        'send_dropoff_photo',
        { photo: await photo(t, runner, delivered.id, 'dropoff_photo') },
        409,
      );
      expect(await trialBalance()).toBe(0);
    });
  });
});
