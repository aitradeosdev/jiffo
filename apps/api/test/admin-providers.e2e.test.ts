import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TermiiMessagingAdapter } from '../src/adapters/messaging';
import { PaystackPaymentsAdapter } from '../src/adapters/payments';
import { adminAudit, deposits, payoutAccounts, payouts, providerSettings } from '../src/db/schema';
import { ProvidersService } from '../src/providers/providers.service';
import { SecretBox } from '../src/providers/secret-box';
import { adminAs, balanceOf, createTestApp, deliverWebhook, randomPhone, signIn, type TestApp } from './helpers';

describe('admin: providers', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  const api = (method: 'get' | 'put' | 'post' | 'delete', path: string, as = owner) =>
    request(t.http)[method](`/v1/admin/providers${path}`).set(as.headers);
  const termii = { config: { senderId: 'Jiffo' }, secrets: { apiKey: 'TL-live-key-0123456789abcd' } };

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
  });
  afterEach(() => vi.restoreAllMocks());
  // The settings are shared by every test file in the run: put them back as they were.
  afterAll(async () => {
    await t.db.delete(providerSettings);
    await t.app.get(ProvidersService).reload();
    await t.close();
  });

  it('keeps keys encrypted, shows only their last characters, and audits which fields changed', async () => {
    await api('put', '/sms/termii').send(termii).expect(200);
    const [row] = await t.db.select().from(providerSettings).where(eq(providerSettings.provider, 'termii'));
    expect(row!.secrets).toMatch(/^v1\./);
    expect(row!.secrets).not.toContain('TL-live-key');
    expect(row!.config).toEqual({ senderId: 'Jiffo' });

    const list = await api('get', '').expect(200);
    const sms = list.body.categories.find((c: { category: string }) => c.category === 'sms');
    expect(sms).toMatchObject({ active: null, fallback: 'memory' });
    const saved = sms.providers.find((p: { key: string }) => p.key === 'termii');
    expect(saved).toMatchObject({ saved: true, complete: true, secretHints: { apiKey: '••••abcd' } });
    expect(JSON.stringify(list.body)).not.toContain('TL-live-key');

    const [entry] = await t.db.select().from(adminAudit).where(eq(adminAudit.targetId, 'sms:termii'));
    expect(entry!.data).toMatchObject({ changed: expect.arrayContaining(['apiKey', 'senderId']) });
    expect(JSON.stringify(entry!.data)).not.toContain('TL-live-key');

    // An empty secret keeps the saved one; nothing changed, nothing recorded.
    expect(
      (await api('put', '/sms/termii').send({ config: { senderId: 'Jiffo' }, secrets: { apiKey: '' } })).body,
    ).toEqual({ changed: [] });
  });

  it('is for owners only, and takes only the fields a provider has', async () => {
    const ops = await adminAs(t, 'operations');
    await api('get', '', ops).expect(403);
    await api('put', '/sms/termii', ops).send(termii).expect(403);
    expect((await api('put', '/sms/termii').send({ config: { colour: 'red' } })).body.error.code).toBe('unknown_field');
    expect((await api('put', '/sms/termii').send({ config: { apiKey: 'x' } })).body.error.code).toBe(
      'secret_in_config',
    );
    expect((await api('put', '/sms/nobody').send(termii)).status).toBe(404);
    // A key file that isn't one is refused before anything is saved.
    const bad = await api('put', '/push/fcm').send({ secrets: { serviceAccountJson: '{"nope":1}' } });
    expect(bad.body.error.code).toBe('invalid_provider_settings');
    expect(JSON.stringify(bad.body)).not.toContain('nope');
  });

  it('switches a provider on only after a passing test, and sign-in codes then go through it', async () => {
    await api('put', '/sms/termii').send(termii).expect(200);
    expect((await api('post', '/sms/active').send({ provider: 'termii' })).body.error.code).toBe('provider_not_tested');
    vi.spyOn(TermiiMessagingAdapter.prototype, 'check').mockRejectedValueOnce(
      new Error('Termii answered 401: bad key'),
    );
    expect((await api('post', '/sms/termii/test')).body).toEqual({
      ok: false,
      message: 'Termii answered 401: bad key',
    });
    expect((await api('post', '/sms/active').send({ provider: 'termii' })).status).toBe(409);

    vi.spyOn(TermiiMessagingAdapter.prototype, 'check').mockResolvedValue('Connected. Balance: 500 NGN');
    expect((await api('post', '/sms/termii/test')).body).toEqual({ ok: true, message: 'Connected. Balance: 500 NGN' });
    await api('post', '/sms/active').send({ provider: 'termii' }).expect(200);

    const sent = vi.spyOn(TermiiMessagingAdapter.prototype, 'sendOtp').mockResolvedValue();
    const phone = randomPhone();
    await request(t.http).post('/v1/auth/otp/request').send({ phone }).expect(200);
    expect(sent).toHaveBeenCalledWith(phone, expect.stringMatching(/^\d{6}$/), expect.any(Number));
    expect(t.messaging.lastCodeFor(phone)).toBeUndefined();

    // A changed key needs a new test before it can be switched on again.
    await api('post', '/sms/active').send({ provider: null }).expect(200);
    await api('put', '/sms/termii')
      .send({ secrets: { apiKey: 'TL-new-key-9876' } })
      .expect(200);
    expect((await api('post', '/sms/active').send({ provider: 'termii' })).body.error.code).toBe('provider_not_tested');
    // Back on the environment's choice, codes go to the development stand-in again.
    const other = randomPhone();
    await request(t.http).post('/v1/auth/otp/request').send({ phone: other }).expect(200);
    expect(t.messaging.lastCodeFor(other)).toMatch(/^\d{6}$/);
  });

  it('keeps a key bound to its provider', () => {
    const box = new SecretBox('ab'.repeat(32));
    const sealed = box.seal('secret', 'provider:sms:termii');
    expect(box.open(sealed, 'provider:sms:termii')).toBe('secret');
    expect(() => box.open(sealed, 'provider:payments:paystack')).toThrow();
    expect(() => new SecretBox('cd'.repeat(32)).open(sealed, 'provider:sms:termii')).toThrow();
  });

  it('finishes top-ups with the provider that started them, and pays out through the one switched on', async () => {
    // A top-up started with the development bank, then Paystack is switched on.
    const customer = await signIn(t, 'customer');
    const started = await request(t.http)
      .post('/v1/wallet/deposits')
      .set(customer.headers)
      .send({ amountKobo: 500_000 })
      .expect(201);
    const agent = await signIn(t, 'agent');
    await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName: 'Bakare' }).expect(200);
    t.payments.accounts.set('058:0222333444', 'TUNDE BAKARE');
    await request(t.http)
      .put('/v1/payout-account')
      .set(agent.headers)
      .send({ bankCode: '058', accountNumber: '0222333444' })
      .expect(200);
    const finance = await adminAs(t, 'finance');
    await request(t.http)
      .post('/v1/admin/money/adjustments')
      .set(finance.headers)
      .send({
        personId: agent.userId,
        account: 'agent_available',
        direction: 'credit',
        amountKobo: 300_000,
        note: 'Test earnings for the payout switch',
        requestId: crypto.randomUUID(),
      })
      .expect(200);

    await api('put', '/payments/paystack')
      .send({ secrets: { secretKey: 'sk_live_abcdefgh1234' } })
      .expect(200);
    vi.spyOn(PaystackPaymentsAdapter.prototype, 'balance').mockResolvedValue(1_000_000);
    await api('post', '/payments/paystack/test').expect(200);
    await api('post', '/payments/active').send({ provider: 'paystack' }).expect(200);

    const verify = vi.spyOn(PaystackPaymentsAdapter.prototype, 'verifyDeposit');
    const [deposit] = await t.db.select().from(deposits).where(eq(deposits.id, started.body.id));
    await deliverWebhook(t, t.payments.pay(deposit!.reference)).expect(200);
    expect(verify).not.toHaveBeenCalled();
    expect((await balanceOf(t, customer)).balanceKobo).toBe(500_000);

    const recipient = vi
      .spyOn(PaystackPaymentsAdapter.prototype, 'createRecipient')
      .mockResolvedValue({ recipientCode: 'RCP_paystack_1' });
    const transfer = vi
      .spyOn(PaystackPaymentsAdapter.prototype, 'transfer')
      .mockResolvedValue({ status: 'pending', transferCode: 'TRF_1', reason: '', feeKobo: undefined });
    const res = await request(t.http)
      .post('/v1/wallet/withdrawals')
      .set(agent.headers)
      .send({ amountKobo: 200_000, speed: 'instant' })
      .expect(201);
    expect(recipient).toHaveBeenCalledWith({ name: 'TUNDE BAKARE', bankCode: '058', accountNumber: '0222333444' });
    expect(transfer).toHaveBeenCalledWith(expect.objectContaining({ recipientCode: 'RCP_paystack_1' }));
    const [payout] = await t.db.select().from(payouts).where(eq(payouts.id, res.body.id));
    expect(payout).toMatchObject({ provider: 'paystack', providerTransferCode: 'TRF_1', status: 'processing' });
    const [account] = await t.db.select().from(payoutAccounts).where(eq(payoutAccounts.userId, agent.userId));
    expect(account).toMatchObject({ provider: 'paystack', recipientCode: 'RCP_paystack_1' });

    // Paystack can't be removed while it is in use or has a payout to finish.
    expect((await api('delete', '/payments/paystack')).body.error.code).toBe('provider_active');
    await api('post', '/payments/active').send({ provider: null }).expect(200);
    expect((await api('delete', '/payments/paystack')).body.error.code).toBe('provider_in_use');
    await t.db.update(payouts).set({ status: 'failed' }).where(eq(payouts.id, payout!.id));
    await api('delete', '/payments/paystack').expect(200);
  });
});
