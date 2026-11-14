import { and, eq, gt } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { deposits, fixedAccounts, providerEvents, settingsVersions } from '../src/db/schema';
import { LedgerService } from '../src/money/ledger.service';
import { ReconciliationService } from '../src/money/reconciliation.service';
import { WalletService } from '../src/money/wallet.service';
import { adminAs, balanceOf, createTestApp, deliverWebhook, signIn, type Person, type TestApp } from './helpers';

const BVN = '22212345678';

describe('adding money: own account numbers', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let finance: Awaited<ReturnType<typeof adminAs>>;
  let original: { version: number };

  beforeAll(async () => {
    t = await createTestApp();
    [owner, finance] = await Promise.all([adminAs(t, 'owner'), adminAs(t, 'finance')]);
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
  });
  afterAll(async () => {
    t.payments.fixedAccountFeeKobo = 0;
    t.payments.fixedAccountsWait = false;
    await t.db
      .delete(settingsVersions)
      .where(and(eq(settingsVersions.countryCode, 'NG'), gt(settingsVersions.version, original.version)));
    await t.close();
  });
  beforeEach(() => {
    t.payments.fixedAccountFeeKobo = 0;
    t.payments.fixedAccountsWait = false;
  });

  /** Saves how customers add money, as admin does in the panel. */
  async function topUps(oneTimeAccount: boolean, fixedAccount: boolean, expect = 200) {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    settings.topUps = { oneTimeAccount, fixedAccount };
    return request(t.http)
      .post('/v1/admin/settings?country=NG')
      .set(owner.headers)
      .send({ basedOn: now.version, settings, note: 'Ways to add money for a test' })
      .expect(expect);
  }

  const options = (who: Person) => request(t.http).get('/v1/wallet/top-up').set(who.headers);
  const issue = (who: Person, body: object = { bvn: BVN }) =>
    request(t.http).post('/v1/wallet/fixed-account').set(who.headers).send(body);
  const trialBalance = () => t.app.get(WalletService).trialBalance();
  const providerFees = () => t.app.get(LedgerService).balance(t.db, { type: 'provider_fees' }, 'NG');
  const accountOf = async (who: Person) =>
    (await t.db.select().from(fixedAccounts).where(eq(fixedAccounts.userId, who.userId)))[0]!;
  /** Our reference for the customer's account at the provider, which its transfers carry. */
  const ownerRef = async (who: Person) => (await accountOf(who)).ownerRef;
  async function customer() {
    const who = await signIn(t, 'customer');
    await request(t.http).patch('/v1/me').set(who.headers).send({ lastName: 'Okafor' }).expect(200);
    return who;
  }

  it('is off until admin turns it on, and one-time account numbers are the default', async () => {
    const who = await customer();
    expect((await options(who).expect(200)).body).toEqual({
      oneTimeAccount: true,
      fixedAccount: { available: false, needs: 'bvn', account: null },
    });
    expect((await issue(who).expect(409)).body.error.code).toBe('fixed_accounts_off');
  });

  it('keeps at least one way to add money in the settings', async () => {
    const res = await topUps(false, false, 400);
    expect(JSON.stringify(res.body)).toContain('Keep at least one way to add money');
  });

  it('issues a verified customer their own account number, once', async () => {
    await topUps(true, true);
    const who = await customer();
    expect((await options(who).expect(200)).body.fixedAccount).toEqual({
      available: true,
      needs: 'bvn',
      account: null,
    });
    // What the provider needs is asked for.
    expect((await issue(who, {}).expect(422)).body.error.code).toBe('bvn_required');
    expect((await issue(who, { bvn: '123' }).expect(400)).body.error.code).toBe('invalid_request');

    const res = await issue(who).expect(201);
    expect(res.body).toMatchObject({
      status: 'active',
      accountNumber: expect.stringMatching(/^\d{10}$/),
      accountName: 'Jiffo Ada Okafor',
      bankName: 'Test Bank',
      failureReason: null,
    });
    // Asking again gives the same account, not a second one.
    expect((await issue(who).expect(201)).body.accountNumber).toBe(res.body.accountNumber);
    expect((await options(who).expect(200)).body.fixedAccount.account).toMatchObject({
      status: 'active',
      accountNumber: res.body.accountNumber,
    });
    // The BVN went to the provider and wasn't kept.
    const [row] = await t.db.select().from(fixedAccounts).where(eq(fixedAccounts.userId, who.userId));
    expect(JSON.stringify(row)).not.toContain(BVN);
  });

  it('is only for verified customers, in the customer app', async () => {
    await topUps(true, true);
    const unverified = await signIn(t, 'customer', { unverified: true });
    expect((await issue(unverified).expect(403)).body.error.code).toBe('identity_required');
    const agent = await signIn(t, 'agent');
    expect((await issue(agent).expect(403)).body.error.code).toBe('wrong_app');
  });

  it('says why the provider could not issue one, and lets the customer try again', async () => {
    await topUps(true, true);
    const who = await customer();
    // The fake provider can't find a BVN ending in 0000.
    expect((await issue(who, { bvn: '22212340000' }).expect(201)).body).toMatchObject({
      status: 'failed',
      failureReason: 'BVN not found',
      accountNumber: null,
    });
    expect((await issue(who).expect(201)).body.status).toBe('active');
  });

  it('credits any transfer into the account, once, whatever the amount', async () => {
    await topUps(true, true);
    const who = await customer();
    const account = (await issue(who).expect(201)).body;

    const hook = t.payments.payFixed(await ownerRef(who), 2_345_600, 'ADA OKAFOR');
    expect((await deliverWebhook(t, hook).expect(200)).body).toEqual({ received: true });
    expect((await balanceOf(t, who)).balanceKobo).toBe(2_345_600);
    // Delivered again: acknowledged, not applied twice.
    expect((await deliverWebhook(t, hook).expect(200)).body).toEqual({ received: true, duplicate: true });
    expect((await balanceOf(t, who)).balanceKobo).toBe(2_345_600);

    // A second transfer is a second top-up; the minimum for one-time top-ups doesn't apply.
    await deliverWebhook(t, t.payments.payFixed(await ownerRef(who), 5_000, 'SOMEONE ELSE')).expect(200);
    expect((await balanceOf(t, who)).balanceKobo).toBe(2_350_600);

    const list = (await request(t.http).get('/v1/wallet/deposits').set(who.headers).expect(200)).body;
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      method: 'fixed',
      status: 'succeeded',
      paidKobo: 5_000,
      accountNumber: account.accountNumber,
      expiresAt: null,
      expired: false,
    });
    const [mismatched] = await t.db.select().from(deposits).where(eq(deposits.id, list[0].id));
    expect(mismatched!.senderMismatch).toBe(true);
    expect((await t.db.select().from(deposits).where(eq(deposits.id, list[1].id)))[0]!.senderMismatch).toBe(false);

    const history = (await request(t.http).get('/v1/wallet/transactions').set(who.headers).expect(200)).body;
    expect(history[0]).toMatchObject({ kind: 'fixed_deposit', label: 'Bank transfer to your account number' });
    expect(await trialBalance()).toBe(0);
  });

  it('keeps crediting an account after admin turns own account numbers off', async () => {
    await topUps(true, true);
    const who = await customer();
    await issue(who).expect(201);
    await topUps(true, false);
    // No new ones are issued, but this one still takes transfers, so the customer still sees it.
    expect((await options(who).expect(200)).body.fixedAccount).toMatchObject({
      available: false,
      account: { status: 'active' },
    });
    // Another customer, with none, isn't offered one.
    expect((await options(await customer()).expect(200)).body.fixedAccount).toMatchObject({ account: null });
    await deliverWebhook(t, t.payments.payFixed(await ownerRef(who), 100_000)).expect(200);
    expect((await balanceOf(t, who)).balanceKobo).toBe(100_000);
  });

  it('answers not done for a transfer to an account it does not know, so the provider tries again', async () => {
    const hook = t.payments.payFixed('jva-00000000-0000-4000-8000-000000000000', 100_000);
    await deliverWebhook(t, hook).expect(500);
    const event = JSON.parse(hook.body.toString()) as { event: string; data: { id: number } };
    const [stored] = await t.db
      .select()
      .from(providerEvents)
      .where(eq(providerEvents.eventKey, `${event.event}:${event.data.id}`));
    expect(stored).toMatchObject({ processedAt: null, error: expect.stringContaining('unknown fixed account') });
  });

  it('waits while the provider identifies the customer, and tells them when the number is ready', async () => {
    await topUps(true, true);
    t.payments.fixedAccountsWait = true;
    const who = await customer();
    const token = `fixed-account-push-${who.userId}`;
    await request(t.http).put('/v1/devices/current/push-token').set(who.headers).send({ token }).expect(204);
    expect((await issue(who).expect(201)).body).toMatchObject({ status: 'pending', accountNumber: null });
    // A second tap while it waits doesn't ask the provider again.
    expect((await issue(who).expect(201)).body.status).toBe('pending');

    await deliverWebhook(t, t.payments.assignFixed(await ownerRef(who))).expect(200);
    expect((await options(who).expect(200)).body.fixedAccount.account).toMatchObject({
      status: 'active',
      accountNumber: expect.stringMatching(/^\d{10}$/),
    });
    expect(t.push.sent.filter((p) => p.token === token).at(-1)).toMatchObject({
      title: 'Your account number is ready',
    });
  });

  it('catches up on a missed assignment on the nightly check', async () => {
    await topUps(true, true);
    t.payments.fixedAccountsWait = true;
    const who = await customer();
    await issue(who).expect(201);
    t.payments.assignFixed(await ownerRef(who)); // The webhook never arrives.
    // Old enough to be asked about again.
    await t.db
      .update(fixedAccounts)
      .set({ updatedAt: new Date(Date.now() - 60_000) })
      .where(eq(fixedAccounts.userId, who.userId));
    await t.app.get(ReconciliationService).run();
    const [row] = await t.db.select().from(fixedAccounts).where(eq(fixedAccounts.userId, who.userId));
    expect(row!.status).toBe('active');
  });

  it('books what issuing costs, and counts it against revenue', async () => {
    await topUps(true, true);
    t.payments.fixedAccountFeeKobo = 5_000;
    const before = (
      await request(t.http).get('/v1/admin/money/summary?country=NG&days=1').set(finance.headers).expect(200)
    ).body;
    const feesBefore = await providerFees();
    const balanceBefore = t.payments.providerBalanceKobo;

    const who = await customer();
    await issue(who).expect(201);
    await issue(who).expect(201); // The same account: charged once.
    expect((await providerFees()) - feesBefore).toBe(5_000);
    // Taken from the balance the provider holds for Jiffo, so the nightly check still agrees.
    expect(balanceBefore - t.payments.providerBalanceKobo).toBe(5_000);
    const [row] = await t.db.select().from(fixedAccounts).where(eq(fixedAccounts.userId, who.userId));
    expect(row!.issueFeeKobo).toBe(5_000);

    // A transfer in: the provider's fee on it is a cost too, and the customer gets all of it.
    await deliverWebhook(t, t.payments.payFixed(await ownerRef(who), 1_000_000, 'ADA OKAFOR')).expect(200);
    expect((await balanceOf(t, who)).balanceKobo).toBe(1_000_000);

    const after = (
      await request(t.http).get('/v1/admin/money/summary?country=NG&days=1').set(finance.headers).expect(200)
    ).body;
    const charge = (body: typeof after, kind: string) =>
      (body.providerCharges as Array<{ kind: string; kobo: number }>).find((c) => c.kind === kind)?.kobo ?? 0;
    expect(charge(after, 'fixed_account') - charge(before, 'fixed_account')).toBe(5_000);
    expect(after.providerCharges.find((c: { kind: string }) => c.kind === 'fixed_account').label).toBe(
      'Own account numbers issued',
    );
    const inboundFee = charge(after, 'fixed_deposit') - charge(before, 'fixed_deposit');
    expect(inboundFee).toBeGreaterThan(0);
    expect(after.fixedAccounts.issued - before.fixedAccounts.issued).toBe(1);
    expect(after.fixedAccounts.issueCostKobo - before.fixedAccounts.issueCostKobo).toBe(5_000);
    expect(after.fixedAccounts.active).toBeGreaterThan(0);
    expect(after.topUps.fixed.count - before.topUps.fixed.count).toBe(1);
    expect(after.topUps.fixed.feesKobo - before.topUps.fixed.feesKobo).toBe(inboundFee);
    expect(after.topUps.count).toBe(after.topUps.oneTime.count + after.topUps.fixed.count);

    // Net revenue is revenue less every provider charge, in the window and since the start.
    expect(after.earnings.providerChargesKobo - before.earnings.providerChargesKobo).toBe(5_000 + inboundFee);
    expect(after.earnings.netRevenueKobo).toBe(after.earnings.revenueKobo - after.earnings.providerChargesKobo);
    expect(after.platform.netRevenueKobo).toBe(after.platform.revenueKobo - after.platform.providerFeesKobo);
    const today = after.daily.at(-1);
    expect(today.netKobo).toBe(today.revenueKobo - today.chargesKobo);

    const overview = (await request(t.http).get('/v1/admin/overview?country=NG').set(finance.headers).expect(200)).body;
    expect(overview.today.providerCostsKobo).toBeGreaterThanOrEqual(5_000 + inboundFee);
    expect(overview.today.netRevenueKobo).toBe(overview.today.revenueKobo - overview.today.providerCostsKobo);
    expect(overview.week.at(-1).netRevenueKobo).toBe(overview.week.at(-1).revenueKobo - overview.week.at(-1).costsKobo);
    expect(await trialBalance()).toBe(0);
  });

  it('stops one-time account numbers when admin turns them off', async () => {
    await topUps(false, true);
    const who = await customer();
    expect((await options(who).expect(200)).body.oneTimeAccount).toBe(false);
    const res = await request(t.http).post('/v1/wallet/deposits').set(who.headers).send({ amountKobo: 1_000_000 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('one_time_accounts_off');
    await topUps(true, false);
  });

  it('never leaves customers without a way to add money', async () => {
    await topUps(false, true);
    const who = await customer();
    const issueFixedAccount = t.payments.issueFixedAccount.bind(t.payments);
    try {
      // The provider in use stops issuing own account numbers: one-time ones are offered again.
      (t.payments as { issueFixedAccount?: unknown }).issueFixedAccount = undefined;
      expect((await options(who).expect(200)).body).toMatchObject({
        oneTimeAccount: true,
        fixedAccount: { available: false },
      });
      await request(t.http).post('/v1/wallet/deposits').set(who.headers).send({ amountKobo: 1_000_000 }).expect(201);
      // And admin can't save one-time account numbers off while it doesn't issue them.
      await topUps(true, true);
      const res = await topUps(false, true, 400);
      expect(JSON.stringify(res.body)).toContain("doesn't issue customers their own account numbers");
    } finally {
      t.payments.issueFixedAccount = issueFixedAccount;
    }
    await topUps(true, false);
  });

  it('credits a transfer into an account from an earlier attempt to the same customer', async () => {
    await topUps(true, true);
    const who = await customer();
    await issue(who).expect(201);
    // An account the provider issued although its answer was lost carries that attempt's reference.
    await deliverWebhook(t, t.payments.payFixed(`jva-${who.userId}-earlier`, 70_000)).expect(200);
    expect((await balanceOf(t, who)).balanceKobo).toBe(70_000);
  });

  it('lets the customer try again when the provider could not be reached, as a new attempt', async () => {
    await topUps(true, true);
    const who = await customer();
    const spy = vi.spyOn(t.payments, 'issueFixedAccount').mockRejectedValueOnce(new Error('socket hang up'));
    try {
      expect((await issue(who).expect(503)).body.error.code).toBe('provider_unavailable');
      const first = await accountOf(who);
      expect(first).toMatchObject({ status: 'failed', checkingUntil: null });
      expect((await issue(who).expect(201)).body.status).toBe('active');
      // A provider never sees the same reference twice.
      expect((await accountOf(who)).ownerRef).not.toBe(first.ownerRef);
    } finally {
      spy.mockRestore();
    }
  });

  it('asks again for an account whose answer was lost, once it has waited long enough', async () => {
    await topUps(true, true);
    const who = await customer();
    await t.db.insert(fixedAccounts).values({
      userId: who.userId,
      countryCode: 'NG',
      provider: t.payments.name,
      ownerRef: `jva-${who.userId}-lost`,
      status: 'pending',
    });
    // Too soon: it may still be on its way.
    expect((await issue(who).expect(201)).body.status).toBe('pending');
    await t.db
      .update(fixedAccounts)
      .set({ updatedAt: new Date(Date.now() - 5 * 60_000) })
      .where(eq(fixedAccounts.userId, who.userId));
    expect((await issue(who).expect(201)).body.status).toBe('active');
  });

  it('has one request at a time ask the provider about an account', async () => {
    await topUps(true, true);
    t.payments.fixedAccountsWait = true;
    const who = await customer();
    await issue(who).expect(201);
    // Another request is asking: the event is answered as not done, so the provider delivers it again.
    await t.db
      .update(fixedAccounts)
      .set({ checkingUntil: new Date(Date.now() + 60_000) })
      .where(eq(fixedAccounts.userId, who.userId));
    const hook = t.payments.assignFixed(await ownerRef(who));
    await deliverWebhook(t, hook).expect(500);
    await t.db.update(fixedAccounts).set({ checkingUntil: null }).where(eq(fixedAccounts.userId, who.userId));
    await deliverWebhook(t, hook).expect(200);
    expect((await accountOf(who)).status).toBe('active');
  });

  it('lists banks for customers too', async () => {
    const who = await customer();
    const banks = (await request(t.http).get('/v1/banks').set(who.headers).expect(200)).body;
    expect(banks.length).toBeGreaterThan(0);
  });
});
