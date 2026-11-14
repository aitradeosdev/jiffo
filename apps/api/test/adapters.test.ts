import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { AfricasTalkingMessagingAdapter, TermiiMessagingAdapter } from '../src/adapters/messaging';
import { AfricasTalkingCallsAdapter, TwilioCallsAdapter } from '../src/adapters/calls';
import { FcmPushAdapter } from '../src/adapters/push';
import { FlutterwavePaymentsAdapter, parseFlutterwaveDate, PaystackPaymentsAdapter } from '../src/adapters/payments';
import { GoogleMapsAdapter } from '../src/adapters/maps';
import { createHmac } from 'node:crypto';
import { decrypt, encrypt } from '../src/common/crypto';
import { loadConfig } from '../src/config/app-config';
import { BullMqErrandTimers, type ErrandTimerJob } from '../src/timers/errand-timers';

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}

describe('Termii messaging', () => {
  it('sends the code on the DND route without the plus sign', async () => {
    const { impl, calls } = fakeFetch(() => new Response('{"message":"Successfully Sent"}', { status: 200 }));
    await new TermiiMessagingAdapter('key-1', 'Jiffo', 'https://api.example.test', impl).sendOtp(
      '+2348031234567',
      '123456',
      300,
    );
    expect(calls[0]!.url).toBe('https://api.example.test/api/sms/send');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      api_key: 'key-1',
      to: '2348031234567',
      from: 'Jiffo',
      sms: expect.stringContaining('123456'),
      type: 'plain',
      channel: 'dnd',
    });
  });

  it('reports a provider failure as unavailable', async () => {
    const { impl } = fakeFetch(() => new Response('nope', { status: 500 }));
    const adapter = new TermiiMessagingAdapter('k', 'Jiffo', 'https://api.example.test', impl);
    await expect(adapter.sendOtp('+2348031234567', '123456', 300)).rejects.toMatchObject({ status: 503 });
  });
});

