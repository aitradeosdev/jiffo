import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { TermiiMessagingAdapter } from '../src/adapters/messaging';
import { FcmPushAdapter } from '../src/adapters/push';
import { PaystackPaymentsAdapter } from '../src/adapters/payments';
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

  it('needs provider credentials and real providers in production', () => {
    expect(() => loadConfig({ ...base, MESSAGING_PROVIDER: 'termii' })).toThrow(/TERMII_API_KEY/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/MESSAGING_PROVIDER/);
    expect(loadConfig(base)).toMatchObject({ PORT: 3000, MESSAGING_PROVIDER: 'console', TIMER_PROVIDER: 'bullmq' });
    const live = {
      ...base,
      NODE_ENV: 'production',
      MESSAGING_PROVIDER: 'termii',
      TERMII_API_KEY: 'k',
      TERMII_SENDER_ID: 'Jiffo',
      PUSH_PROVIDER: 'fcm',
      FCM_SERVICE_ACCOUNT_JSON: '{}',
      PAYMENTS_PROVIDER: 'paystack',
      PAYSTACK_SECRET_KEY: 'sk_test_x',
      MAPS_PROVIDER: 'google',
      GOOGLE_MAPS_API_KEY: 'maps-key',
      STORAGE_PROVIDER: 's3',
      S3_BUCKET: 'jiffo-files',
    };
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
