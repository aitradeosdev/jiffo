import { randomUUID } from 'node:crypto';
import { and, eq, gt, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { PaystackError } from '../src/adapters/payments';
import { payoutAccounts, payouts, reconciliationRuns, settingsVersions, users } from '../src/db/schema';
import { PayoutsService } from '../src/money/payouts.service';
import { ReconciliationService } from '../src/money/reconciliation.service';
import { WalletService } from '../src/money/wallet.service';
import {
  adminAs,
  agentWithMoney,
  balanceOf,
  clearReconciliationPauses,
  createTestApp,
  signIn,
  type Person,
  type TestApp,
} from './helpers';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Abuse cases for withdrawals: repeats, overlaps, unclear answers, suspensions, caps and the nightly check. */
describe('withdrawals under abuse', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let finance: Awaited<ReturnType<typeof adminAs>>;
  let original: { version: number };

  beforeAll(async () => {
    t = await createTestApp();
    [owner, finance] = await Promise.all([adminAs(t, 'owner'), adminAs(t, 'finance')]);
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    await clearReconciliationPauses(t);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    t.payments.nextTransferStatus = 'pending';
  });
  afterAll(async () => {
    await t.db
      .delete(settingsVersions)
      .where(and(eq(settingsVersions.countryCode, 'NG'), gt(settingsVersions.version, original.version)));
    await clearReconciliationPauses(t);
    await t.close();
  });

  const withdraw = (who: Person, body: Record<string, unknown>) =>
    request(t.http)
      .post('/v1/wallet/withdrawals')
      .set(who.headers)
      .send({ requestId: randomUUID(), ...body });
  const payoutOf = async (id: string) => (await t.db.select().from(payouts).where(eq(payouts.id, id)))[0]!;
  const recipientOf = async (payout: { payoutAccountId: string }) =>
    (await t.db.select().from(payoutAccounts).where(eq(payoutAccounts.id, payout.payoutAccountId)))[0]!.recipientCode;
  const available = async (who: Person) => (await balanceOf(t, who)).availableKobo as number;
  const trialBalance = () => t.app.get(WalletService).trialBalance();
  const alerts = async (kind: string) =>
    (
      (await request(t.http).get('/v1/admin/alerts?country=NG').set(finance.headers).expect(200)).body as {
        alerts: Array<{ id: string; kind: string; resolvedAt: string | null }>;
      }
    ).alerts.filter((a) => a.kind === kind && !a.resolvedAt);

  /** Saves the Security settings with these changes, as admin does in the panel. */
  async function security(changes: Record<string, number>) {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    Object.assign(settings.security, changes);
    await request(t.http)
      .post('/v1/admin/settings?country=NG')
      .set(owner.headers)
      .send({ basedOn: now.version, settings, note: 'Security limits for a test' })
      .expect(200);
  }

  describe('repeats', () => {
    it('needs a request key on every withdrawal', async () => {
      const agent = await agentWithMoney(t);
      const res = await request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(agent.headers)
        .send({ amountKobo: 20_000, speed: 'scheduled' })
        .expect(400);
      expect(res.body.error.code).toBe('invalid_request');
    });

    it('makes one withdrawal from 50 identical requests at once', async () => {
      const agent = await agentWithMoney(t, 1_000_000);
      const requestId = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 50 }, () => withdraw(agent, { amountKobo: 200_000, speed: 'instant', requestId })),
      );
      expect(results.map((r) => r.status).filter((s) => s !== 201)).toEqual([]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await available(agent)).toBe(800_000);
      const rows = await t.db.select().from(payouts).where(eq(payouts.userId, agent.userId));
      expect(rows).toHaveLength(1);
      expect([...t.payments.transfers.keys()].filter((ref) => ref === rows[0]!.reference)).toHaveLength(1);
      // The same key for another amount is refused, not taken as a new withdrawal.
      const reused = await withdraw(agent, { amountKobo: 100_000, speed: 'instant', requestId }).expect(409);
      expect(reused.body.error.code).toBe('request_reused');
      expect(await trialBalance()).toBe(0);
    });
  });

  describe('sending', () => {
    it('sends a withdrawal once when several runs send it at the same time', async () => {
      const agent = await agentWithMoney(t, 500_000);
      const res = await withdraw(agent, { amountKobo: 100_000, speed: 'scheduled' }).expect(201);
      const reference = (await payoutOf(res.body.id)).reference;
      // The provider takes a moment, and refuses a reference it is already handling, as Paystack does.
      const transfer = t.payments.transfer.bind(t.payments);
      const handling = new Set<string>();
      const calls: string[] = [];
      vi.spyOn(t.payments, 'transfer').mockImplementation(async (input) => {
        calls.push(input.reference);
        if (handling.has(input.reference)) throw new PaystackError(400, 'Duplicate Transaction Reference');
        handling.add(input.reference);
        await sleep(150);
        return transfer(input);
      });
      const service = t.app.get(PayoutsService);
      await Promise.all(Array.from({ length: 10 }, () => service.send(res.body.id)));
      expect(calls.filter((ref) => ref === reference)).toHaveLength(1);
      expect((await payoutOf(res.body.id)).status).toBe('processing');
      // Not given back while the bank pays it.
      expect(await available(agent)).toBe(400_000);
      expect(await trialBalance()).toBe(0);
    });

    it('never gives the money back on an unclear answer after the first try', async () => {
      const agent = await agentWithMoney(t, 500_000);
      const res = await withdraw(agent, { amountKobo: 100_000, speed: 'scheduled' }).expect(201);
      const service = t.app.get(PayoutsService);
      // First try: no answer at all.
      vi.spyOn(t.payments, 'transfer').mockRejectedValueOnce(new Error('ETIMEDOUT'));
      await service.send(res.body.id);
      expect((await payoutOf(res.body.id)).status).toBe('requested');
      // Second try: refused as a duplicate, and the provider can't find it yet. It may exist: nothing is refunded.
      vi.spyOn(t.payments, 'transfer').mockRejectedValueOnce(new PaystackError(400, 'Duplicate Transaction Reference'));
      await service.send(res.body.id);
      expect((await payoutOf(res.body.id)).status).toBe('requested');
      expect(await available(agent)).toBe(400_000);
      expect(await alerts('payout_unclear')).not.toHaveLength(0);
    });

    it('holds a suspended agent’s withdrawals until they are reactivated', async () => {
      const agent = await agentWithMoney(t, 300_000);
      const res = await withdraw(agent, { amountKobo: 100_000, speed: 'scheduled' }).expect(201);
      await t.db.update(users).set({ status: 'suspended' }).where(eq(users.id, agent.userId));
      await t.jobs.run('payouts.daily');
      const held = await payoutOf(res.body.id);
      expect(held.status).toBe('requested');
      expect(t.payments.transfers.has(held.reference)).toBe(false);
      await t.db.update(users).set({ status: 'active' }).where(eq(users.id, agent.userId));
      await t.jobs.run('payouts.daily');
      expect((await payoutOf(res.body.id)).status).toBe('processing');
    });

    it('fails a transfer the provider holds for an OTP, and says so', async () => {
      const agent = await agentWithMoney(t, 300_000);
      vi.spyOn(t.payments, 'transfer').mockResolvedValueOnce({ status: 'failed', transferCode: null, reason: 'otp' });
      const res = await withdraw(agent, { amountKobo: 100_000, speed: 'instant' }).expect(201);
      expect(res.body.status).toBe('failed');
      expect(await available(agent)).toBe(300_000);
      expect(await alerts('transfer_otp_on')).not.toHaveLength(0);
    });
  });

  describe('the transfer approval URL', () => {
    const approve = (body: Record<string, unknown>, signature?: string) => {
      const signed = t.payments.approvalRequest(body);
      return request(t.http)
        .post(`/v1/webhooks/${t.payments.name}/transfer-approval`)
        .set('content-type', 'application/json')
        .set('x-paystack-signature', signature ?? signed.signature)
        .send(signed.body.toString());
    };

    it('approves only a withdrawal Jiffo is sending, for its amount and recipient', async () => {
      const agent = await agentWithMoney(t, 500_000);
      const res = await withdraw(agent, { amountKobo: 100_000, speed: 'instant' }).expect(201);
      const payout = await payoutOf(res.body.id);
      const recipientCode = await recipientOf(payout);
      const ok = { reference: payout.reference, amount: payout.sendKobo, recipient_code: recipientCode };
      expect((await approve(ok).expect(200)).body).toEqual({ approved: true });

      await approve({ ...ok, amount: payout.sendKobo + 1 }).expect(400);
      await approve({ ...ok, recipient_code: 'RCP_someone_else' }).expect(400);
      await approve({ ...ok, reference: `jp-${randomUUID()}` }).expect(400);
      await approve(ok, 'not-the-signature').expect(401);
      expect(await alerts('payout_rejected')).not.toHaveLength(0);
    });

    it('refuses a withdrawal that is only queued, or already finished', async () => {
      const agent = await agentWithMoney(t, 500_000);
      const queued = await payoutOf((await withdraw(agent, { amountKobo: 100_000, speed: 'scheduled' })).body.id);
      const recipient_code = await recipientOf(queued);
      await approve({ reference: queued.reference, amount: queued.sendKobo, recipient_code }).expect(400);
      // Sent and paid: nothing left to approve.
      const sent = await payoutOf((await withdraw(agent, { amountKobo: 100_000, speed: 'instant' })).body.id);
      const { deliverWebhook } = await import('./helpers');
      await deliverWebhook(t, t.payments.settleTransfer(sent.reference, 'success')).expect(200);
      await approve({ reference: sent.reference, amount: sent.sendKobo, recipient_code }).expect(400);
    });

    it('approves the withdrawal while it is being sent', async () => {
      const agent = await agentWithMoney(t, 500_000);
      const transfer = t.payments.transfer.bind(t.payments);
      let answer = 0;
      vi.spyOn(t.payments, 'transfer').mockImplementation(async (input) => {
        // Paystack asks the approval URL before it moves the money.
        answer = (
          await approve({ reference: input.reference, amount: input.amountKobo, recipient_code: input.recipientCode })
        ).status;
        return transfer(input);
      });
      await withdraw(agent, { amountKobo: 100_000, speed: 'instant' }).expect(201);
      expect(answer).toBe(200);
    });
  });

  describe('caps', () => {
    it('stops instant withdrawals at the daily cap per agent, and for everyone', async () => {
      await security({ instantWithdrawalAgentDailyKobo: 150_000, instantWithdrawalPlatformDailyKobo: 100_000_000_000 });
      const agent = await agentWithMoney(t, 1_000_000);
      await withdraw(agent, { amountKobo: 100_000, speed: 'instant' }).expect(201);
      const over = await withdraw(agent, { amountKobo: 100_000, speed: 'instant' }).expect(422);
      expect(over.body.error).toMatchObject({ code: 'instant_limit_reached', remainingKobo: 50_000 });
      // The daily withdrawal isn't capped by it.
      await withdraw(agent, { amountKobo: 100_000, speed: 'scheduled' }).expect(201);

      // Everyone's instant withdrawals today, this one included, may not pass the platform cap.
      const [{ total }] = (
        await t.db.execute<{ total: string }>(
          sql`select coalesce(sum(amount_kobo), 0) as total from payouts where country_code = 'NG' and speed = 'instant'
            and status in ('requested', 'processing', 'succeeded') and created_at > now() - interval '1 day'`,
        )
      ).rows as [{ total: string }];
      await security({
        instantWithdrawalAgentDailyKobo: 100_000_000,
        instantWithdrawalPlatformDailyKobo: Number(total) + 50_000,
      });
      const other = await agentWithMoney(t, 1_000_000);
      const full = await withdraw(other, { amountKobo: 100_000, speed: 'instant' }).expect(422);
      expect(full.body.error.code).toBe('instant_unavailable');
      await withdraw(other, { amountKobo: 40_000, speed: 'instant' }).expect(201);
      await security({
        instantWithdrawalAgentDailyKobo: 100_000_000,
        instantWithdrawalPlatformDailyKobo: 100_000_000_000,
      });
    });
  });

  describe('the nightly check', () => {
    const reconcile = async () => (await t.app.get(ReconciliationService).run()).find((r) => r.countryCode === 'NG')!;

    it('pauses instant withdrawals after a shortfall, until finance clears it', async () => {
      // Line the fake provider up with the run's ledger first, so only this test's gap counts.
      const first = await reconcile();
      t.payments.providerBalanceKobo -= first.differenceKobo;
      await clearReconciliationPauses(t);
      expect((await reconcile()).differenceKobo).toBe(0);

      const agent = await agentWithMoney(t, 1_000_000);
      t.payments.providerBalanceKobo -= 5_000_000; // money missing at the provider
      const run = await reconcile();
      expect(run.differenceKobo).toBe(-5_000_000);
      expect(await alerts('reconciliation_gap')).not.toHaveLength(0);

      const paused = await withdraw(agent, { amountKobo: 100_000, speed: 'instant' }).expect(409);
      expect(paused.body.error.code).toBe('instant_paused');
      await withdraw(agent, { amountKobo: 100_000, speed: 'scheduled' }).expect(201);

      // Only finance can clear it, with a note.
      const ops = await adminAs(t, 'operations');
      await request(t.http)
        .post(`/v1/admin/money/reconciliation/${run.id}/clear`)
        .set(ops.headers)
        .send({ note: 'Checked' })
        .expect(403);
      await request(t.http)
        .post(`/v1/admin/money/reconciliation/${run.id}/clear`)
        .set(finance.headers)
        .send({ note: 'Paystack fee taken outside the ledger; booked by adjustment' })
        .expect(200);
      const [cleared] = await t.db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, run.id));
      expect(cleared!.clearedAt).not.toBeNull();
      await withdraw(agent, { amountKobo: 100_000, speed: 'instant' }).expect(201);
      t.payments.providerBalanceKobo += 5_000_000;
    });

    it('raises one alert while the provider balance is low, and closes it once it is back up', async () => {
      const before = t.payments.providerBalanceKobo;
      try {
        t.payments.providerBalanceKobo = 100_000;
        await security({ lowProviderBalanceKobo: 1_000_000 });
        await t.jobs.run('payouts.balance');
        await t.jobs.run('payouts.balance');
        expect(await alerts('low_provider_balance')).toHaveLength(1);
        t.payments.providerBalanceKobo = 2_000_000;
        await t.jobs.run('payouts.balance');
        expect(await alerts('low_provider_balance')).toHaveLength(0);
      } finally {
        t.payments.providerBalanceKobo = before;
        await security({ lowProviderBalanceKobo: 0 });
      }
    });
  });

  describe('adjustments', () => {
    it('refuses a request key used for a different adjustment', async () => {
      const person = await signIn(t, 'agent');
      const requestId = randomUUID();
      const body = {
        personId: person.userId,
        account: 'agent_available',
        direction: 'credit',
        amountKobo: 50_000,
        note: 'Goodwill',
        requestId,
      };
      const post = (b: Record<string, unknown>) =>
        request(t.http).post('/v1/admin/money/adjustments').set(finance.headers).send(b);
      expect((await post(body).expect(200)).body).toEqual({ posted: true });
      expect((await post(body).expect(200)).body).toEqual({ posted: false });
      expect((await post({ ...body, amountKobo: 5_000_000 }).expect(409)).body.error.code).toBe('request_reused');
    });
  });
});