describe('FCM push', () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const account = JSON.stringify({
    project_id: 'jiffo-test',
    client_email: 'push@jiffo-test.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  });

  it('authenticates once, sends one message per token and reports dead tokens', async () => {
    const { impl, calls } = fakeFetch(({ url, init }) => {
      if (url.includes('oauth2')) return Response.json({ access_token: 'ya29.test', expires_in: 3600 });
      const token = JSON.parse(String(init.body)).message.token;
      if (token === 'dead')
        return new Response('{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}', {
          status: 404,
        });
      return Response.json({ name: 'projects/jiffo-test/messages/1' });
    });
    const adapter = new FcmPushAdapter(account, impl);
    const n = { title: 'Hi', body: 'There', data: { errandId: 'e1' } };

    expect(await adapter.send(['live', 'dead'], n)).toEqual({ invalidTokens: ['dead'] });
    await adapter.send(['live'], n);

    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
    const sends = calls.filter((c) => c.url.includes('fcm.googleapis.com'));
    expect(sends[0]!.url).toBe('https://fcm.googleapis.com/v1/projects/jiffo-test/messages:send');
    expect((sends[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer ya29.test');
    expect(JSON.parse(String(sends[0]!.init.body)).message).toMatchObject({
      notification: { title: 'Hi', body: 'There' },
      data: { errandId: 'e1' },
    });
  });

  it('needs a complete service account', () => {
    expect(() => new FcmPushAdapter('{"project_id":"x"}')).toThrow(/client_email/);
  });
});

describe('Paystack payments', () => {
  const ok = (data: unknown, meta?: unknown) => Response.json({ status: true, message: 'ok', data, meta });

  it('asks for a one-time transfer account with our reference and expiry', async () => {
    const { impl, calls } = fakeFetch(() =>
      ok({
        status: 'pending_bank_transfer',
        account_number: '9876543210',
        account_name: 'PAYSTACK-TITAN CHECKOUT',
        bank: { name: 'Paystack-Titan', slug: 'paystack-titan' },
        account_expires_at: '2026-11-13T10:30:00.000Z',
      }),
    );
    const adapter = new PaystackPaymentsAdapter('sk_test_1', 'https://api.example.test', impl);
    const expiresAt = new Date('2026-11-13T10:30:00.000Z');
    const account = await adapter.createTransferDeposit({
      reference: 'jd-1',
      amountKobo: 500_000,
      email: 'u@customers.jiffoapp.com',
      expiresAt,
    });
    expect(account).toEqual({
      accountNumber: '9876543210',
      accountName: 'PAYSTACK-TITAN CHECKOUT',
      bankName: 'Paystack-Titan',
      expiresAt,
    });
    expect(calls[0]!.url).toBe('https://api.example.test/charge');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer sk_test_1');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      email: 'u@customers.jiffoapp.com',
      amount: 500_000,
      reference: 'jd-1',
      bank_transfer: { account_expires_at: '2026-11-13T10:30:00.000Z' },
    });
  });

  it('reads the verified amount, fees and sender', async () => {
    const { impl, calls } = fakeFetch(() =>
      ok({
        status: 'success',
        amount: 499_000,
        fees: 7_485,
        currency: 'NGN',
        authorization: { sender_name: 'ADA OBI', sender_bank: 'GTBank' },
      }),
    );
    const status = await new PaystackPaymentsAdapter('sk', 'https://api.example.test', impl).verifyDeposit('jd-1');
    expect(calls[0]!.url).toBe('https://api.example.test/transaction/verify/jd-1');
    expect(status).toEqual({
      status: 'success',
      amountKobo: 499_000,
      feesKobo: 7_485,
      currency: 'NGN',
      senderName: 'ADA OBI',
      senderBank: 'GTBank',
    });
  });

  it('maps transfer statuses and errors', async () => {
    let answer = 'reversed';
    const { impl } = fakeFetch(({ url }) =>
      url.includes('/transfer/verify')
        ? ok({ status: answer })
        : Response.json({ status: false, message: 'Insufficient balance' }, { status: 400 }),
    );
    const adapter = new PaystackPaymentsAdapter('sk', 'https://api.example.test', impl);
    expect((await adapter.verifyTransfer('jp-1')).status).toBe('failed');
    answer = 'otp';
    expect((await adapter.verifyTransfer('jp-1')).status).toBe('pending');
    answer = 'success';
    expect((await adapter.verifyTransfer('jp-1')).status).toBe('success');
    await expect(
      adapter.transfer({ reference: 'jp-2', amountKobo: 1, recipientCode: 'RCP', reason: 'x' }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Insufficient balance',
    });
  });

  it('pages through the bank list', async () => {
    const { impl, calls } = fakeFetch(({ url }) =>
      url.includes('next=')
        ? ok([{ code: '044', name: 'Access Bank', active: true }], { next: null })
        : ok(
            [
              { code: '058', name: 'GTBank', active: true },
              { code: '999', name: 'Closed', active: false },
            ],
            { next: 'abc' },
          ),
    );
    const banks = await new PaystackPaymentsAdapter('sk', 'https://api.example.test', impl).listBanks();
    expect(banks).toEqual([
      { code: '058', name: 'GTBank' },
      { code: '044', name: 'Access Bank' },
    ]);
    expect(calls).toHaveLength(2);
  });

  it('checks the webhook signature against the raw body', () => {
    const adapter = new PaystackPaymentsAdapter('sk_live_secret');
    const body = Buffer.from(JSON.stringify({ event: 'charge.success', data: { id: 42, reference: 'jd-9' } }));
    const signature = createHmac('sha512', 'sk_live_secret').update(body).digest('hex');
    expect(adapter.parseWebhook(body, { 'x-paystack-signature': signature })).toMatchObject({
      kind: 'deposit',
      reference: 'jd-9',
      eventKey: 'charge.success:42',
    });
    expect(adapter.parseWebhook(body, { 'x-paystack-signature': 'nope' })).toBeNull();
    expect(adapter.parseWebhook(Buffer.from(body.toString() + ' '), { 'x-paystack-signature': signature })).toBeNull();
    const transfer = Buffer.from(JSON.stringify({ event: 'transfer.failed', data: { id: 7, reference: 'jp-3' } }));
    const sig = createHmac('sha512', 'sk_live_secret').update(transfer).digest('hex');
    expect(adapter.parseWebhook(transfer, { 'x-paystack-signature': sig })).toMatchObject({
      kind: 'transfer',
      reference: 'jp-3',
    });
  });
  const owner = {
    ownerRef: 'jva-u1',
    email: 'u1@customers.jiffoapp.com',
    firstName: 'Ada',
    lastName: 'Okafor',
    phone: '+2348030000000',
    bvn: '22212345678',
    bankCode: '058',
    accountNumber: '0123456789',
  };
  const signed = (adapter: PaystackPaymentsAdapter, secret: string, payload: unknown) => {
    const body = Buffer.from(JSON.stringify(payload));
    return adapter.parseWebhook(body, {
      'x-paystack-signature': createHmac('sha512', secret).update(body).digest('hex'),
    });
  };

  it('issues a dedicated account by creating and identifying the customer, then waits', async () => {
    const { impl, calls } = fakeFetch(({ url, init }) =>
      url.endsWith('/customer') && init.method === 'POST'
        ? ok({ customer_code: 'CUS_1' })
        : url.endsWith('/customer/CUS_1')
          ? ok({ identified: false, identifications: null, dedicated_account: null })
          : ok(null),
    );
    const adapter = new PaystackPaymentsAdapter('sk_live_1', 'https://api.example.test', impl);
    expect(await adapter.issueFixedAccount(owner)).toEqual({ status: 'pending', providerRef: 'CUS_1' });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      email: owner.email,
      first_name: 'Ada',
      last_name: 'Okafor',
      metadata: { owner_ref: 'jva-u1' },
    });
    expect(calls[2]!.url).toBe('https://api.example.test/customer/CUS_1/identification');
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({
      country: 'NG',
      type: 'bank_account',
      bvn: '22212345678',
      bank_code: '058',
      account_number: '0123456789',
      first_name: 'Ada',
      last_name: 'Okafor',
    });
  });

  it('gives the account a customer already has, without identifying them again', async () => {
    const { impl, calls } = fakeFetch(({ url, init }) =>
      url.endsWith('/customer') && init.method === 'POST'
        ? ok({ customer_code: 'CUS_2' })
        : ok({
            identified: true,
            dedicated_account: {
              account_number: '9930000001',
              account_name: 'JIFFO/ADA OKAFOR',
              bank: { name: 'Wema Bank' },
            },
          }),
    );
    const adapter = new PaystackPaymentsAdapter('sk_live_1', 'https://api.example.test', impl);
    expect(await adapter.issueFixedAccount(owner)).toEqual({
      status: 'active',
      providerRef: 'CUS_2',
      accountNumber: '9930000001',
      accountName: 'JIFFO/ADA OKAFOR',
      bankName: 'Wema Bank',
    });
    expect(calls).toHaveLength(2);
  });

  it('assigns the account once the customer is identified, at the bank set (a test bank on test keys)', async () => {
    const account = { account_number: '9930000002', account_name: 'JIFFO/ADA OKAFOR', bank: { name: 'Wema Bank' } };
    const respond = ({ url }: Call) => (url.endsWith('/dedicated_account') ? ok(account) : ok({ identified: true }));
    const live = fakeFetch(respond);
    await new PaystackPaymentsAdapter(
      'sk_live_1',
      'https://api.example.test',
      live.impl,
      'titan-paystack',
    ).fixedAccountState('CUS_3');
    expect(JSON.parse(String(live.calls[1]!.init.body))).toEqual({
      customer: 'CUS_3',
      preferred_bank: 'titan-paystack',
    });
    const test = fakeFetch(respond);
    const state = await new PaystackPaymentsAdapter(
      'sk_test_1',
      'https://api.example.test',
      test.impl,
    ).fixedAccountState('CUS_3');
    expect(state).toMatchObject({ status: 'active', accountNumber: '9930000002' });
    expect(JSON.parse(String(test.calls[1]!.init.body)).preferred_bank).toBe('test-bank');
  });

  it('says why identification failed, counting only the latest attempt', async () => {
    const adapter = (customer: unknown) =>
      new PaystackPaymentsAdapter('sk_live_1', 'https://api.example.test', fakeFetch(() => ok(customer)).impl);
    expect(
      await adapter({
        identified: false,
        identifications: [
          { status: 'failed', reason: 'Account number or BVN is incorrect', createdAt: '2026-11-13T10:00:00Z' },
        ],
      }).fixedAccountState('CUS_4'),
    ).toEqual({ status: 'failed', providerRef: 'CUS_4', reason: 'Account number or BVN is incorrect' });
    expect(
      await adapter({
        identified: false,
        identifications: [
          { status: 'pending', createdAt: '2026-11-13T11:00:00Z' },
          { status: 'failed', reason: 'Wrong BVN', createdAt: '2026-11-13T10:00:00Z' },
        ],
      }).fixedAccountState('CUS_4'),
    ).toEqual({ status: 'pending', providerRef: 'CUS_4' });

    const refused = fakeFetch(({ url, init }) =>
      url.endsWith('/identification')
        ? Response.json({ status: false, message: 'Invalid BVN' }, { status: 400 })
        : url.endsWith('/customer') && init.method === 'POST'
          ? ok({ customer_code: 'CUS_5' })
          : ok({ identified: false }),
    );
    expect(
      await new PaystackPaymentsAdapter('sk_live_1', 'https://api.example.test', refused.impl).issueFixedAccount(owner),
    ).toEqual({ status: 'failed', providerRef: 'CUS_5', reason: 'Invalid BVN' });
  });

  it('tells transfers into a dedicated account, and account events, from one-time top-ups', async () => {
    const adapter = new PaystackPaymentsAdapter('sk_live_secret');
    expect(
      signed(adapter, 'sk_live_secret', {
        event: 'charge.success',
        data: { id: 1, reference: 'T1', channel: 'dedicated_nuban' },
      }),
    ).toMatchObject({ kind: 'fixed_deposit', paymentRef: 'T1' });
    expect(
      signed(adapter, 'sk_live_secret', {
        event: 'charge.success',
        data: { id: 2, reference: 'T2', authorization: { channel: 'dedicated_nuban' } },
      }),
    ).toMatchObject({ kind: 'fixed_deposit', paymentRef: 'T2' });
    expect(
      signed(adapter, 'sk_live_secret', { event: 'customeridentification.failed', data: { customer_code: 'CUS_6' } }),
    ).toMatchObject({ kind: 'fixed_account', providerRef: 'CUS_6' });
    expect(
      signed(adapter, 'sk_live_secret', {
        event: 'dedicatedaccount.assign.success',
        data: { customer: { customer_code: 'CUS_7' } },
      }),
    ).toMatchObject({ kind: 'fixed_account', providerRef: 'CUS_7' });
  });

  it('confirms a transfer into a dedicated account with whose it was', async () => {
    const { impl, calls } = fakeFetch(() =>
      ok({
        status: 'success',
        amount: 1_000_000,
        fees: 10_000,
        currency: 'NGN',
        customer: { customer_code: 'CUS_8' },
        authorization: { sender_name: 'ADA OKAFOR', sender_bank: 'GTBank' },
      }),
    );
    expect(await new PaystackPaymentsAdapter('sk', 'https://api.example.test', impl).verifyFixedPayment('T9')).toEqual({
      status: 'success',
      amountKobo: 1_000_000,
      feesKobo: 10_000,
      currency: 'NGN',
      senderName: 'ADA OKAFOR',
      senderBank: 'GTBank',
      providerRef: 'CUS_8',
    });
    expect(calls[0]!.url).toBe('https://api.example.test/transaction/verify/T9');
  });
});

