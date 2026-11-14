import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { deposits as depositsTable } from '../src/db/schema';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WalletService } from '../src/money/wallet.service';
import {
  act,
  adminAs,
  balanceOf,
  createErrand,
  createTestApp,
  fund,
  signIn,
  type Person,
  type TestApp,
  clearReconciliationPauses,
} from './helpers';

type Admin = Awaited<ReturnType<typeof adminAs>>;

describe('admin money', () => {
  let t: TestApp;
  let finance: Admin;
  let ops: Admin;
  let support: Admin;
  let owner: Admin;
  let customer: Person;
  let agent: Person;

  beforeAll(async () => {
    t = await createTestApp();
    [finance, ops, support, owner] = await Promise.all([
      adminAs(t, 'finance'),
      adminAs(t, 'operations'),
      adminAs(t, 'support'),
      adminAs(t, 'owner'),
    ]);
    customer = await signIn(t, 'customer');
    agent = await signIn(t, 'agent');
    await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName: 'Bakare' }).expect(200);
    await fund(t, customer, 3_000_000);
  });
  afterAll(() => t.close());

  const get = (path: string, who: Admin = support) => request(t.http).get(`/v1/admin/money/${path}`).set(who.headers);
  const adjust = (body: Record<string, unknown>, who: Admin = finance) =>
    request(t.http)
      .post('/v1/admin/money/adjustments')
      .set(who.headers)
      .send({ requestId: randomUUID(), note: 'Goodwill for a late delivery', ...body });
  const trialBalance = () => t.app.get(WalletService).trialBalance();

  it('sums what Jiffo holds and earns, and where it came from', async () => {
    // Other files in the run move revenue too (adjustments come out of it), so this one's change is compared.
    const before = (await get('summary?country=NG&days=7').expect(200)).body;
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'mark_delivered');
    const pin = (await request(t.http).get(`/v1/errands/${errand.id}/pin`).set(customer.headers).expect(200)).body.pin;
    await act(t, agent, errand.id, 'confirm_pin', { pin });

    const res = await get('summary?country=NG&days=7').expect(200);
    expect(res.body.days).toBe(7);
    expect(res.body.daily).toHaveLength(7);
    expect(res.body.held.customerWalletsKobo).toBeGreaterThan(0);
    expect(res.body.held.agentHeldKobo).toBeGreaterThan(0);
    expect(res.body.platform.revenueKobo).toBeGreaterThan(before.platform.revenueKobo);
    // Other tests in the run add their own sources; this run's errand shows as service fees and commission.
    expect(res.body.revenue).toContainEqual(
      expect.objectContaining({ kind: 'settle', label: 'Service fees and commission' }),
    );
    expect(res.body.topUps.count).toBeGreaterThanOrEqual(1);
    // Revenue over the period adds up to the day-by-day series.
    const fromDays = res.body.daily.reduce((s: number, d: { revenueKobo: number }) => s + d.revenueKobo, 0);
    expect(fromDays).toBe(res.body.revenue.reduce((s: number, r: { kobo: number }) => s + r.kobo, 0));
    await get('summary?country=NG&days=500').expect(400);
  });

  it('adjusts balances by hand, for finance and owners only, once per request', async () => {
    const before = (await balanceOf(t, customer)).balanceKobo;
    for (const who of [ops, support])
      expect(
        (
          await adjust(
            { personId: customer.userId, account: 'customer_wallet', direction: 'credit', amountKobo: 50_000 },
            who,
          )
        ).status,
      ).toBe(403);

    const requestId = randomUUID();
    const body = {
      personId: customer.userId,
      account: 'customer_wallet',
      direction: 'credit',
      amountKobo: 50_000,
      requestId,
    };
    expect((await adjust(body)).body).toEqual({ posted: true });
    // The same form submitted twice moves the money once.
    expect((await adjust(body)).body).toEqual({ posted: false });
    expect((await balanceOf(t, customer)).balanceKobo).toBe(before + 50_000);
    const history = await request(t.http).get('/v1/wallet/transactions').set(customer.headers).expect(200);
    const latest = history.body.transactions?.[0] ?? history.body[0];
    expect(latest).toMatchObject({ amountKobo: 50_000, label: 'Adjustment by Jiffo support' });

    // A debit can't take more than is there, nor reach an account the person doesn't have.
    expect(
      (
        await adjust({
          personId: customer.userId,
          account: 'customer_wallet',
          direction: 'debit',
          amountKobo: 999_999_00,
        })
      ).status,
    ).toBe(409);
    expect(
      (await adjust({ personId: customer.userId, account: 'agent_available', direction: 'credit', amountKobo: 1_000 }))
        .body.error.code,
    ).toBe('wrong_account');
    const stranger = await signIn(t, 'customer');
    const theirs = await createErrand(t, (await fund(t, stranger, 1_000_000), stranger));
    expect(
      (
        await adjust({
          personId: customer.userId,
          account: 'customer_wallet',
          direction: 'credit',
          amountKobo: 1_000,
          errandId: theirs.id,
        })
      ).body.error.code,
    ).toBe('errand_not_theirs');
    expect(
      (
        await adjust({
          personId: customer.userId,
          account: 'customer_wallet',
          direction: 'credit',
          amountKobo: 100_000_001,
        })
      ).status,
    ).toBe(400);
    await adjust(
      {
        personId: customer.userId,
        account: 'customer_wallet',
        direction: 'debit',
        amountKobo: 50_000,
        note: 'Reversing the goodwill credit',
      },
      owner,
    ).expect(200);
    expect((await balanceOf(t, customer)).balanceKobo).toBe(before);

    const audit = await request(t.http)
      .get(`/v1/admin/audit?targetType=person&targetId=${customer.userId}`)
      .set(owner.headers)
      .expect(200);
    expect(audit.body.entries.map((e: { action: string }) => e.action)).toEqual(['money.adjust', 'money.adjust']);
    expect(await trialBalance()).toBe(0);
  });

  it('lists top-ups and withdrawals, and finds them by person or reference', async () => {
    const deposits = await get('deposits?country=NG').expect(200);
    const mine = deposits.body.deposits.find((d: { person: { id: string } }) => d.person.id === customer.userId);
    expect(mine).toMatchObject({ status: 'succeeded', paidKobo: 3_000_000 });
    const byRef = await get(`deposits?country=NG&q=${mine.reference}`).expect(200);
    expect(byRef.body.deposits.map((d: { id: string }) => d.id)).toEqual([mine.id]);
    expect((await get('deposits?country=NG&filter=failed').expect(200)).body.deposits).toEqual([]);

    // A top-up nobody paid into reads as expired once its account number has lapsed, not as waiting.
    const open = await request(t.http)
      .post('/v1/wallet/deposits')
      .set(customer.headers)
      .send({ amountKobo: 100_000 })
      .expect(201);
    const ids = async (filter: string) =>
      (await get(`deposits?country=NG&filter=${filter}`).expect(200)).body.deposits.map((d: { id: string }) => d.id);
    expect(await ids('pending')).toContain(open.body.id);
    await t.db
      .update(depositsTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(depositsTable.id, open.body.id));
    expect(await ids('pending')).not.toContain(open.body.id);
    expect(await ids('expired')).toContain(open.body.id);
    const all = (await get('deposits?country=NG').expect(200)).body.deposits;
    expect(all.find((d: { id: string }) => d.id === open.body.id).status).toBe('expired');

    // The agent withdraws to their own account.
    await adjust({
      personId: agent.userId,
      account: 'agent_available',
      direction: 'credit',
      amountKobo: 200_000,
      note: 'Bonus for the launch week',
    }).expect(200);
    t.payments.accounts.set('058:0123456789', 'TUNDE BAKARE');
    await request(t.http)
      .put('/v1/payout-account')
      .set(agent.headers)
      .send({ bankCode: '058', accountNumber: '0123456789' })
      .expect(200);
    const sent = await request(t.http)
      .post('/v1/wallet/withdrawals')
      .set(agent.headers)
      .send({ requestId: randomUUID(), amountKobo: 100_000, speed: 'instant' })
      .expect(201);
    const payouts = await get('payouts?country=NG&filter=pending').expect(200);
    expect(payouts.body.payouts.find((p: { id: string }) => p.id === sent.body.id)).toMatchObject({
      status: 'processing',
      speed: 'instant',
      feeKobo: 10_000,
      accountLast4: '6789',
      person: { id: agent.userId },
    });
    expect(JSON.stringify(payouts.body)).not.toContain('0123456789');
  });

  it('shows the nightly checks', async () => {
    await t.jobs.run('reconcile.daily');
    await clearReconciliationPauses(t);
    const runs = await get('reconciliation?country=NG').expect(200);
    expect(runs.body[0]).toMatchObject({ countryCode: 'NG', provider: expect.any(String) });
  });
});
