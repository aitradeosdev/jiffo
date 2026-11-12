import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { otpChallenges } from '../src/db/schema';
import { createTestApp, randomIp, randomPhone, signIn, type TestApp } from './helpers';

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

  it('makes people wait before resending, then limits codes per hour', async () => {
    const phone = randomPhone();
    await requestCode(phone).expect(200);
    const wait = await requestCode(phone).expect(429);
    expect(wait.body.error).toMatchObject({ code: 'otp_resend_wait', retryAfterSeconds: expect.any(Number) });

    for (let i = 0; i < 4; i++) {
      await ageCodes(phone, 120);
      await requestCode(phone).expect(200);
    }
    await ageCodes(phone, 120);
    expect((await requestCode(phone).expect(429)).body.error.code).toBe('otp_rate_limited');
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

    const replay = await request(t.http)
      .post('/v1/auth/refresh')
      .send({ refreshToken: person.refreshToken })
      .expect(401);
    expect(replay.body.error.code).toBe('refresh_token_reused');
    // The whole session is gone: the newer tokens stop working too.
    await request(t.http).post('/v1/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(401);
    const me = await request(t.http).get('/v1/me').set('Authorization', `Bearer ${first.body.accessToken}`).expect(401);
    expect(me.body.error.code).toBe('session_ended');
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