describe('Google maps', () => {
  it('searches with the key and field mask, biased to the country', async () => {
    const { impl, calls } = fakeFetch(() =>
      Response.json({
        suggestions: [
          {
            placePrediction: {
              placeId: 'abc',
              structuredFormat: { mainText: { text: 'Shoprite' }, secondaryText: { text: 'Lekki, Lagos' } },
            },
          },
        ],
      }),
    );
    const maps = new GoogleMapsAdapter('key-1', impl);
    const found = await maps.autocomplete({
      query: 'shoprite',
      countryCode: 'NG',
      near: { lat: 6.4, lng: 3.4 },
      sessionToken: 's1',
    });
    expect(found).toEqual([{ placeId: 'abc', title: 'Shoprite', subtitle: 'Lekki, Lagos' }]);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('key-1');
    expect(headers['x-goog-fieldmask']).toContain('placePrediction');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      input: 'shoprite',
      includedRegionCodes: ['ng'],
      sessionToken: 's1',
    });
  });

  it('reads place details and falls back to an estimate when routing fails', async () => {
    let routes = false;
    const { impl } = fakeFetch(({ url }) => {
      if (url.includes('computeRoutes')) {
        routes = true;
        return new Response('quota', { status: 429 });
      }
      return Response.json({
        id: 'abc',
        displayName: { text: 'Shoprite' },
        formattedAddress: 'Lekki',
        location: { latitude: 6.44, longitude: 3.47 },
        addressComponents: [{ longText: 'Lagos', types: ['administrative_area_level_1', 'political'] }],
      });
    });
    const maps = new GoogleMapsAdapter('key-1', impl);
    expect(await maps.place('abc')).toEqual({
      placeId: 'abc',
      name: 'Shoprite',
      address: 'Lekki',
      lat: 6.44,
      lng: 3.47,
      region: 'Lagos',
    });
    const route = await maps.route([
      { lat: 6.4474, lng: 3.4723 },
      { lat: 6.4311, lng: 3.4158 },
    ]);
    expect(routes).toBe(true);
    expect(route.distanceMeters).toBeGreaterThan(8_000);
  });

  it('treats an unknown place as not found, and other failures as unavailable', async () => {
    let status = 404;
    const { impl } = fakeFetch(() => new Response('{"error":{"status":"NOT_FOUND"}}', { status }));
    const maps = new GoogleMapsAdapter('key-1', impl);
    expect(await maps.place('stale-id')).toBeNull();
    status = 500;
    await expect(maps.place('abc')).rejects.toMatchObject({ status: 503 });
    status = 200;
    const broken = new GoogleMapsAdapter(
      'key-1',
      (async () => new Response('<html>', { status: 200 })) as typeof fetch,
    );
    await expect(broken.place('abc')).rejects.toMatchObject({ status: 503 });
  });

  it('reads the route distance and duration', async () => {
    const { impl, calls } = fakeFetch(() => Response.json({ routes: [{ distanceMeters: 9_120, duration: '1260s' }] }));
    const maps = new GoogleMapsAdapter('key-1', impl);
    const route = await maps.route([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 2 },
      { lat: 3, lng: 3 },
    ]);
    expect(route).toEqual({ distanceMeters: 9_120, durationSeconds: 1_260 });
    expect(JSON.parse(String(calls[0]!.init.body)).intermediates).toHaveLength(1);
  });
});

