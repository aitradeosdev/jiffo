import { generateKeyPairSync, randomUUID, sign as signWith } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { otpChallenges, sessions, users } from '../src/db/schema';
import { SIGNED_HEADERS, signedPayload } from '../src/auth/device-security.service';
import {
  agentWithMoney,
  createTestApp,
  secureDevice,
  signed,
  signIn,
  TEST_PIN,
  type Person,
  type TestApp,
} from './helpers';

/**
 * The phone's own key and the app PIN (docs/security-plan.md, A3, A5, A7): a money action needs a signature
 * from the key the phone made in its secure hardware, over a single-use code from the server, and the app
 * PIN. A stolen session or SMS code alone moves nothing.
 */
describe("money actions need the phone's key and the app PIN", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const body = () => ({ amountKobo: 100_000, speed: 'scheduled', requestId: randomUUID() });
  const refused = (res: request.Response, code: string) => {
    expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(400);
    expect(res.body.error.code).toBe(code);
  };
  /** Makes a session look older than the few minutes a fresh sign-in allows. */
  const ageSession = (who: Person) =>
    t.db
      .update(sessions)
      .set({ createdAt: new Date(Date.now() - 3_600_000) })
      .where(eq(sessions.userId, who.userId));

  it('refuses a withdrawal with only the session: no signature, no PIN, or no key on the phone', async () => {
    const agent = await agentWithMoney(t);
    refused(await request(t.http).post('/v1/wallet/withdrawals').set(agent.headers).send(body()), 'signature_needed');

    const bare = await signIn(t, 'agent', { unsecured: true });
    refused(await request(t.http).post('/v1/wallet/withdrawals').set(bare.headers).send(body()), 'device_key_needed');
    await signed(t, agent).post('/v1/wallet/withdrawals').send(body()).expect(201);
  });

  it("refuses another key's signature, a changed body, and a code used twice or from another phone", async () => {
    const agent = await agentWithMoney(t);
    const { privateKey: other } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    refused(await signed(t, agent, { key: other }).post('/v1/wallet/withdrawals').send(body()), 'signature_invalid');

    // Signed for one amount, sent with another.
    const { nonce } = (await request(t.http).post('/v1/devices/current/challenge').set(agent.headers).expect(200)).body;
    const sign = (raw: string) =>
      signWith('sha256', Buffer.from(signedPayload(nonce, 'POST', '/v1/wallet/withdrawals', raw)), {
        key: agent.deviceKey!,
        dsaEncoding: 'der',
      }).toString('base64');
    const asked = JSON.stringify(body());
    const send = (raw: string, signature: string, as = agent) =>
      request(t.http)
        .post('/v1/wallet/withdrawals')
        .set(as.headers)
        .set({ [SIGNED_HEADERS.nonce]: nonce, [SIGNED_HEADERS.signature]: signature, [SIGNED_HEADERS.pin]: TEST_PIN })
        .set('content-type', 'application/json')
        .send(raw);
    const tampered = JSON.stringify({ ...JSON.parse(asked), amountKobo: 900_000 });
    refused(await send(tampered, sign(asked)), 'signature_invalid');
    // The code was used up by that try, so the right request with it is refused too.
    refused(await send(asked, sign(asked)), 'challenge_invalid');

    // A code issued to another phone can't be used from this one.
    const second = await agentWithMoney(t);
    const { nonce: theirs } = (
      await request(t.http).post('/v1/devices/current/challenge').set(second.headers).expect(200)
    ).body;
    const res = await request(t.http)
      .post('/v1/wallet/withdrawals')
      .set(agent.headers)
      .set({ [SIGNED_HEADERS.nonce]: theirs, [SIGNED_HEADERS.signature]: sign(asked), [SIGNED_HEADERS.pin]: TEST_PIN })
      .set('content-type', 'application/json')
      .send(asked);
    refused(res, 'challenge_invalid');
  });

  it('locks the PIN after the set number of wrong tries, even for the right one, until a fresh sign-in resets it', async () => {
    const agent = await agentWithMoney(t);
    for (let left = 4; left >= 1; left--) {
      const wrong = await signed(t, agent, { pin: '1357' }).post('/v1/wallet/withdrawals').send(body());
      refused(wrong, 'pin_wrong');
      expect(wrong.body.error.triesLeft).toBe(left);
    }
    refused(await signed(t, agent, { pin: '1357' }).post('/v1/wallet/withdrawals').send(body()), 'pin_locked');
    refused(await signed(t, agent).post('/v1/wallet/withdrawals').send(body()), 'pin_locked');

    // Resetting without the old PIN needs a fresh sign-in on the phone...
    await ageSession(agent);
    refused(await signed(t, agent).put('/v1/me/pin').send({ pin: '4826' }), 'sign_in_again');
    // ...and, done, pauses withdrawals: whoever took the number over would reset it the same way (A6).
    await t.db.update(sessions).set({ createdAt: new Date() }).where(eq(sessions.userId, agent.userId));
    const reset = await signed(t, agent).put('/v1/me/pin').send({ pin: '4826' }).expect(200);
    expect(reset.body.withdrawalsHeldUntil).toBeTruthy();
    refused(await signed(t, agent, { pin: '4826' }).post('/v1/wallet/withdrawals').send(body()), 'withdrawals_held');
    const [row] = await t.db
      .select({ failures: users.appPinFailures, locked: users.appPinLockedAt })
      .from(users)
      .where(eq(users.id, agent.userId));
    expect(row).toEqual({ failures: 0, locked: null });
  });

  it('changes the PIN with the current one, which pauses withdrawals; refuses easy PINs', async () => {
    const agent = await agentWithMoney(t);
    for (const pin of ['1234', '0000', '9876', '12a4', '12345']) {
      expect((await signed(t, agent).put('/v1/me/pin').send({ pin, currentPin: TEST_PIN })).status).toBe(400);
    }
    refused(await signed(t, agent).put('/v1/me/pin').send({ pin: '4826', currentPin: '1357' }), 'pin_wrong');
    const changed = await signed(t, agent).put('/v1/me/pin').send({ pin: '4826', currentPin: TEST_PIN }).expect(200);
    expect(changed.body.withdrawalsHeldUntil).toBeTruthy();
    // Setting the PIN is signed by the phone too.
    refused(await request(t.http).put('/v1/me/pin').set(agent.headers).send({ pin: '7391' }), 'signature_needed');
  });

  it("takes a phone's key once, only just after signing in, and only a P-256 key", async () => {
    const agent = await signIn(t, 'agent', { unsecured: true });
    const register = (who: Person, publicKey: string) =>
      request(t.http).put('/v1/devices/current/key').set(who.headers).send({ publicKey });
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey;
    refused(await register(agent, rsa.export({ type: 'spki', format: 'der' }).toString('base64')), 'key_invalid');
    refused(await register(agent, Buffer.alloc(91, 7).toString('base64')), 'key_invalid');

    // A session from a while ago can't add a key: a stolen one would add its own.
    await ageSession(agent);
    const p256 = () =>
      generateKeyPairSync('ec', { namedCurve: 'P-256' })
        .publicKey.export({ type: 'spki', format: 'der' })
        .toString('base64');
    refused(await register(agent, p256()), 'sign_in_again');

    const fresh = await signIn(t, 'agent', { unsecured: true });
    const secured = await secureDevice(t, fresh);
    expect((await request(t.http).get('/v1/me/security').set(secured.headers).expect(200)).body).toEqual({
      deviceKey: true,
      hasPin: true,
      pinLocked: false,
    });
  });

  it('takes a new key for a phone that lost its own, just after signing in, and pauses withdrawals', async () => {
    const agent = await agentWithMoney(t);
    const replacement = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicKey = replacement.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
    // Not on a session from a while ago...
    await ageSession(agent);
    refused(
      await request(t.http).put('/v1/devices/current/key').set(agent.headers).send({ publicKey }),
      'sign_in_again',
    );
    // ...but just after signing in again, as after restoring the phone: as good as a new phone (A6).
    await t.db.update(sessions).set({ createdAt: new Date() }).where(eq(sessions.userId, agent.userId));
    await request(t.http).put('/v1/devices/current/key').set(agent.headers).send({ publicKey }).expect(204);
    refused(await signed(t, agent).post('/v1/wallet/withdrawals').send(body()), 'signature_invalid');
    refused(
      await signed(t, agent, { key: replacement.privateKey }).post('/v1/wallet/withdrawals').send(body()),
      'withdrawals_held',
    );
  });

  it("can't be set up, or the PIN changed or locked, from the customer app", async () => {
    const agent = await agentWithMoney(t);
    await t.db
      .update(otpChallenges)
      .set({ createdAt: sql`${otpChallenges.createdAt} - interval '1 hour'` })
      .where(eq(otpChallenges.phone, agent.phone));
    const asCustomer = await signIn(t, 'customer', { phone: agent.phone, firstName: null });
    const publicKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .publicKey.export({ type: 'spki', format: 'der' })
      .toString('base64');
    expect(
      (await request(t.http).put('/v1/devices/current/key').set(asCustomer.headers).send({ publicKey })).status,
    ).toBe(403);
    expect((await request(t.http).post('/v1/devices/current/challenge').set(asCustomer.headers)).status).toBe(403);
    expect((await request(t.http).put('/v1/me/pin').set(asCustomer.headers).send({ pin: '4826' })).status).toBe(403);
    await signed(t, agent).post('/v1/wallet/withdrawals').send(body()).expect(201);
  });

  it('asks for the PIN before using up the code, and clears old codes', async () => {
    const agent = await agentWithMoney(t);
    const usedCodes = async () =>
      (
        (
          await t.db.execute(
            sql`select count(*)::int as used from device_challenges c join devices d on d.id = c.device_id where d.user_id = ${agent.userId} and c.used_at is not null`,
          )
        ).rows[0] as { used: number }
      ).used;
    const before = await usedCodes();
    const missing = await signed(t, agent, { pin: null }).post('/v1/wallet/withdrawals').send(body());
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('pin_missing');
    // Its code wasn't used up.
    expect(await usedCodes()).toBe(before);
    // Long-expired codes go, whichever phone they were for.
    await t.db.execute(sql`update device_challenges set expires_at = now() - interval '1 hour'`);
    await request(t.http).post('/v1/devices/current/challenge').set(agent.headers).expect(200);
    const stale = (
      (await t.db.execute(sql`select count(*)::int as stale from device_challenges where expires_at < now()`))
        .rows[0] as { stale: number }
    ).stale;
    expect(stale).toBe(0);
  });

  it('protects changing the payout account the same way', async () => {
    const agent = await agentWithMoney(t);
    const account = { bankCode: '058', accountNumber: `0${String(Date.now()).slice(-9)}` };
    t.payments.accounts.set(`058:${account.accountNumber}`, 'TUNDE BAKARE');
    refused(await request(t.http).put('/v1/payout-account').set(agent.headers).send(account), 'signature_needed');
    await signed(t, agent).put('/v1/payout-account').send(account).expect(200);
  });
});
