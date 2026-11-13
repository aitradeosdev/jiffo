import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deposits, earningHolds, ledgerAccounts, payouts } from '../src/db/schema';
import { WalletService } from '../src/money/wallet.service';
import { LedgerService } from '../src/money/ledger.service';
import {
  act,
  balanceOf,
  createErrand,
  createTestApp,
  photo,
  deliverWebhook,
  fund,
  signIn,
  type Person,
  type TestApp,
} from './helpers';

/** Fee 250,000 kobo; service fee 10% = 25,000; Bronze commission 15% = 37,500. */
const FEE = 250_000;
const SERVICE = 25_000;
const COMMISSION = 37_500;

describe('money', () => {
  let t: TestApp;
  let customer: Person;
  let agent: Person;

  beforeAll(async () => {
    t = await createTestApp();
    [customer, agent] = await Promise.all([signIn(t, 'customer'), signIn(t, 'agent')]);
  });
  afterAll(() => t.close());

  const trialBalance = () => t.app.get(WalletService).trialBalance();
  const revenue = () => t.app.get(LedgerService).balance(t.db, { type: 'platform_revenue' }, 'NG');
  const referenceOf = async (depositId: string) =>
    (await t.db.select().from(deposits).where(eq(deposits.id, depositId)))[0]!.reference;
  const runToDelivered = async (id: string) => {
    await act(t, agent, id, 'accept');
    await act(t, agent, id, 'start');
  };
  const pin = async (person: Person, id: string) =>
    (await request(t.http).get(`/v1/errands/${id}/pin`).set(person.headers).expect(200)).body.pin as string;

  describe('deposits', () => {
    it('gives a one-time account number and credits the wallet once the transfer lands', async () => {
      const person = await signIn(t, 'customer');
      const res = await request(t.http)
        .post('/v1/wallet/deposits')
        .set(person.headers)
        .send({ amountKobo: 1_000_000 })
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'pending',
        expired: false,
        amountKobo: 1_000_000,
        accountNumber: expect.any(String),
        bankName: expect.any(String),
      });
      expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
      expect((await balanceOf(t, person)).balanceKobo).toBe(0);

      const hook = t.payments.pay(await referenceOf(res.body.id));
      expect((await deliverWebhook(t, hook).expect(200)).body).toEqual({ received: true });
      expect((await balanceOf(t, person)).balanceKobo).toBe(1_000_000);

      // Paystack delivers the same event again: acknowledged, not applied twice.
      expect((await deliverWebhook(t, hook).expect(200)).body).toEqual({ received: true, duplicate: true });
      expect((await balanceOf(t, person)).balanceKobo).toBe(1_000_000);

      const history = await request(t.http).get('/v1/wallet/transactions').set(person.headers).expect(200);
      expect(history.body[0]).toMatchObject({ kind: 'deposit', label: 'Bank transfer top-up', amountKobo: 1_000_000 });
      expect(await trialBalance()).toBe(0);
    });

    it('lets the development auto-pay credit the wallet with no screen open', async () => {
      const person = await signIn(t, 'customer');
      const res = await request(t.http)
        .post('/v1/wallet/deposits')
        .set(person.headers)
        .send({ amountKobo: 400_000 })
        .expect(201);
      // What auto-pay does once its delay passes.
      t.payments.pay(await referenceOf(res.body.id));
      t.payments.onAutoPaid?.(await referenceOf(res.body.id));
      await expect.poll(async () => (await balanceOf(t, person)).balanceKobo).toBe(400_000);
    });

    it('refuses webhooks with a wrong signature', async () => {
      const person = await signIn(t, 'customer');
      const res = await request(t.http)
        .post('/v1/wallet/deposits')
        .set(person.headers)
        .send({ amountKobo: 500_000 })
        .expect(201);
      const hook = t.payments.pay(await referenceOf(res.body.id));
      const forged = await deliverWebhook(t, { body: hook.body, signature: 'f'.repeat(128) }).expect(401);
      expect(forged.body.error.code).toBe('invalid_signature');
      expect((await balanceOf(t, person)).balanceKobo).toBe(0);
    });

    it('credits what arrived, and catches up on a missed webhook when the app checks', async () => {
      const person = await signIn(t, 'customer');
      const res = await request(t.http)
        .post('/v1/wallet/deposits')
        .set(person.headers)
        .send({ amountKobo: 800_000 })
        .expect(201);
      t.payments.pay(await referenceOf(res.body.id), { amountKobo: 750_000, senderName: 'SOMEONE ELSE' });
      // No webhook: the app polls the deposit.
      const polled = await request(t.http).get(`/v1/wallet/deposits/${res.body.id}`).set(person.headers).expect(200);
      expect(polled.body).toMatchObject({ status: 'succeeded', paidKobo: 750_000 });
      expect((await balanceOf(t, person)).balanceKobo).toBe(750_000);
      const [row] = await t.db.select().from(deposits).where(eq(deposits.id, res.body.id));
      expect(row!.senderMismatch).toBe(true);
    });

    it('keeps an abandoned top-up open, so a late transfer is still credited', async () => {
      const person = await signIn(t, 'customer');
      const res = await request(t.http)
        .post('/v1/wallet/deposits')
        .set(person.headers)
        .send({ amountKobo: 300_000 })
        .expect(201);
      const reference = await referenceOf(res.body.id);
      t.payments.deposits.get(reference)!.status = 'failed'; // Paystack calls the unpaid charge abandoned
      expect(
        (await request(t.http).get(`/v1/wallet/deposits/${res.body.id}`).set(person.headers).expect(200)).body.status,
      ).toBe('pending');

      // The account number expires, the transfer lands late and its webhook is lost.
      await t.db
        .update(deposits)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(deposits.id, res.body.id));
      t.payments.pay(reference);
      await t.jobs.run('reconcile.daily');
      expect((await balanceOf(t, person)).balanceKobo).toBe(300_000);
    });

    it('still shows a pending top-up when the provider is unreachable', async () => {
      const person = await signIn(t, 'customer');
      const res = await request(t.http)
        .post('/v1/wallet/deposits')
        .set(person.headers)
        .send({ amountKobo: 200_000 })
        .expect(201);
      const verify = t.payments.verifyDeposit.bind(t.payments);
      t.payments.verifyDeposit = async () => {
        throw new Error('ECONNRESET');
      };
      try {
        const polled = await request(t.http).get(`/v1/wallet/deposits/${res.body.id}`).set(person.headers).expect(200);
        expect(polled.body).toMatchObject({ status: 'pending', accountNumber: res.body.accountNumber });
      } finally {
        t.payments.verifyDeposit = verify;
      }
    });

    it('checks the amount and keeps deposits to the customer app', async () => {
      const low = await request(t.http)
        .post('/v1/wallet/deposits')
        .set(customer.headers)
        .send({ amountKobo: 5_000 })
        .expect(422);
      expect(low.body.error).toMatchObject({ code: 'deposit_amount_out_of_range', minDepositKobo: 10_000 });
      await request(t.http).post('/v1/wallet/deposits').set(agent.headers).send({ amountKobo: 100_000 }).expect(403);
    });

    it('limits open top-ups per customer', async () => {
      const person = await signIn(t, 'customer');
      for (let i = 0; i < 3; i++) {
        await request(t.http).post('/v1/wallet/deposits').set(person.headers).send({ amountKobo: 100_000 }).expect(201);
      }
      const res = await request(t.http)
        .post('/v1/wallet/deposits')
        .set(person.headers)
        .send({ amountKobo: 100_000 })
        .expect(429);
      expect(res.body.error.code).toBe('too_many_open_deposits');
    });
  });

  describe('errand escrow', () => {
    it('needs the fee and service fee in the wallet before an errand goes out', async () => {
      const broke = await signIn(t, 'customer');
      const res = await request(t.http)
        .post('/v1/errands')
        .set(broke.headers)
        .send({
          categoryKey: 'parcel',
          stateCode: 'LA',
          description: 'A parcel',
          feeKobo: FEE,
          stops: [
            { kind: 'pickup', address: 'Admiralty Way, Lekki', lat: 6.4474, lng: 3.4723 },
            { kind: 'dropoff', address: 'Adeola Odeku, VI', lat: 6.4311, lng: 3.4158 },
          ],
        })
        .expect(409);
      expect(res.body.error).toMatchObject({ code: 'insufficient_funds', neededKobo: FEE + SERVICE, balanceKobo: 0 });
    });

    it('holds the fee on accept, pays the agent at hand-off and keeps the platform share', async () => {
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, 1_000_000);
      const errand = await createErrand(t, buyer);
      expect(errand).toMatchObject({ feeKobo: FEE, serviceFeeKobo: SERVICE });
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(1_000_000); // nothing held before accept

      const before = await revenue();
      await runToDelivered(errand.id);
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(1_000_000 - FEE - SERVICE);
      const view = await request(t.http).get(`/v1/errands/${errand.id}`).set(buyer.headers).expect(200);
      expect(view.body.held).toEqual({ feeKobo: FEE + SERVICE, itemsKobo: 0 });
      await act(t, agent, errand.id, 'mark_delivered');
      await act(t, agent, errand.id, 'confirm_pin', { pin: await pin(buyer, errand.id) });

      expect((await revenue()) - before).toBe(SERVICE + COMMISSION);
      const wallet = await balanceOf(t, agent);
      expect(wallet.tier).toBe('bronze');
      expect(wallet.heldKobo).toBeGreaterThanOrEqual(FEE - COMMISSION);
      expect(wallet.upcoming.at(-1)).toMatchObject({ amountKobo: FEE - COMMISSION });
      expect(await trialBalance()).toBe(0);
    });

    it('lets the customer raise the fee while matching, within what the wallet covers', async () => {
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, FEE + SERVICE + 22_000);
      const errand = await createErrand(t, buyer);
      expect(errand.allowedEvents).toEqual(['cancel', 'raise_fee']);

      const raised = await act(t, buyer, errand.id, 'raise_fee', { amountKobo: FEE + 20_000 });
      expect(raised).toMatchObject({ status: 'requested', feeKobo: FEE + 20_000, serviceFeeKobo: SERVICE + 2_000 });
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(FEE + SERVICE + 22_000); // still nothing held

      const lower = await act(t, buyer, errand.id, 'raise_fee', { amountKobo: FEE }, 422);
      expect(lower.error.code).toBe('fee_not_raised');
      const tooMuch = await act(t, buyer, errand.id, 'raise_fee', { amountKobo: FEE + 40_000 }, 409);
      expect(tooMuch.error).toMatchObject({ code: 'insufficient_funds', neededKobo: FEE + 40_000 + SERVICE + 4_000 });
      await act(t, agent, errand.id, 'raise_fee', { amountKobo: FEE + 30_000 }, 404);
      // A stranger gets "not found" even with a malformed request; a stale screen is told to refresh
      // before any money check.
      await act(t, await signIn(t, 'customer'), errand.id, 'raise_fee', {}, 404);
      const stale = await request(t.http)
        .post(`/v1/errands/${errand.id}/events`)
        .set(buyer.headers)
        .send({ event: 'raise_fee', version: 0, data: { amountKobo: FEE + 40_000 } })
        .expect(409);
      expect(stale.body.error.code).toBe('errand_changed');

      // The agent who accepts gets the raised fee, and that is what is held.
      const accepted = await act(t, agent, errand.id, 'accept');
      expect(accepted.allowedEvents).not.toContain('raise_fee');
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(0);
      await act(t, buyer, errand.id, 'raise_fee', { amountKobo: FEE + 21_000 }, 409);
      expect(await trialBalance()).toBe(0);
    });

    it('moves the held amount when a new price is accepted, and refuses a rise the wallet can’t cover', async () => {
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, FEE + SERVICE + 50_000);
      const errand = await createErrand(t, buyer);
      await act(t, agent, errand.id, 'accept');
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(50_000);

      // 200,000 fee: service fee 20,000. The difference comes back.
      await act(t, agent, errand.id, 'send_offer', { amountKobo: 200_000 });
      const lower = await act(t, buyer, errand.id, 'accept_offer');
      expect(lower).toMatchObject({ feeKobo: 200_000, serviceFeeKobo: 20_000 });
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(50_000 + FEE + SERVICE - 220_000);

      await act(t, agent, errand.id, 'send_offer', { amountKobo: 900_000 });
      const short = await act(t, buyer, errand.id, 'accept_offer', {}, 409);
      expect(short.error.code).toBe('insufficient_funds');
      expect((await act(t, buyer, errand.id, 'decline_offer')).feeKobo).toBe(200_000);
    });

    it('returns the held fee when the customer changes agent or cancels', async () => {
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, 1_000_000);
      const errand = await createErrand(t, buyer);
      await act(t, agent, errand.id, 'accept');
      await act(t, buyer, errand.id, 'release_agent');
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(1_000_000);

      await act(t, agent, errand.id, 'accept');
      await act(t, buyer, errand.id, 'cancel');
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(1_000_000);
      const history = await request(t.http).get('/v1/wallet/transactions').set(buyer.headers).expect(200);
      expect(history.body.map((h: { kind: string }) => h.kind)).toEqual([
        'fee_refund',
        'fee_lock',
        'fee_refund',
        'fee_lock',
        'deposit',
      ]);
    });

    it('stops an agent accepting when the customer’s wallet no longer covers the errand', async () => {
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, FEE + SERVICE);
      const first = await createErrand(t, buyer);
      const second = await createErrand(t, buyer);
      await act(t, agent, first.id, 'accept');
      await request(t.http)
        .put('/v1/devices/current/push-token')
        .set(buyer.headers)
        .send({ token: 'short-wallet-1' })
        .expect(204);
      const res = await act(t, agent, second.id, 'accept', {}, 409);
      expect(res.error.code).toBe('customer_funds_low');
      expect(t.push.sent.filter((p) => p.token === 'short-wallet-1').at(-1)).toMatchObject({
        title: 'Top up to get your agent',
      });
      // More agents trying does not flood the customer.
      const other = await signIn(t, 'agent');
      await act(t, other, second.id, 'accept', {}, 409);
      await act(t, agent, second.id, 'accept', {}, 409);
      expect(
        t.push.sent.filter((p) => p.token === 'short-wallet-1' && p.title === 'Top up to get your agent'),
      ).toHaveLength(1);
      expect((await request(t.http).get(`/v1/errands/${second.id}`).set(buyer.headers).expect(200)).body.status).toBe(
        'requested',
      );
    });

    it('holds item money separately and releases it to the agent untouched', async () => {
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, 2_000_000);
      const errand = await createErrand(t, buyer, { categoryKey: 'groceries' });
      await runToDelivered(errand.id);
      await act(t, agent, errand.id, 'send_item_amount', {
        amountKobo: 3_000_000,
        photos: [await photo(t, agent, errand.id, 'receipt')],
      });
      expect((await act(t, buyer, errand.id, 'lock_item_amount', {}, 409)).error.code).toBe('insufficient_funds');

      await fund(t, buyer, 2_000_000);
      const locked = await act(t, buyer, errand.id, 'lock_item_amount');
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(4_000_000 - FEE - SERVICE - 3_000_000);
      expect(locked.held).toEqual({ feeKobo: FEE + SERVICE, itemsKobo: 3_000_000 });

      const agentBefore = (await balanceOf(t, agent)).availableKobo;
      const revenueBefore = await revenue();
      await act(t, agent, errand.id, 'mark_delivered');
      await act(t, agent, errand.id, 'send_dropoff_photo', {
        photo: await photo(t, agent, errand.id, 'dropoff_photo'),
      });
      await act(t, buyer, errand.id, 'approve_photo');
      // Item money is withdrawable at once and carries no commission.
      expect((await balanceOf(t, agent)).availableKobo - agentBefore).toBe(3_000_000);
      expect((await revenue()) - revenueBefore).toBe(SERVICE + COMMISSION);
      expect(await trialBalance()).toBe(0);
    });

    it('keeps both escrows frozen while a dispute is open', async () => {
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, 2_000_000);
      const errand = await createErrand(t, buyer, { categoryKey: 'groceries' });
      await runToDelivered(errand.id);
      await act(t, agent, errand.id, 'send_item_amount', {
        amountKobo: 500_000,
        photos: [await photo(t, agent, errand.id, 'receipt')],
      });
      await act(t, buyer, errand.id, 'lock_item_amount');
      await act(t, buyer, errand.id, 'open_dispute', { reason: 'Wrong items' });
      expect((await balanceOf(t, buyer)).balanceKobo).toBe(2_000_000 - FEE - SERVICE - 500_000);
      // A dispute freezes the money where it is until admin decides.
      const escrows = await t.db.select().from(ledgerAccounts).where(eq(ledgerAccounts.ownerId, errand.id));
      expect(Object.fromEntries(escrows.map((a) => [a.type, a.balance]))).toEqual({
        fee_escrow: FEE + SERVICE,
        item_escrow: 500_000,
      });
    });

    it('takes a tip once, all of it to the agent', async () => {
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, 1_000_000);
      const errand = await createErrand(t, buyer);
      await request(t.http)
        .post(`/v1/errands/${errand.id}/tip`)
        .set(buyer.headers)
        .send({ amountKobo: 50_000 })
        .expect(409);
      await runToDelivered(errand.id);
      await act(t, agent, errand.id, 'mark_delivered');
      await act(t, agent, errand.id, 'confirm_pin', { pin: await pin(buyer, errand.id) });

      const heldBefore = (await balanceOf(t, agent)).heldKobo;
      await request(t.http)
        .post(`/v1/errands/${errand.id}/tip`)
        .set(buyer.headers)
        .send({ amountKobo: 50_000 })
        .expect(201);
      expect((await balanceOf(t, agent)).heldKobo - heldBefore).toBe(50_000);
      const again = await request(t.http)
        .post(`/v1/errands/${errand.id}/tip`)
        .set(buyer.headers)
        .send({ amountKobo: 50_000 })
        .expect(409);
      expect(again.body.error.code).toBe('already_tipped');
    });
  });

  describe('agent earnings and withdrawals', () => {
    let earner: Person;

    beforeAll(async () => {
      earner = await signIn(t, 'agent', { firstName: 'Túndé' });
      await request(t.http).patch('/v1/me').set(earner.headers).send({ lastName: 'Bakare' }).expect(200);
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, 5_000_000);
      for (let i = 0; i < 2; i++) {
        const errand = await createErrand(t, buyer);
        await act(t, earner, errand.id, 'accept');
        await act(t, earner, errand.id, 'start');
        await act(t, earner, errand.id, 'mark_delivered');
        await act(t, earner, errand.id, 'confirm_pin', { pin: await pin(buyer, errand.id) });
      }
    });

    it('holds Bronze earnings for 24 hours, then makes them available', async () => {
      let wallet = await balanceOf(t, earner);
      expect(wallet).toMatchObject({ availableKobo: 0, heldKobo: 2 * (FEE - COMMISSION) });
      const due = new Date(Date.now() - 1000);
      await t.db.update(earningHolds).set({ availableAt: due }).where(eq(earningHolds.userId, earner.userId));
      wallet = await balanceOf(t, earner);
      expect(wallet).toMatchObject({ availableKobo: 2 * (FEE - COMMISSION), heldKobo: 0, upcoming: [] });
      // Reading the wallet changes nothing; the recurring job moves the money in the ledger.
      const holds = () => t.db.select().from(earningHolds).where(eq(earningHolds.userId, earner.userId));
      expect((await holds()).every((h) => h.releasedAt === null)).toBe(true);
      await t.jobs.run('payouts.retry');
      expect((await holds()).every((h) => h.releasedAt !== null)).toBe(true);
      expect(await balanceOf(t, earner)).toMatchObject({ availableKobo: 2 * (FEE - COMMISSION), heldKobo: 0 });
      expect(await trialBalance()).toBe(0);
    });

    it('accepts only a payout account in the agent’s own name', async () => {
      t.payments.accounts.set('058:0123456789', 'BAKARE TUNDE ADEWALE');
      t.payments.accounts.set('058:0987654321', 'CHIOMA OKAFOR');
      await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(earner.headers)
        .send({ amountKobo: 100_000, speed: 'instant' })
        .expect(409);

      const wrong = await request(t.http)
        .put('/v1/payout-account')
        .set(earner.headers)
        .send({ bankCode: '058', accountNumber: '0987654321' })
        .expect(422);
      expect(wrong.body.error).toMatchObject({ code: 'account_name_mismatch', accountName: 'CHIOMA OKAFOR' });
      const missing = await request(t.http)
        .put('/v1/payout-account')
        .set(earner.headers)
        .send({ bankCode: '058', accountNumber: '1111111111' })
        .expect(422);
      expect(missing.body.error.code).toBe('account_not_found');
      const ok = await request(t.http)
        .put('/v1/payout-account')
        .set(earner.headers)
        .send({ bankCode: '058', accountNumber: '0123456789' })
        .expect(200);
      expect(ok.body).toEqual({
        bankCode: '058',
        bankName: 'Guaranty Trust Bank',
        accountNumber: '******6789',
        accountName: 'BAKARE TUNDE ADEWALE',
      });

      const nameless = await signIn(t, 'agent');
      const res = await request(t.http)
        .put('/v1/payout-account')
        .set(nameless.headers)
        .send({ bankCode: '058', accountNumber: '0123456789' })
        .expect(409);
      expect(res.body.error.code).toBe('profile_incomplete');
    });

    it('sends an instant withdrawal for a fee, and settles it when the bank confirms', async () => {
      const start = (await balanceOf(t, earner)).availableKobo;
      const res = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(earner.headers)
        .send({ amountKobo: 100_000, speed: 'instant' })
        .expect(201);
      expect(res.body).toMatchObject({ status: 'processing', amountKobo: 100_000, feeKobo: 10_000, sendKobo: 90_000 });
      expect((await balanceOf(t, earner)).availableKobo).toBe(start - 100_000);

      const [row] = await t.db.select().from(payouts).where(eq(payouts.id, res.body.id));
      expect(t.payments.transfers.get(row!.reference)).toMatchObject({
        amountKobo: 90_000,
        recipientCode: 'RCP_058_0123456789',
      });
      const fees = () => t.app.get(LedgerService).balance(t.db, { type: 'provider_fees' }, 'NG');
      const feesBefore = await fees();
      await deliverWebhook(t, t.payments.settleTransfer(row!.reference, 'success')).expect(200);
      const [done] = await t.db.select().from(payouts).where(eq(payouts.id, res.body.id));
      expect(done!.status).toBe('succeeded');
      // Paystack's own transfer fee is booked, so reconciliation stays exact.
      expect((await fees()) - feesBefore).toBe(t.payments.transferFeeKobo);
      expect(await trialBalance()).toBe(0);
    });

    it('recovers a transfer whose answer was lost, without paying twice', async () => {
      const start = (await balanceOf(t, earner)).availableKobo;
      const transfer = t.payments.transfer.bind(t.payments);
      t.payments.transfer = async (input) => {
        await transfer(input); // the bank takes it...
        throw new Error('socket hang up'); // ...but the answer never arrives
      };
      try {
        const res = await request(t.http)
          .post('/v1/wallet/withdrawals')
          .set(earner.headers)
          .send({ amountKobo: 30_000, speed: 'instant' })
          .expect(201);
        expect(res.body.status).toBe('processing');
      } finally {
        t.payments.transfer = transfer;
      }
      expect((await balanceOf(t, earner)).availableKobo).toBe(start - 30_000);
      expect([...t.payments.transfers.values()].filter((x) => x.amountKobo === 20_000)).toHaveLength(1);
    });

    it('gives the money back when the provider refuses a transfer outright', async () => {
      const start = (await balanceOf(t, earner)).availableKobo;
      t.payments.rejectNextTransfer = 'Transfer recipient is no longer valid';
      const res = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(earner.headers)
        .send({ amountKobo: 25_000, speed: 'instant' })
        .expect(201);
      expect(res.body).toMatchObject({ status: 'failed', failureReason: 'Transfer recipient is no longer valid' });
      expect((await balanceOf(t, earner)).availableKobo).toBe(start);
    });

    it('retries an instant withdrawal within minutes when the provider was unreachable', async () => {
      const transfer = t.payments.transfer.bind(t.payments);
      t.payments.transfer = async () => {
        throw new Error('ETIMEDOUT');
      };
      let id = '';
      try {
        const res = await request(t.http)
          .post('/v1/wallet/withdrawals')
          .set(earner.headers)
          .send({ amountKobo: 20_000, speed: 'instant' })
          .expect(201);
        expect(res.body.status).toBe('requested');
        id = res.body.id;
      } finally {
        t.payments.transfer = transfer;
      }
      await t.db
        .update(payouts)
        .set({ createdAt: new Date(Date.now() - 2 * 60_000) })
        .where(eq(payouts.id, id));
      await t.jobs.run('payouts.retry');
      const [row] = await t.db.select().from(payouts).where(eq(payouts.id, id));
      expect(row!.status).toBe('processing');
    });

    it('gives the full amount back, fee included, when the bank bounces it', async () => {
      const start = (await balanceOf(t, earner)).availableKobo;
      const res = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(earner.headers)
        .send({ amountKobo: 50_000, speed: 'instant' })
        .expect(201);
      const [row] = await t.db.select().from(payouts).where(eq(payouts.id, res.body.id));
      await deliverWebhook(t, t.payments.settleTransfer(row!.reference, 'failed')).expect(200);
      expect((await balanceOf(t, earner)).availableKobo).toBe(start);
      const list = await request(t.http).get('/v1/wallet/withdrawals').set(earner.headers).expect(200);
      expect(list.body[0]).toMatchObject({ id: res.body.id, status: 'failed' });
    });

    it('queues one free withdrawal a day and sends it on the daily run', async () => {
      const res = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(earner.headers)
        .send({ amountKobo: 40_000, speed: 'scheduled' })
        .expect(201);
      expect(res.body).toMatchObject({ status: 'requested', feeKobo: 0, sendKobo: 40_000 });
      const again = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(earner.headers)
        .send({ amountKobo: 10_000, speed: 'scheduled' })
        .expect(409);
      expect(again.body.error.code).toBe('scheduled_withdrawal_exists');

      await t.jobs.run('payouts.daily');
      const [row] = await t.db.select().from(payouts).where(eq(payouts.id, res.body.id));
      expect(row!.status).toBe('processing');
      expect(t.payments.transfers.get(row!.reference)?.amountKobo).toBe(40_000);
    });

    it('applies the daily limit and the balance', async () => {
      const poor = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(earner.headers)
        .send({ amountKobo: 4_900_000, speed: 'instant' })
        .expect(422);
      expect(poor.body.error.code).toBe('daily_limit_reached');
      const tooMuch = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(earner.headers)
        .send({ amountKobo: 1_000_000, speed: 'instant' })
        .expect(409);
      expect(tooMuch.body.error.code).toBe('insufficient_funds');
      const tiny = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(earner.headers)
        .send({ amountKobo: 5_000, speed: 'scheduled' })
        .expect(422);
      expect(tiny.body.error.code).toBe('withdrawal_too_small');
    });
  });

  describe('reconciliation', () => {
    it('finds no new gap when the ledger and the provider agree, payouts included', async () => {
      const run = async () =>
        ((await t.jobs.run('reconcile.daily')) as Array<{ differenceKobo: number }>)[0]!.differenceKobo;
      const first = await run();
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, 750_000);
      expect(await run()).toBe(first);

      // A whole payout: requested, sent, confirmed. The provider's transfer fee is accounted for.
      const payee = await signIn(t, 'agent', { firstName: 'Ngozi' });
      await request(t.http).patch('/v1/me').set(payee.headers).send({ lastName: 'Eze' }).expect(200);
      t.payments.accounts.set('044:2222222222', 'EZE NGOZI');
      await request(t.http)
        .put('/v1/payout-account')
        .set(payee.headers)
        .send({ bankCode: '044', accountNumber: '2222222222' })
        .expect(200);
      const errand = await createErrand(t, buyer);
      await act(t, payee, errand.id, 'accept');
      await act(t, payee, errand.id, 'start');
      await act(t, payee, errand.id, 'mark_delivered');
      await act(t, payee, errand.id, 'confirm_pin', { pin: await pin(buyer, errand.id) });
      await t.db
        .update(earningHolds)
        .set({ availableAt: new Date(Date.now() - 1000) })
        .where(eq(earningHolds.userId, payee.userId));
      const out = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(payee.headers)
        .send({ amountKobo: 100_000, speed: 'instant' })
        .expect(201);
      const [row] = await t.db.select().from(payouts).where(eq(payouts.id, out.body.id));
      await deliverWebhook(t, t.payments.settleTransfer(row!.reference, 'success')).expect(200);
      expect(await run()).toBe(first);
      expect(await trialBalance()).toBe(0);
    });
  });
});