describe('PIN encryption', () => {
  it('round-trips and detects tampering', () => {
    const key = randomBytes(32).toString('hex');
    const sealed = encrypt(key, '4821');
    expect(sealed).not.toContain('4821');
    expect(decrypt(key, sealed)).toBe('4821');
    expect(encrypt(key, '4821')).not.toBe(sealed);
    const [iv, tag, body] = sealed.split('.');
    expect(() => decrypt(key, [iv, tag, `${body}A`].join('.'))).toThrow();
    expect(() => decrypt(randomBytes(32).toString('hex'), sealed)).toThrow();
  });
});

describe('config', () => {
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    OTP_SECRET: 'y'.repeat(32),
    PIN_KEY: 'a'.repeat(64),
  };

  it('needs provider credentials when the environment names a provider, and the secrets key in production', () => {
    expect(() => loadConfig({ ...base, MESSAGING_PROVIDER: 'termii' })).toThrow(/TERMII_API_KEY/);
    expect(loadConfig(base)).toMatchObject({ PORT: 3000, MESSAGING_PROVIDER: 'console', TIMER_PROVIDER: 'bullmq' });
    // Providers can be set in the admin panel instead, so production doesn't need them in the environment.
    const live = { ...base, NODE_ENV: 'production', SECRETS_KEY: 'a'.repeat(64) };
    expect(() => loadConfig({ ...live, SECRETS_KEY: undefined })).toThrow(/SECRETS_KEY/);
    expect(() => loadConfig(live)).toThrow(/TRUST_PROXY_HOPS/);
    expect(() => loadConfig({ ...live, TRUST_PROXY_HOPS: '1' })).toThrow(/ADMIN_PANEL_SECRET/);
    expect(() => loadConfig({ ...live, TRUST_PROXY_HOPS: '1', ADMIN_PANEL_SECRET: 'z'.repeat(32) })).toThrow(
      /ADMIN_URL/,
    );
    const ready = {
      ...live,
      TRUST_PROXY_HOPS: '1',
      ADMIN_PANEL_SECRET: 'z'.repeat(32),
      ADMIN_URL: 'https://admin.jiffoapp.com',
    };
    expect(loadConfig(ready).TRUST_PROXY_HOPS).toBe(1);
    expect(() => loadConfig({ ...ready, ADMIN_PANEL_SECRET: 'too short' })).toThrow(/ADMIN_PANEL_SECRET/);
  });
});

