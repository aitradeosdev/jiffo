import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OtpService } from '../src/auth/otp.service';
import { sha256 } from '../src/common/crypto';
import { devices, otpChallenges, refreshTokens, sessions } from '../src/db/schema';
import { adminAs, createTestApp, randomIp, randomPhone, signIn, type TestApp, approved } from './helpers';

const device = () => ({ key: randomUUID(), platform: 'ios' as const });

describe('phone sign-in', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const requestCode = (phone: string, ip = randomIp()) =>
    request(t.http).post('/v1/auth/otp/request').set('x-forwarded-for', ip).send({ phone });
  const verify = (phone: string, code: string, app = 'customer') =>
    request(t.http).post('/v1/auth/otp/verify').send({ phone, code, app, device: device() });
  /** Moves earlier codes for the number back in time, past the resend wait. */
  const ageCodes = (phone: string, seconds: number) =>
    t.db
      .update(otpChallenges)
      .set({ createdAt: new Date(Date.now() - seconds * 1000) })
      .where(eq(otpChallenges.phone, phone));

  it('accepts local formats and signs a new person in', async () => {
    const local = `0${randomPhone().slice(4)}`;
    const sent = await requestCode(local).expect(200);
    expect(sent.body).toEqual({ phone: `+234${local.slice(1)}`, expiresInSeconds: 300, resendInSeconds: 60 });

    const code = t.messaging.lastCodeFor(sent.body.phone)!;
    expect(code).toMatch(/^\d{6}$/);
    const res = await verify(local, code).expect(200);
    expect(res.body).toMatchObject({ isNewUser: true, accessTokenExpiresIn: 900, user: { phone: sent.body.phone } });

    const me = await request(t.http).get('/v1/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ id: res.body.user.id, countryCode: 'NG', firstName: null });
  });

  it('stores only a hash of the code', async () => {
    const phone = randomPhone();
    await requestCode(phone).expect(200);
    const [row] = await t.db.select().from(otpChallenges).where(eq(otpChallenges.phone, phone));
    expect(row!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.codeHash).not.toContain(t.messaging.lastCodeFor(phone)!);
  });

  it('rejects numbers that are not valid or not in a live country', async () => {
    expect((await requestCode('12345').expect(400)).body.error.code).toBe('invalid_phone');
    // Landlines and toll-free numbers cannot receive the code.
    expect((await requestCode('+2342012345678').expect(400)).body.error.message).toBe('Enter a mobile number');
    expect((await requestCode('+2348001234567').expect(400)).body.error.code).toBe('invalid_phone');
    expect((await requestCode('+233241234567').expect(404)).body.error.code).toBe('country_not_available');
  });

  it('makes people wait before resending, then allows 3 codes in 15 minutes and 10 in a day', async () => {
    const phone = randomPhone();
    await requestCode(phone).expect(200);
    const wait = await requestCode(phone).expect(429);
    expect(wait.body.error).toMatchObject({ code: 'otp_resend_wait', retryAfterSeconds: expect.any(Number) });

    for (let i = 0; i < 2; i++) {
      await ageCodes(phone, 120);
      await requestCode(phone).expect(200);
    }
    await ageCodes(phone, 120);
    expect((await requestCode(phone).expect(429)).body.error.code).toBe('otp_rate_limited');
    // After 15 minutes, more, up to 10 in the day.
    for (let i = 3; i < 10; i++) {
      await ageCodes(phone, 16 * 60);
      await requestCode(phone).expect(200);
    }
    await ageCodes(phone, 16 * 60);
    expect((await requestCode(phone).expect(429)).body.error.code).toBe('otp_rate_limited');
  });

  it('doesn’t lock the owner’s phone out when someone else asks for codes to their number', async () => {
    const owner = await signIn(t, 'customer');
    const [phone] = await t.db.select().from(devices).where(eq(devices.userId, owner.userId));
    // A stranger uses up the number's limits for the day, from many addresses (signing in used one).
    for (let i = 1; i < 10; i++) {
      await ageCodes(owner.phone, 16 * 60);
      await requestCode(owner.phone).expect(200);
    }
    await ageCodes(owner.phone, 16 * 60);
    expect((await requestCode(owner.phone).expect(429)).body.error.code).toBe('otp_rate_limited');
    // The owner's own phone, already signed in to the number, still gets a code.
    await request(t.http)
      .post('/v1/auth/otp/request')
      .set('x-forwarded-for', randomIp())
      .send({ phone: owner.phone, deviceKey: phone!.deviceKey })
      .expect(200);
  });

  it('limits codes per phone too, across numbers', async () => {
    const deviceKey = randomUUID();
    const ask = (phone: string) =>
      request(t.http).post('/v1/auth/otp/request').set('x-forwarded-for', randomIp()).send({ phone, deviceKey });
    for (let i = 0; i < 3; i++) await ask(randomPhone()).expect(200);
    expect((await ask(randomPhone()).expect(429)).body.error.code).toBe('otp_rate_limited');
  });

  it('counts a burst from one address one at a time', async () => {
    const ip = randomIp();
    const burst = await Promise.all(Array.from({ length: 50 }, () => requestCode(randomPhone(), ip)));
    // Never more than the limit; the rest are told to wait, at once rather than queued.
    expect(burst.filter((r) => r.status === 200).length).toBeLessThanOrEqual(30);
    expect(burst.filter((r) => r.status !== 200).every((r) => r.status === 429)).toBe(true);
    // Sent one after another, exactly the limit gets through.
    const steady = randomIp();
    let sent = 0;
    for (let i = 0; i < 35; i += 1) if ((await requestCode(randomPhone(), steady)).status === 200) sent += 1;
    expect(sent).toBe(30);
  });

  it('limits codes per IP address across numbers', async () => {
    const ip = randomIp();
    for (let i = 0; i < 30; i++) await requestCode(randomPhone(), ip).expect(200);
    expect((await requestCode(randomPhone(), ip).expect(429)).body.error.code).toBe('otp_rate_limited');
    await requestCode(randomPhone()).expect(200);
  });

  it('counts wrong codes and locks the code after five', async () => {
    const phone = randomPhone();
    await requestCode(phone).expect(200);
    const code = t.messaging.lastCodeFor(phone)!;
    const wrong = code === '000000' ? '111111' : '000000';

    const first = await verify(phone, wrong).expect(400);
    expect(first.body.error).toMatchObject({ code: 'otp_invalid', attemptsLeft: 4 });
    for (let i = 0; i < 4; i++) await verify(phone, wrong).expect(400);
    expect((await verify(phone, code).expect(429)).body.error.code).toBe('otp_attempts_exceeded');
  });

  it('accepts a code once, and only the latest code', async () => {
    const phone = randomPhone();
    await requestCode(phone).expect(200);
    const old = t.messaging.lastCodeFor(phone)!;
    await ageCodes(phone, 120);
    await requestCode(phone).expect(200);
    const latest = t.messaging.lastCodeFor(phone)!;

    if (old !== latest) await verify(phone, old).expect(400);
    await verify(phone, latest).expect(200);
    expect((await verify(phone, latest).expect(400)).body.error.code).toBe('otp_expired');
  });

  it('refuses expired codes', async () => {
    const phone = randomPhone();
    await requestCode(phone).expect(200);
    await t.db
      .update(otpChallenges)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(otpChallenges.phone, phone));
    expect((await verify(phone, t.messaging.lastCodeFor(phone)!).expect(400)).body.error.code).toBe('otp_expired');
  });

  it('uses one account for both apps', async () => {
    const customer = await signIn(t, 'customer');
    await ageCodes(customer.phone, 120);
    const agent = await signIn(t, 'agent', { phone: customer.phone, firstName: null });
    expect(agent.userId).toBe(customer.userId);
  });

  it('rotates refresh tokens and ends the session when an old one is replayed', async () => {
    const person = await signIn(t, 'customer');
    const first = await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: person.refreshToken })
      .expect(200);
    expect(first.body.refreshToken).not.toBe(person.refreshToken);
    await request(t.http).get('/v1/me').set('Authorization', `Bearer ${first.body.accessToken}`).expect(200);
    // The app used the token it got, so the old one coming back is a copy.
    const second = await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(200);

    const replay = await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: person.refreshToken })
      .expect(401);
    expect(replay.body.error.code).toBe('refresh_token_reused');
    // The whole session is gone: the newer tokens stop working too.
    await request(t.http).post('/v1/auth/refresh').send({ refreshToken: second.body.refreshToken }).expect(401);
    const me = await request(t.http).get('/v1/me').set('Authorization', `Bearer ${first.body.accessToken}`).expect(401);
    expect(me.body.error.code).toBe('session_ended');
  });

  it('ends every session of the account, in both apps, when a refresh token is used twice', async () => {
    const customer = await signIn(t, 'customer');
    await ageCodes(customer.phone, 120);
    const agent = await signIn(t, 'agent', { phone: customer.phone });
    const next = await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: customer.refreshToken })
      .expect(200);
    await request(t.http).post('/v1/auth/refresh').send({ refreshToken: next.body.refreshToken }).expect(200);
    await request(t.http).post('/v1/auth/refresh').send({ refreshToken: customer.refreshToken }).expect(401);
    // The agent app's session, on the same account, ends too: whoever copied one may hold others.
    expect((await request(t.http).get('/v1/me').set(agent.headers)).status).toBe(401);
    await request(t.http).post('/v1/auth/refresh').send({ refreshToken: agent.refreshToken }).expect(401);
  });

  it('takes a refresh sent again just after, when the answer was lost, as the app retrying', async () => {
    const person = await signIn(t, 'customer');
    // The answer to this one never reaches the app.
    await request(t.http).post('/v1/auth/refresh').send({ refreshToken: person.refreshToken }).expect(200);
    const again = await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: person.refreshToken })
      .expect(200);
    await request(t.http).get('/v1/me').set('Authorization', `Bearer ${again.body.accessToken}`).expect(200);
    // A minute later, the same token is a copy.
    await t.db
      .update(refreshTokens)
      .set({ usedAt: new Date(Date.now() - 2 * 60_000) })
      .where(eq(refreshTokens.tokenHash, sha256(person.refreshToken)));
    await request(t.http).post('/v1/auth/refresh').send({ refreshToken: person.refreshToken }).expect(401);
    await request(t.http).get('/v1/me').set('Authorization', `Bearer ${again.body.accessToken}`).expect(401);
  });

  it('ends a session at its absolute limit, however often it is refreshed', async () => {
    const person = await signIn(t, 'customer');
    const fresh = await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: person.refreshToken })
      .expect(200);
    const [session] = await t.db.select().from(sessions).where(eq(sessions.userId, person.userId));
    // Never set past its absolute end, which is SESSION_MAX_DAYS after sign-in.
    expect(session!.absoluteExpiresAt!.getTime()).toBeGreaterThan(Date.now() + 89 * 86_400_000);
    expect(session!.expiresAt.getTime()).toBeLessThanOrEqual(session!.absoluteExpiresAt!.getTime());
    await t.db
      .update(sessions)
      .set({ absoluteExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, session!.id));
    await request(t.http).post('/v1/auth/refresh').send({ refreshToken: fresh.body.refreshToken }).expect(401);
  });

  it('signs the other phones out of the app when a new phone signs in, and tells them', async () => {
    const first = await signIn(t, 'agent');
    const token = `old-phone-${randomUUID()}`;
    await request(t.http).put('/v1/devices/current/push-token').set(first.headers).send({ token }).expect(204);
    await ageCodes(first.phone, 120);
    const customer = await signIn(t, 'customer', { phone: first.phone });
    // Another app on the same account: the agent phone stays signed in.
    await request(t.http).get('/v1/me').set(first.headers).expect(200);
    await ageCodes(first.phone, 120);
    const second = await signIn(t, 'agent', { phone: first.phone });
    expect((await request(t.http).get('/v1/me').set(first.headers)).body.error.code).toBe('session_ended');
    await request(t.http).get('/v1/me').set(second.headers).expect(200);
    await request(t.http).get('/v1/me').set(customer.headers).expect(200);
    expect(t.push.sent.filter((p) => p.token === token).at(-1)).toMatchObject({
      title: 'Signed in on another phone',
    });
  });

  it('signs out, and can sign out every other phone', async () => {
    const phoneA = await signIn(t, 'customer');
    await ageCodes(phoneA.phone, 120);
    const phoneB = await signIn(t, 'customer', { phone: phoneA.phone });

    await request(t.http).post('/v1/auth/logout-others').set(phoneB.headers).expect(204);
    await request(t.http).get('/v1/me').set(phoneA.headers).expect(401);
    await request(t.http).get('/v1/me').set(phoneB.headers).expect(200);

    await request(t.http).post('/v1/auth/logout').set(phoneB.headers).expect(204);
    await request(t.http).get('/v1/me').set(phoneB.headers).expect(401);
    await request(t.http).post('/v1/auth/refresh').send({ refreshToken: phoneB.refreshToken }).expect(401);
  });

  it('tells finance when sign-in codes sent in a day pass the alert level', async () => {
    const owner = await adminAs(t, 'owner');
    const read = async () =>
      (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const save = async (smsCodesDailyAlert: number) => {
      const now = await read();
      const settings = structuredClone(now.settings);
      settings.security.smsCodesDailyAlert = smsCodesDailyAlert;
      expect(
        (
          await approved(t, 'owner', (h) =>
            request(t.http)
              .post('/v1/admin/settings?country=NG')
              .set(h)
              .send({ basedOn: now.version, settings, note: 'SMS alert level for a test' }),
          )
        ).status,
      ).toBe(200);
    };
    const before = (await read()).settings.security.smsCodesDailyAlert as number;
    await save(1);
    try {
      await requestCode(randomPhone()).expect(200);
      // The check runs every 10 minutes; here, at once. Twice raises it once.
      await t.app.get(OtpService).checkSpend();
      await t.app.get(OtpService).checkSpend();
      const { alerts } = (await request(t.http).get('/v1/admin/alerts?country=NG').set(owner.headers).expect(200))
        .body as { alerts: Array<{ kind: string; resolvedAt: string | null }> };
      expect(alerts.filter((a) => a.kind === 'sms_spend' && !a.resolvedAt)).toHaveLength(1);
    } finally {
      await save(before);
    }
  });

  it('rejects missing and forged tokens', async () => {
    expect((await request(t.http).get('/v1/me').expect(401)).body.error.code).toBe('missing_token');
    const forged = await request(t.http).get('/v1/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
    expect(forged.body.error.code).toBe('invalid_token');
  });

  it('updates the profile with validation', async () => {
    const person = await signIn(t, 'customer', { firstName: null });
    const res = await request(t.http)
      .patch('/v1/me')
      .set(person.headers)
      .send({ firstName: '  Chiamaka ', lastName: 'Obi', email: 'Chi@Example.com' })
      .expect(200);
    expect(res.body).toMatchObject({ firstName: 'Chiamaka', lastName: 'Obi', email: 'chi@example.com' });
    const bad = await request(t.http).patch('/v1/me').set(person.headers).send({ email: 'nope' }).expect(400);
    expect(bad.body.error.code).toBe('invalid_request');
    await request(t.http).patch('/v1/me').set(person.headers).send({}).expect(400);
  });
});
