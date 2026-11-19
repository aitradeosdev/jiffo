import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devices, otpChallenges, users } from '../src/db/schema';
import { agentWithMoney, createTestApp, randomIp, secureDevice, signed, type Person, type TestApp } from './helpers';

/**
 * "Sign out and forget this phone" (docs/security-plan.md, A3, A6): for an agent handing a phone on. The
 * phone's key goes from their account, and signing in on it again counts as a new phone, with the hold, even
 * when it was their only one: whoever keeps the phone and gets their code can't skip it.
 */
describe('signing out and forgetting the phone', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const withdraw = (who: Person) =>
    signed(t, who)
      .post('/v1/wallet/withdrawals')
      .send({ amountKobo: 100_000, speed: 'scheduled', requestId: randomUUID() });
  const deviceKeyOf = async (who: Person) =>
    (
      await t.db
        .select({ key: devices.deviceKey })
        .from(devices)
        .where(and(eq(devices.userId, who.userId), eq(devices.app, 'agent')))
    )[0]!.key;
  const heldUntil = async (who: Person) =>
    (await t.db.select({ until: users.withdrawalsHeldUntil }).from(users).where(eq(users.id, who.userId)))[0]!.until;

  /** Signs in again on this phone, past the wait between codes. */
  async function signInAgain(who: Person, deviceKey: string): Promise<Person> {
    await t.db
      .update(otpChallenges)
      .set({ createdAt: sql`${otpChallenges.createdAt} - interval '1 hour'` })
      .where(eq(otpChallenges.phone, who.phone));
    const ip = randomIp();
    await request(t.http)
      .post('/v1/auth/otp/request')
      .set('x-forwarded-for', ip)
      .send({ phone: who.phone })
      .expect(200);
    const res = await request(t.http)
      .post('/v1/auth/otp/verify')
      .set('x-forwarded-for', ip)
      .send({
        phone: who.phone,
        code: t.messaging.lastCodeFor(who.phone),
        app: 'agent',
        device: { key: deviceKey, platform: 'android', name: 'Test phone' },
      })
      .expect(200);
    return { ...who, accessToken: res.body.accessToken, headers: { Authorization: `Bearer ${res.body.accessToken}` } };
  }

  it('a plain sign-out keeps the phone known: signing in again there pauses nothing', async () => {
    const agent = await agentWithMoney(t);
    const phone = await deviceKeyOf(agent);
    await request(t.http).post('/v1/auth/logout').set(agent.headers).expect(204);
    const back = await signInAgain(agent, phone);
    expect(await heldUntil(agent)).toBeNull();
    await withdraw(back).expect(201);
  });

  it("forgets the phone's key, and the next sign-in on it pauses withdrawals, even on the agent's only phone", async () => {
    const agent = await agentWithMoney(t);
    const phone = await deviceKeyOf(agent);
    await request(t.http).post('/v1/auth/logout').set(agent.headers).send({ forgetPhone: true }).expect(204);
    const [row] = await t.db
      .select({ key: devices.publicKey, forgotten: devices.forgottenAt })
      .from(devices)
      .where(and(eq(devices.userId, agent.userId), eq(devices.deviceKey, phone)));
    expect(row!.key).toBeNull();
    expect(row!.forgotten).not.toBeNull();

    // Whoever kept the phone signs in with the agent's code: a new phone, so withdrawals wait.
    const back = await signInAgain(agent, phone);
    expect(await heldUntil(agent)).not.toBeNull();
    // The old key no longer works here; a new one is set up, as the app does.
    expect((await withdraw(back)).body.error.code).toBe('device_key_needed');
    const set = await secureDevice(t, back);
    expect((await withdraw(set)).body.error.code).toBe('withdrawals_held');
    // Known again from this sign-in on.
    const [again] = await t.db
      .select({ forgotten: devices.forgottenAt })
      .from(devices)
      .where(and(eq(devices.userId, agent.userId), eq(devices.deviceKey, phone)));
    expect(again!.forgotten).toBeNull();
  });
});