describe('BullMQ errand timers', () => {
  let timers: BullMqErrandTimers | null = null;
  afterEach(async () => {
    await timers?.onApplicationShutdown();
    timers = null;
  });

  it('fires a job after its delay, once', async () => {
    timers = new BullMqErrandTimers(loadConfig({ ...process.env, TIMER_PROVIDER: 'bullmq' }));
    const fired: ErrandTimerJob[] = [];
    const job: ErrandTimerJob = { errandId: randomUUID(), event: 'auto_release', status: 'photo_pending', version: 7 };
    const done = new Promise<void>((resolve) =>
      timers!.setHandler(async (j) => {
        fired.push(j);
        resolve();
      }),
    );
    timers.onApplicationBootstrap();
    const start = Date.now();
    await timers.schedule(job, 200);
    await timers.schedule(job, 200); // the same timer twice is stored once
    await done;
    expect(Date.now() - start).toBeGreaterThanOrEqual(190);
    await new Promise((r) => setTimeout(r, 300));
    expect(fired).toEqual([job]);
  });
});

describe("Africa's Talking SMS", () => {
  const sent = (statusCode: number, status = 201) =>
    new Response(JSON.stringify({ SMSMessageData: { Recipients: [{ statusCode, status: 'Success' }] } }), { status });

  it('sends the code from the sender ID, and refuses a recipient it did not accept', async () => {
    const { impl, calls } = fakeFetch(() => sent(101));
    await new AfricasTalkingMessagingAdapter('jiffo', 'at-key', 'Jiffo', impl).sendOtp('+2348031234567', '123456', 300);
    expect(calls[0]!.url).toBe('https://api.africastalking.com/version1/messaging');
    expect(calls[0]!.init.headers).toMatchObject({ apikey: 'at-key', accept: 'application/json' });
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(Object.fromEntries(form)).toMatchObject({ username: 'jiffo', to: '+2348031234567', from: 'Jiffo' });
    expect(form.get('message')).toContain('123456');

    const refused = fakeFetch(() => sent(403));
    await expect(
      new AfricasTalkingMessagingAdapter('jiffo', 'k', undefined, refused.impl).sendOtp('+2348031234567', '1', 60),
    ).rejects.toMatchObject({ response: { error: { code: 'sms_failed' } } });
    const sandbox = fakeFetch(() => sent(100));
    await new AfricasTalkingMessagingAdapter('sandbox', 'k', undefined, sandbox.impl).sendOtp(
      '+2348031234567',
      '1',
      60,
    );
    expect(sandbox.calls[0]!.url).toBe('https://api.sandbox.africastalking.com/version1/messaging');
    expect(new URLSearchParams(String(sandbox.calls[0]!.init.body)).has('from')).toBe(false);
  });
});

