import { randomUUID } from 'node:crypto';
import { and, count, eq, gt } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config';
import { OtpService } from '../src/auth/otp.service';
import { alerts, otpChallenges } from '../src/db/schema';
import { adminAs, approved, createTestApp, randomIp, randomPhone, type TestApp } from './helpers';

/**
 * Sign-in codes, Live or Test, per country (Settings, Security). Live texts each code. Test sends no text and
 * gives the code to the app, which shows it on the code screen: for trying the apps without an SMS provider.
 * Anyone can then sign in to any number in that country, so production refuses Test unless the server allows
 * it, and ignores one saved before that.
 */
describe('sign-in codes, Live and Test', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let original: { settings: { security: Record<string, unknown> & { signInCodes: string } } };

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
  });
  afterAll(async () => {
    // Saved back as a new version, so the other tests' codes are texted again.
    await security(original.settings.security);
    await t.close();
  });

  /** Saves Nigeria's security settings with these changes, asked by one owner and approved by another. */
  async function security(changes: Record<string, unknown>) {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    Object.assign(settings.security, changes);
    return approved(t, 'owner', (h) =>
      request(t.http)
        .post('/v1/admin/settings?country=NG')
        .set(h)
        .send({ basedOn: now.version, settings, note: 'Sign-in codes for a test' }),
    );
  }
  const codes = (signInCodes: string) => security({ signInCodes });
  const ask = (phone: string, ip = randomIp()) =>
    request(t.http).post('/v1/auth/otp/request').set('x-forwarded-for', ip).send({ phone });
  const verify = (phone: string, code: string, ip = randomIp()) =>
    request(t.http)
      .post('/v1/auth/otp/verify')
      .set('x-forwarded-for', ip)
      .send({ phone, code, app: 'customer', device: { key: randomUUID(), platform: 'android' } });

  it('are texted by default, and never sent back to the app', async () => {
    expect(original.settings.security.signInCodes).toBe('live');
    const phone = randomPhone();
    const sent = (await ask(phone).expect(200)).body;
    expect(sent).not.toHaveProperty('testCode');
    expect(t.messaging.lastCodeFor(phone)).toMatch(/^\d{6}$/);
  });

  it('in Test, go to the app instead of by text, and sign in as a texted one does', async () => {
    expect((await codes('test')).status).toBe(200);
    const phone = randomPhone();
    const ip = randomIp();
    const sent = (await ask(phone, ip).expect(200)).body;
    expect(sent.testCode).toMatch(/^\d{6}$/);
    expect(t.messaging.lastCodeFor(phone)).toBeUndefined();
    // Kept as one shown in the app, so it's never counted as a paid text, and can be told apart later.
    const [row] = await t.db.select().from(otpChallenges).where(eq(otpChallenges.phone, phone));
    expect(row).toMatchObject({ shownInApp: true });

    // Every other rule holds: the wait before another code, the tries, a single use.
    expect((await ask(phone, ip)).body.error.code).toBe('otp_resend_wait');
    const wrong = sent.testCode === '000000' ? '111111' : '000000';
    expect((await verify(phone, wrong, ip)).body.error.attemptsLeft).toBeGreaterThan(0);
    await verify(phone, sent.testCode, ip).expect(200);
    expect((await verify(phone, sent.testCode, ip)).status).not.toBe(200);
  });

  it("aren't counted as paid texts by the daily SMS alert", async () => {
    const DAY = 86_400_000;
    const texted = async () =>
      (
        await t.db
          .select({ n: count() })
          .from(otpChallenges)
          .where(
            and(
              eq(otpChallenges.countryCode, 'NG'),
              eq(otpChallenges.shownInApp, false),
              gt(otpChallenges.createdAt, new Date(Date.now() - DAY)),
            ),
          )
      )[0]!.n;
    const smsAlert = and(eq(alerts.countryCode, 'NG'), eq(alerts.kind, 'sms_spend'));
    const raised = async () => (await t.db.select().from(alerts).where(smsAlert)).length;
    // Today's alert, raised by earlier tests, is cleared so a new one can be seen.
    await t.db.delete(alerts).where(smsAlert);
    expect((await security({ signInCodes: 'test', smsCodesDailyAlert: (await texted()) + 2 })).status).toBe(200);
    await ask(randomPhone()).expect(200);
    await ask(randomPhone()).expect(200);
    await t.app.get(OtpService).checkSpend();
    expect(await raised()).toBe(0);
    // The same two, texted, reach the level.
    expect((await codes('live')).status).toBe(200);
    await ask(randomPhone()).expect(200);
    await ask(randomPhone()).expect(200);
    await t.app.get(OtpService).checkSpend();
    expect(await raised()).toBe(1);
  });

  it('in production, Test is refused unless the server allows it, and one saved before is ignored', async () => {
    expect((await codes('test')).status).toBe(200);
    const config = t.app.get<AppConfig>(APP_CONFIG);
    const before = { env: config.NODE_ENV, allowed: config.ALLOW_TEST_SIGN_IN_CODES };
    try {
      config.NODE_ENV = 'production';
      config.ALLOW_TEST_SIGN_IN_CODES = false;
      // Saved while it was allowed: codes are texted all the same.
      const phone = randomPhone();
      const sent = (await ask(phone).expect(200)).body;
      expect(sent).not.toHaveProperty('testCode');
      expect(t.messaging.lastCodeFor(phone)).toMatch(/^\d{6}$/);
      // And it can't be saved again.
      const refused = await codes('test');
      expect(refused.status).toBe(400);
      expect(refused.body.error.issues).toEqual([expect.objectContaining({ path: 'security.signInCodes' })]);
      expect((await codes('live')).status).toBe(200);

      // A server set up to allow it (ALLOW_TEST_SIGN_IN_CODES), such as a shared test server.
      config.ALLOW_TEST_SIGN_IN_CODES = true;
      expect((await codes('test')).status).toBe(200);
      expect((await ask(randomPhone()).expect(200)).body.testCode).toMatch(/^\d{6}$/);
    } finally {
      config.NODE_ENV = before.env;
      config.ALLOW_TEST_SIGN_IN_CODES = before.allowed;
    }
  });

  it('show in the admin panel which countries are in Test', async () => {
    expect((await codes('test')).status).toBe(200);
    const me = (await request(t.http).get('/v1/admin/me').set(owner.headers).expect(200)).body;
    expect(me.countries.find((c: { code: string }) => c.code === 'NG')).toMatchObject({ signInCodes: 'test' });
    expect((await codes('live')).status).toBe(200);
    const after = (await request(t.http).get('/v1/admin/me').set(owner.headers).expect(200)).body;
    expect(after.countries.find((c: { code: string }) => c.code === 'NG')).toMatchObject({ signInCodes: 'live' });
  });
});
