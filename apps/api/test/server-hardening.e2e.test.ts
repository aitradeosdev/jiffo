import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { providerFetch } from '../src/adapters/provider-fetch';
import { withNonce } from '../src/common/security-headers';
import { BUILDERS } from '../src/providers/builders';
import { randomUUID } from 'node:crypto';
import { MemoryStorageAdapter } from '../src/adapters/storage';
import { ProvidersService } from '../src/providers/providers.service';
import { createTestApp, randomIp, signIn, type TestApp } from './helpers';

/** Waits out the last seconds of a minute, so a test's requests all count in one window. */
async function freshMinute() {
  const left = 60 - ((Date.now() / 1000) % 60);
  if (left < 10) await new Promise((resolve) => setTimeout(resolve, left * 1000 + 200));
}

/** Abuse cases for the server's own defences (docs/security-plan.md, S3, S5, S9, P4, P11, findings 18, 20, 24). */
describe('server hardening', () => {
  let t: TestApp;
  const saved = { limits: process.env.RATE_LIMITS, ips: process.env.PAYSTACK_WEBHOOK_IPS };
  beforeAll(async () => {
    // This app has low limits and a Paystack allow-list; every other test file runs with neither.
    process.env.RATE_LIMITS = 'default=8,paid=2,auth=3,refresh=2,socket=2,ip=50';
    process.env.PAYSTACK_WEBHOOK_IPS = '52.31.139.75,52.49.173.169';
    t = await createTestApp();
  });
  afterAll(async () => {
    process.env.RATE_LIMITS = saved.limits;
    if (saved.ips === undefined) delete process.env.PAYSTACK_WEBHOOK_IPS;
    else process.env.PAYSTACK_WEBHOOK_IPS = saved.ips;
    await t.close();
  });

  describe('rate limits', () => {
    it('stop a person at their class’s limit a minute, and say when to try again', async () => {
      await freshMinute();
      const who = await signIn(t, 'customer');
      const ask = () => request(t.http).get('/v1/places/autocomplete?q=Lekki').set(who.headers);
      expect((await ask()).status).not.toBe(429);
      expect((await ask()).status).not.toBe(429);
      const third = await ask();
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('rate_limited');
      expect(Number(third.headers['retry-after'])).toBeGreaterThan(0);
      // Someone else on the same address has their own count.
      const other = await signIn(t, 'customer');
      expect((await request(t.http).get('/v1/places/autocomplete?q=Ikeja').set(other.headers)).status).not.toBe(429);
    });

    it('count anyone not signed in by their address, and refreshes by session', async () => {
      await freshMinute();
      const ip = randomIp();
      const code = () =>
        request(t.http).post('/v1/auth/otp/request').set('x-forwarded-for', ip).send({ phone: '12345' });
      for (let i = 0; i < 3; i++) expect((await code()).status).toBe(400);
      expect((await code()).status).toBe(429);
      // A made-up token doesn't buy a fresh count: it is counted by address as well.
      const forged = await request(t.http)
        .post('/v1/auth/otp/request')
        .set('x-forwarded-for', ip)
        .set('authorization', `Bearer ${randomUUID()}`)
        .send({ phone: '12345' });
      expect(forged.status).toBe(429);
      // Refreshes count per session, however many people share the address.
      const refresh = (token: string) =>
        request(t.http).post('/v1/auth/refresh').set('x-forwarded-for', ip).send({ refreshToken: token });
      for (let i = 0; i < 2; i++) expect((await refresh('a'.repeat(40))).status).toBe(401);
      expect((await refresh('a'.repeat(40))).status).toBe(429);
      expect((await refresh('b'.repeat(40))).status).toBe(401);
    });

    it('count signed-in people as themselves, not by the address they share', async () => {
      await freshMinute();
      const ip = randomIp();
      const people = await Promise.all([0, 1, 2].map(() => signIn(t, 'customer')));
      // Each well past the address's anonymous count, all from one address.
      for (const who of people) {
        for (let i = 0; i < 5; i++) {
          expect((await request(t.http).get('/v1/me').set('x-forwarded-for', ip).set(who.headers)).status).toBe(200);
        }
      }
    });

    it('limit new live connections per person', async () => {
      await freshMinute();
      const who = await signIn(t, 'customer');
      const sockets: Socket[] = [];
      const connect = () =>
        new Promise<boolean>((resolve) => {
          const socket = io(`${t.url}/realtime`, {
            auth: { token: who.accessToken },
            transports: ['websocket'],
            forceNew: true,
            reconnection: false,
          });
          sockets.push(socket);
          socket.once('ready', () => resolve(true));
          socket.once('auth_error', () => resolve(false));
        });
      try {
        expect(await connect()).toBe(true);
        expect(await connect()).toBe(true);
        expect(await connect()).toBe(false);
        // Someone else is unaffected.
        const other = await signIn(t, 'customer');
        const theirs = io(`${t.url}/realtime`, {
          auth: { token: other.accessToken },
          transports: ['websocket'],
          forceNew: true,
          reconnection: false,
        });
        sockets.push(theirs);
        expect(await new Promise((resolve) => theirs.once('ready', () => resolve(true)))).toBe(true);
      } finally {
        sockets.forEach((s) => s.disconnect());
      }
    });
  });

  describe('headers', () => {
    it('keep every answer from being sniffed, framed or run as a page', async () => {
      const res = await request(t.http).get('/health').set('x-forwarded-for', randomIp());
      expect(res.headers).toMatchObject({
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'no-referrer',
      });
      expect(res.headers['content-security-policy']).toContain("default-src 'none'");
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('let only a widget page’s own scripts run', () => {
      const { html, csp } = withNonce('<script src="https://widget.example/w.js"></script><script>go()</script>');
      const nonce = /nonce-([^']+)'/.exec(csp)![1]!;
      expect(html.match(/<script nonce="([^"]+)"/g)).toHaveLength(2);
      expect(html).toContain(`nonce="${nonce}"`);
      expect(csp).toContain("'strict-dynamic'");
      expect(csp).toContain("frame-ancestors 'none'");
    });
  });

  it('serves an uploaded file that isn’t a photo only as a download', async () => {
    const store = t.app.get(ProvidersService).current('storage') as MemoryStorageAdapter;
    const key = `test/${randomUUID()}.jpg`;
    const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const upload = new URL(
      (await store.presignUpload({ key, contentType: 'image/jpeg', size: bytes.length, ttlSeconds: 60 })).url,
    );
    // Signed for a photo, sent as an SVG.
    const ip = randomIp();
    await request(t.http)
      .put(upload.pathname + upload.search)
      .set('x-forwarded-for', ip)
      .set('content-type', 'image/svg+xml')
      .send(bytes)
      .expect(200);
    const download = new URL(await store.presignDownload(key, 60));
    const file = await request(t.http)
      .get(download.pathname + download.search)
      .set('x-forwarded-for', ip)
      .expect(200);
    expect(file.headers['content-type']).toBe('application/octet-stream');
    expect(file.headers['content-disposition']).toBe('attachment');
    expect(file.headers['content-security-policy']).toContain('sandbox');
  });

  it('takes Paystack’s calls only from its own addresses when they are set', async () => {
    const from = (ip: string) =>
      request(t.http)
        .post('/v1/webhooks/paystack')
        .set('x-forwarded-for', ip)
        .set('content-type', 'application/json')
        .send('{}');
    expect((await from('203.0.113.9')).status).toBe(403);
    // From Paystack's address it goes on to the signature check, which this unsigned body fails.
    expect((await from('52.31.139.75')).status).not.toBe(403);
  });

  describe('providers', () => {
    const ctx = (production: boolean) => ({
      publicApiUrl: 'https://api.jiffo.test',
      sign: () => 'x',
      hostedLink: () => 'x',
      production,
    });

    it('take live keys only in production, and test keys only outside it', () => {
      const paystack = BUILDERS.payments.paystack!;
      expect(() => paystack({ secretKey: 'sk_live_abc' }, ctx(false))).toThrow(/live keys are for production/i);
      expect(() => paystack({ secretKey: 'sk_test_abc' }, ctx(true))).toThrow(/needs a live key/i);
      expect(() => paystack({ secretKey: 'sk_test_abc' }, ctx(false))).not.toThrow();
      expect(() => paystack({ secretKey: 'sk_live_abc' }, ctx(true))).not.toThrow();
      const flutterwave = BUILDERS.payments.flutterwave!;
      expect(() =>
        flutterwave({ secretKey: 'FLWSECK-live', secretHash: 'h', businessName: 'J' }, ctx(false)),
      ).toThrow();
    });

    it('can’t be pointed at another host from the panel', () => {
      const termii = BUILDERS.sms.termii!;
      const base = { apiKey: 'k', senderId: 'Jiffo' };
      expect(() => termii({ ...base, baseUrl: 'https://evil.example' }, ctx(false))).toThrow(/Termii's own/);
      expect(() => termii({ ...base, baseUrl: 'http://api.ng.termii.com' }, ctx(false))).toThrow();
      expect(() => termii({ ...base, baseUrl: 'https://v3.api.termii.com' }, ctx(false))).not.toThrow();
      const paystack = BUILDERS.payments.paystack!;
      expect(() => paystack({ secretKey: 'sk_test_abc', baseUrl: 'https://evil.example' }, ctx(false))).toThrow();
      const s3 = BUILDERS.storage.s3!;
      const store = { bucket: 'b', region: 'r', accessKeyId: 'a', secretAccessKey: 's' };
      expect(() => s3({ ...store, endpoint: 'http://169.254.169.254' }, ctx(true))).toThrow(/public https/);
      expect(() => s3({ ...store, endpoint: 'https://account.r2.cloudflarestorage.com' }, ctx(true))).not.toThrow();
    });

    it('never follow a redirect from a provider', async () => {
      const server: Server = createServer((_req, res) => {
        res.writeHead(302, { location: 'https://elsewhere.example/steal' });
        res.end();
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      try {
        await expect(providerFetch(`http://127.0.0.1:${port}/`)).rejects.toThrow(/redirect to https:\/\/elsewhere/);
      } finally {
        server.close();
      }
    });
  });
});