describe('calls providers', () => {
  it("rings the caller through Africa's Talking, and dials the other person on answer", async () => {
    const { impl, calls } = fakeFetch(
      () =>
        new Response(JSON.stringify({ entries: [{ status: 'Queued', sessionId: 'ATVId_1' }], errorMessage: 'None' })),
    );
    const at = new AfricasTalkingCallsAdapter('jiffo', 'at-key', '+2342017001000', impl);
    expect(await at.bridge({ reference: 'call-1', from: '+2348031111111', to: '+2348032222222' })).toEqual({
      providerRef: 'ATVId_1',
    });
    expect(calls[0]!.url).toBe('https://voice.africastalking.com/call');
    expect(Object.fromEntries(new URLSearchParams(String(calls[0]!.init.body)))).toEqual({
      username: 'jiffo',
      from: '+2342017001000',
      to: '+2348031111111',
      clientRequestId: 'call-1',
    });
    expect(at.connect('+2348032222222').body).toContain(
      '<Dial phoneNumbers="+2348032222222" callerId="+2342017001000" record="false"/>',
    );
    expect(at.connect(null).body).toContain('<Say>');

    const failed = fakeFetch(
      () => new Response(JSON.stringify({ entries: [{ status: 'InvalidPhoneNumber', errorMessage: 'bad number' }] })),
    );
    await expect(
      new AfricasTalkingCallsAdapter('jiffo', 'k', '+2342017001000', failed.impl).bridge({
        reference: 'r',
        from: '+1',
        to: '+2',
      }),
    ).rejects.toThrow(/bad number/);
  });

  it('rings the caller through Twilio with the dial instructions in the same request', async () => {
    const { impl, calls } = fakeFetch(
      () => new Response(JSON.stringify({ sid: 'CA123', status: 'queued' }), { status: 201 }),
    );
    const twilio = new TwilioCallsAdapter('AC1', 'token', '+15550001111', impl);
    expect(await twilio.bridge({ reference: 'r', from: '+2348031111111', to: '+2348032222222' })).toEqual({
      providerRef: 'CA123',
    });
    expect(calls[0]!.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC1/Calls.json');
    expect(calls[0]!.init.headers).toMatchObject({
      authorization: `Basic ${Buffer.from('AC1:token').toString('base64')}`,
    });
    const form = new URLSearchParams(String(calls[0]!.init.body));
    expect(form.get('To')).toBe('+2348031111111');
    expect(form.get('From')).toBe('+15550001111');
    expect(form.get('Twiml')).toBe(
      '<Response><Dial callerId="+15550001111" record="do-not-record"><Number>+2348032222222</Number></Dial></Response>',
    );
    const suspended = fakeFetch(() => new Response(JSON.stringify({ status: 'suspended' })));
    await expect(new TwilioCallsAdapter('AC1', 't', '+1', suspended.impl).check()).rejects.toThrow(/suspended/);
  });
});

describe('Flutterwave payments', () => {
  const ok = (data: unknown) => new Response(JSON.stringify({ status: 'success', message: 'ok', data }));
  const refused = (message: string, status = 400) =>
    new Response(JSON.stringify({ status: 'error', message }), { status });
  const make = (impl: typeof fetch) =>
    new FlutterwavePaymentsAdapter('FLWSECK-test', 'hash-123', 'Jiffo', 'https://api.flutterwave.test', impl);

  it('reads Flutterwave dates as Lagos time', () => {
    expect(parseFlutterwaveDate('2026-11-13 3:00:00 PM')?.toISOString()).toBe('2026-11-13T14:00:00.000Z');
    expect(parseFlutterwaveDate('2026-11-13 12:05:00 AM')?.toISOString()).toBe('2026-11-12T23:05:00.000Z');
    expect(parseFlutterwaveDate('2026-11-13T15:00:00Z')?.toISOString()).toBe('2026-11-13T15:00:00.000Z');
    expect(parseFlutterwaveDate('soon')).toBeNull();
  });

  it('issues a one-time account in naira and checks the payment by our reference, in kobo', async () => {
    const ours = new Date('2026-11-13T14:30:00Z');
    const { impl, calls } = fakeFetch(({ url }) =>
      url.includes('virtual-account-numbers')
        ? ok({ account_number: '7824822527', bank_name: 'WEMA BANK', expiry_date: '2026-11-13 3:00:00 PM' })
        : ok({ status: 'successful', amount: 5000, app_fee: 70, currency: 'NGN', meta: { originatorname: 'ADA OBI' } }),
    );
    const flw = make(impl);
    const account = await flw.createTransferDeposit({
      reference: 'jd-1',
      amountKobo: 500_000,
      email: 'u@customers.jiffoapp.com',
      expiresAt: ours,
    });
    // Theirs is 14:00 UTC, earlier than ours: theirs is shown.
    expect(account).toEqual({
      accountNumber: '7824822527',
      accountName: 'Jiffo',
      bankName: 'WEMA BANK',
      expiresAt: new Date('2026-11-13T14:00:00Z'),
    });
    expect(calls[0]!.url).toBe('https://api.flutterwave.test/v3/virtual-account-numbers');
    expect(calls[0]!.init.headers).toMatchObject({ authorization: 'Bearer FLWSECK-test' });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      is_permanent: false,
      tx_ref: 'jd-1',
      amount: 5000,
    });

    expect(await flw.verifyDeposit('jd-1')).toEqual({
      status: 'success',
      amountKobo: 500_000,
      feesKobo: 7_000,
      currency: 'NGN',
      senderName: 'ADA OBI',
      senderBank: null,
    });
    expect(calls[1]!.url).toBe('https://api.flutterwave.test/v3/transactions/verify_by_reference?tx_ref=jd-1');

    // Nothing paid yet means waiting; any other refusal is an error, not "waiting".
    expect(
      (await make(fakeFetch(() => refused('No transaction was found for this id')).impl).verifyDeposit('x')).status,
    ).toBe('pending');
    await expect(
      make(fakeFetch(() => refused('Invalid authorization key', 401)).impl).verifyDeposit('x'),
    ).rejects.toThrow(/Invalid authorization/);
  });

  it('pays out to bank details and looks transfers up by their id, or by our reference', async () => {
    const { impl, calls } = fakeFetch(({ url }) =>
      url.endsWith('/v3/transfers')
        ? ok({ id: 190626, status: 'NEW', fee: 10.75 })
        : url.endsWith('/v3/transfers/190626')
          ? ok({ id: 190626, status: 'SUCCESSFUL', fee: 10.75 })
          : ok([
              { reference: 'jp-0', status: 'FAILED' },
              { reference: 'jp-1', status: 'SUCCESSFUL', fee: 10.75 },
            ]),
    );
    const flw = make(impl);
    expect(
      await flw.transfer({
        reference: 'jp-1',
        amountKobo: 90_000,
        bankCode: '058',
        accountNumber: '0123456789',
        reason: 'Jiffo earnings',
      }),
    ).toEqual({ status: 'pending', transferCode: '190626', reason: 'NEW', feeKobo: 1_075 });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      account_bank: '058',
      account_number: '0123456789',
      amount: 900,
      reference: 'jp-1',
      currency: 'NGN',
    });
    expect(await flw.verifyTransfer('jp-1', '190626')).toMatchObject({ status: 'success', feeKobo: 1_075 });
    expect(calls[1]!.url).toBe('https://api.flutterwave.test/v3/transfers/190626');
    expect(await flw.verifyTransfer('jp-1')).toMatchObject({ status: 'success' });
    expect(calls[2]!.url).toBe('https://api.flutterwave.test/v3/transfers?reference=jp-1');
    await expect(flw.verifyTransfer('jp-9')).rejects.toThrow(/did not list/);

    // A reference Flutterwave already has may have gone through: never treated as a refusal.
    const duplicate = fakeFetch(() => refused('Duplicate reference: transfer already exists'));
    await expect(
      make(duplicate.impl).transfer({
        reference: 'jp-1',
        amountKobo: 1,
        bankCode: '058',
        accountNumber: '0',
        reason: 'r',
      }),
    ).rejects.toMatchObject({ response: { error: { code: 'payments_unavailable' } } });
  });

  it('trusts a webhook only with the secret hash, and keys one without an id by its body', () => {
    const flw = make(fakeFetch(() => ok({})).impl);
    const body = Buffer.from(
      JSON.stringify({ event: 'charge.completed', data: { id: 1, tx_ref: 'jd-1', status: 'successful' } }),
    );
    expect(flw.parseWebhook(body, { 'verif-hash': 'hash-123' })).toMatchObject({ kind: 'deposit', reference: 'jd-1' });
    expect(flw.parseWebhook(body, { 'verif-hash': 'nope' })).toBeNull();
    expect(flw.parseWebhook(body, {})).toBeNull();
    const transfer = Buffer.from(JSON.stringify({ event: 'transfer.completed', data: { id: 2, reference: 'jp-1' } }));
    expect(flw.parseWebhook(transfer, { 'verif-hash': 'hash-123' })).toMatchObject({
      kind: 'transfer',
      reference: 'jp-1',
    });
    const a = flw.parseWebhook(Buffer.from('{"event":"x","data":{"n":1}}'), { 'verif-hash': 'hash-123' })!;
    const b = flw.parseWebhook(Buffer.from('{"event":"x","data":{"n":2}}'), { 'verif-hash': 'hash-123' })!;
    expect(a.eventKey).not.toBe(b.eventKey);
  });
  it('issues a permanent account with the BVN, keyed by our reference for the customer', async () => {
    const { impl, calls } = fakeFetch(() =>
      ok({ account_number: '7824822528', bank_name: 'WEMA BANK', order_ref: 'URF_1', flw_ref: 'FLW-1' }),
    );
    const state = await make(impl).issueFixedAccount({
      ownerRef: 'jva-u1',
      email: 'u1@customers.jiffoapp.com',
      firstName: 'Ada',
      lastName: 'Okafor',
      phone: '+2348030000000',
      bvn: '22212345678',
    });
    expect(state).toEqual({
      status: 'active',
      providerRef: 'URF_1',
      accountNumber: '7824822528',
      accountName: 'Jiffo Ada Okafor',
      bankName: 'WEMA BANK',
    });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      is_permanent: true,
      bvn: '22212345678',
      tx_ref: 'jva-u1',
      firstname: 'Ada',
      lastname: 'Okafor',
    });
    const failed = await make(fakeFetch(() => refused('BVN is invalid')).impl).issueFixedAccount({
      ownerRef: 'jva-u2',
      email: 'e',
      firstName: 'A',
      lastName: 'B',
      phone: 'p',
      bvn: '1',
    });
    expect(failed).toEqual({ status: 'failed', providerRef: null, reason: 'BVN is invalid' });
  });

  it('credits a transfer into a permanent account by its transaction id, with whose account it was', async () => {
    const flw = make(fakeFetch(() => ok({})).impl);
    const body = Buffer.from(
      JSON.stringify({ event: 'charge.completed', data: { id: 99, tx_ref: 'jva-u1', status: 'successful' } }),
    );
    expect(flw.parseWebhook(body, { 'verif-hash': 'hash-123' })).toMatchObject({
      kind: 'fixed_deposit',
      paymentRef: '99',
    });
    const { impl, calls } = fakeFetch(() =>
      ok({
        status: 'successful',
        amount: 2500,
        app_fee: 25,
        currency: 'NGN',
        tx_ref: 'jva-u1',
        meta: { originatorname: 'ADA OKAFOR', bankname: 'GTBank' },
      }),
    );
    expect(await make(impl).verifyFixedPayment('99')).toEqual({
      status: 'success',
      amountKobo: 250_000,
      feesKobo: 2_500,
      currency: 'NGN',
      senderName: 'ADA OKAFOR',
      senderBank: 'GTBank',
      ownerRef: 'jva-u1',
    });
    expect(calls[0]!.url).toBe('https://api.flutterwave.test/v3/transactions/99/verify');
  });
});
