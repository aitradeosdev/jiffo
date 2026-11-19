import { randomUUID } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { agentApplications, devices, otpChallenges, payoutAccounts, payouts, users } from '../src/db/schema';
import { nameIndex } from '../src/db/fields';
import { PayoutsService } from '../src/money/payouts.service';
import {
  adminAs,
  agentWithMoney,
  createTestApp,
  randomIp,
  uniqueDigits,
  type Person,
  type TestApp,
  secureDevice,
  signed,
} from './helpers';

const HOUR_MS = 3_600_000;

/**
 * The hold on an agent's withdrawals after a change to their account (docs/security-plan.md, A6, P8, X4):
 * whoever takes over a number or an account can't move the money out before the owner hears and acts.
 */
describe('the withdrawal hold after an account change', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const withdraw = (agent: Person, speed: 'scheduled' | 'instant' = 'scheduled') =>
    signed(t, agent).post('/v1/wallet/withdrawals').send({ amountKobo: 100_000, speed, requestId: randomUUID() });
  const heldUntil = async (agent: Person) =>
    (await t.db.select({ until: users.withdrawalsHeldUntil }).from(users).where(eq(users.id, agent.userId)))[0]!.until;
  const endHold = (agent: Person) =>
    t.db
      .update(users)
      .set({ withdrawalsHeldUntil: new Date(Date.now() - 1000) })
      .where(eq(users.id, agent.userId));
  const expectHeld = async (agent: Person) => {
    const res = await withdraw(agent);
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.code).toBe('withdrawals_held');
    const until = new Date(res.body.error.heldUntil).getTime();
    expect(Math.abs(until - (Date.now() + 48 * HOUR_MS))).toBeLessThan(60_000);
  };

  /** Signs in to an app on a given phone (device key), as the app does. */
  async function signInOn(agent: Person, app: 'agent' | 'customer', deviceKey: string): Promise<Person> {
    // Past the number's wait between codes, as if a while had passed since the last sign-in.
    await t.db
      .update(otpChallenges)
      .set({ createdAt: sql`${otpChallenges.createdAt} - interval '1 hour'` })
      .where(eq(otpChallenges.phone, agent.phone));
    const ip = randomIp();
    const asked = await request(t.http)
      .post('/v1/auth/otp/request')
      .set('x-forwarded-for', ip)
      .send({ phone: agent.phone, deviceKey });
    if (asked.status !== 200) throw new Error(`code: ${asked.status} ${JSON.stringify(asked.body)}`);
    const res = await request(t.http)
      .post('/v1/auth/otp/verify')
      .set('x-forwarded-for', ip)
      .send({
        phone: agent.phone,
        code: t.messaging.lastCodeFor(agent.phone),
        app,
        device: { key: deviceKey, platform: 'android', name: 'Test phone' },
      })
      .expect(200);
    const person: Person = {
      ...agent,
      accessToken: res.body.accessToken,
      headers: { Authorization: `Bearer ${res.body.accessToken}` },
    };
    if (app !== 'agent') return person;
    // A phone already set up keeps its key; a new one is set up, as the app does after signing in.
    const status = (await request(t.http).get('/v1/me/security').set(person.headers).expect(200)).body;
    return status.deviceKey ? person : secureDevice(t, person);
  }
  const deviceKeyOf = async (agent: Person) =>
    (
      await t.db
        .select({ key: devices.deviceKey })
        .from(devices)
        .where(and(eq(devices.userId, agent.userId), eq(devices.app, 'agent')))
    )[0]!.key;
  const newAccount = (agent: Person, name = 'TUNDE BAKARE') => {
    const accountNumber = `0${uniqueDigits(9)}`;
    t.payments.accounts.set(`058:${accountNumber}`, name);
    return signed(t, agent).put('/v1/payout-account').send({ bankCode: '058', accountNumber });
  };

  it("doesn't hold a new agent's first account or first phone", async () => {
    const agent = await agentWithMoney(t);
    await withdraw(agent).expect(201);
    expect(await heldUntil(agent)).toBeNull();
  });

  it('holds withdrawals after the payout account changes, and tells the agent by SMS, email and push', async () => {
    const agent = await agentWithMoney(t);
    const email = `tunde-${randomUUID().slice(0, 8)}@example.com`;
    await request(t.http).patch('/v1/me').set(agent.headers).send({ email }).expect(200);
    const token = `push-${randomUUID()}`;
    await request(t.http).put('/v1/devices/current/push-token').set(agent.headers).send({ token }).expect(204);

    await newAccount(agent).expect(200);
    await expectHeld(agent);
    await signed(t, agent)
      .post('/v1/wallet/withdrawals')
      .send({ amountKobo: 100_000, speed: 'instant', requestId: randomUUID() })
      .expect(409);

    const sms = t.messaging.texts.filter((m) => m.phone === agent.phone).at(-1);
    expect(sms?.text).toMatch(/payout account changed/);
    expect(sms?.text).toMatch(/48 hours/);
    expect(t.email.lastTo(email)?.subject).toMatch(/withdrawals are paused/i);
    // Once, in the push about the new account.
    const pushes = t.push.sent.filter((p) => p.token === token);
    expect(pushes.at(-1)).toMatchObject({
      title: 'Payout account changed',
      body: expect.stringMatching(/paused for 48 hours/),
    });
    expect(pushes.filter((p) => p.title === 'Withdrawals paused')).toEqual([]);
    // The app shows when they open again.
    const wallet = await request(t.http).get('/v1/wallet').set(agent.headers).expect(200);
    expect(new Date(wallet.body.withdrawalsHeldUntil).getTime()).toBe((await heldUntil(agent))!.getTime());

    await endHold(agent);
    await withdraw(agent).expect(201);
  });

  it('holds from when support approves a nearly matching new account', async () => {
    const agent = await agentWithMoney(t);
    // Their ID record's name, which a bank name is matched against.
    await t.db
      .update(agentApplications)
      .set({
        legalName: 'TUNDE ADEWALE BAKARE',
        legalNameIndex: nameIndex('TUNDE ADEWALE BAKARE'),
        identityOutcome: 'passed',
      })
      .where(eq(agentApplications.userId, agent.userId));
    await newAccount(agent, 'T BAKARE').expect(200);
    // Waiting for support, the old account is still the one in use: no reason to hold.
    await withdraw(agent).expect(201);
    const finance = await adminAs(t, 'finance');
    const [waiting] = (
      await request(t.http).get('/v1/admin/money/payout-accounts?country=NG').set(finance.headers).expect(200)
    ).body.accounts.filter((a: { person: { id: string } }) => a.person.id === agent.userId);
    await request(t.http)
      .post(`/v1/admin/money/payout-accounts/${waiting.id}/decision`)
      .set(finance.headers)
      .send({ decision: 'approve', note: 'Initial matches the ID' })
      .expect(200);
    await expectHeld(agent);
  });

  it('holds after signing in to the agent app on a new phone, not the same phone again or the customer app', async () => {
    const agent = await agentWithMoney(t);
    const same = await signInOn(agent, 'agent', await deviceKeyOf(agent));
    expect(await heldUntil(agent)).toBeNull();
    await signInOn(agent, 'customer', randomUUID());
    expect(await heldUntil(agent)).toBeNull();
    await withdraw(same).expect(201);

    const fresh = await signInOn(agent, 'agent', randomUUID());
    await expectHeld(fresh);
    // Told after the sign-in answers, so it doesn't wait on the SMS provider.
    await vi.waitFor(() =>
      expect(t.messaging.texts.filter((m) => m.phone === agent.phone).at(-1)?.text).toMatch(/new phone/),
    );
  });

  it('tells the owner on the phone a new sign-in signed out, since the number may not be theirs now', async () => {
    const agent = await agentWithMoney(t);
    const token = `push-${randomUUID()}`;
    await request(t.http).put('/v1/devices/current/push-token').set(agent.headers).send({ token }).expect(204);
    await signInOn(agent, 'agent', randomUUID());
    await vi.waitFor(() =>
      expect(t.push.sent.filter((p) => p.token === token).at(-1)).toMatchObject({
        title: 'Signed in on another phone',
        body: expect.stringMatching(/withdrawals are paused/i),
      }),
    );
  });

  it("doesn't hold when the account in use is saved again unchanged", async () => {
    const agent = await agentWithMoney(t);
    const [current] = await t.db
      .select({ bankCode: payoutAccounts.bankCode, accountNumber: payoutAccounts.accountNumber })
      .from(payoutAccounts)
      .where(and(eq(payoutAccounts.userId, agent.userId), isNull(payoutAccounts.replacedAt)));
    await signed(t, agent).put('/v1/payout-account').send(current!).expect(200);
    expect(await heldUntil(agent)).toBeNull();
  });

  it('holds when approving an application also brings in a waiting account', async () => {
    const agent = await agentWithMoney(t);
    await t.db
      .update(agentApplications)
      .set({
        legalName: 'TUNDE ADEWALE BAKARE',
        legalNameIndex: nameIndex('TUNDE ADEWALE BAKARE'),
        identityOutcome: 'passed',
        status: 'review',
      })
      .where(eq(agentApplications.userId, agent.userId));
    await newAccount(agent, 'T BAKARE').expect(200);
    const verification = await adminAs(t, 'verification');
    await request(t.http)
      .post(`/v1/admin/people/${agent.userId}/application`)
      .set(verification.headers)
      .send({ decision: 'approve', note: 'The bank shortens the first name' })
      .expect(200);
    await expectHeld(agent);
    expect(t.messaging.texts.filter((m) => m.phone === agent.phone).at(-1)?.text).toMatch(/payout account changed/);
  });

  it('says the latest reason, to the agent and to staff alike', async () => {
    const agent = await agentWithMoney(t);
    await newAccount(agent).expect(200);
    await signInOn(agent, 'agent', randomUUID());
    const [row] = await t.db.select({ reason: users.withdrawalsHeldFor }).from(users).where(eq(users.id, agent.userId));
    expect(row!.reason).toBe('new_device');
    await vi.waitFor(() =>
      expect(t.messaging.texts.filter((m) => m.phone === agent.phone).at(-1)?.text).toMatch(/new phone/),
    );
  });

  it('never shortens a hold', async () => {
    const agent = await agentWithMoney(t);
    const later = new Date(Date.now() + 100 * HOUR_MS);
    await t.db.update(users).set({ withdrawalsHeldUntil: later }).where(eq(users.id, agent.userId));
    await signInOn(agent, 'agent', randomUUID());
    expect((await heldUntil(agent))!.getTime()).toBe(later.getTime());
  });

  it("keeps a withdrawal asked for before the hold from going out, and the provider's approval check refuses it", async () => {
    const agent = await agentWithMoney(t);
    const asked = await withdraw(agent).expect(201);
    await signInOn(agent, 'agent', randomUUID());
    const payoutsService = t.app.get(PayoutsService);
    expect((await payoutsService.send(asked.body.id))?.status).toBe('requested');

    // Were it sent anyway, the provider asks Jiffo to approve it: refused while held.
    await t.db
      .update(payouts)
      .set({ status: 'processing', provider: t.payments.name })
      .where(eq(payouts.id, asked.body.id));
    const [payout] = await t.db.select().from(payouts).where(eq(payouts.id, asked.body.id));
    const answer = await payoutsService.approve(payout!.provider ?? t.payments.name, {
      reference: payout!.reference,
      amountKobo: payout!.sendKobo,
      recipientCode: null,
    });
    expect(answer).toMatchObject({ approved: false, reason: expect.stringMatching(/hold/) });

    // Once it ends, the withdrawal goes out as asked.
    await t.db.update(payouts).set({ status: 'requested', provider: null }).where(eq(payouts.id, asked.body.id));
    await endHold(agent);
    expect((await payoutsService.send(asked.body.id))?.status).not.toBe('requested');
  });
});
