import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { TermiiMessagingAdapter } from '../src/adapters/messaging';
import { FcmPushAdapter } from '../src/adapters/push';
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
    };
    expect(() => loadConfig(live)).toThrow(/TRUST_PROXY_HOPS/);
    expect(loadConfig({ ...live, TRUST_PROXY_HOPS: '1' }).TRUST_PROXY_HOPS).toBe(1);
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
