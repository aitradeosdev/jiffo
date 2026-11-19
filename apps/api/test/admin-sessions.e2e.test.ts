import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminAuthService } from '../src/admin/admin-auth.service';
import { totpCode, totpStep } from '../src/admin/totp';
import { admins, adminSessions } from '../src/db/schema';
import { adminAs, createTestApp, randomIp, signIn, type TestApp, staffPhone } from './helpers';
import { SoftPasskey } from './soft-passkey';

const PASSWORD = 'a long enough password';
const PANEL = 'test-panel-secret-0123456789abcdef0123';
const fromIp = () => ({ 'x-jiffo-panel': PANEL, 'x-jiffo-client-ip': randomIp() });

/**
 * Admin sessions and passkeys (docs/security-plan.md, D2, D6, X6): roles that move money or see ID data sign
 * in with a passkey; sessions end when idle and at a hard limit; money actions need a recent confirm.
 */
describe('admin sessions and passkeys', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  /** A teammate signed in for the first time, with password and authenticator code, as the panel does it. */
  async function firstSignIn(role: 'finance' | 'safety' | 'verification' | 'disputes') {
    const email = `${randomUUID()}@jiffoapp.com`;
    const [row] = await t.db
      .insert(admins)
      .values({ email, name: `New ${role}`, role, phone: staffPhone() })
      .returning({ id: admins.id });
    const { inviteUrl } = await t.app.get(AdminAuthService).issueInvite(t.db, row!.id);
    const token = inviteUrl.split('#')[1]!;
    await request(t.http).post('/v1/admin/auth/invite/accept').send({ token, password: PASSWORD }).expect(200);
    const first = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email, password: PASSWORD })
      .expect(200);
    const setup = await request(t.http)
      .post('/v1/admin/auth/setup')
      .send({ challenge: first.body.challenge })
      .expect(200);
    const step = totpStep();
    const done = await request(t.http)
      .post('/v1/admin/auth/code')
      .set(fromIp())
      .send({ challenge: first.body.challenge, code: totpCode(setup.body.secret, step) })
      .expect(200);
    return {
      id: row!.id,
      email,
      secret: setup.body.secret as string,
      step,
      headers: { Authorization: `Bearer ${done.body.token}`, 'x-jiffo-reason': 'For a test' },
      expiresAt: done.body.expiresAt as string,
    };
  }

  async function addPasskey(headers: { Authorization: string }, passkey = new SoftPasskey()) {
    const options = await request(t.http).post('/v1/admin/auth/passkeys/options').set(headers).expect(200);
    const added = await request(t.http)
      .post('/v1/admin/auth/passkeys')
      .set(headers)
      .send({ response: passkey.register(options.body), name: 'Work laptop' });
    return { passkey, added };
  }

  /** Password, then the passkey's answer to a fresh request. */
  async function passkeySignIn(email: string, answer: (options: { challenge: string }) => unknown) {
    const first = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(first.body.next).toBe('passkey');
    const options = await request(t.http)
      .post('/v1/admin/auth/passkey/options')
      .send({ challenge: first.body.challenge })
      .expect(200);
    return {
      first,
      options: options.body,
      res: await request(t.http)
        .post('/v1/admin/auth/passkey')
        .set(fromIp())
        .send({ challenge: first.body.challenge, response: answer(options.body) }),
    };
  }

  it('lets a role that moves money do nothing but add a passkey until it has one', async () => {
    const finance = await firstSignIn('finance');
    const blocked = await request(t.http).get('/v1/admin/overview?country=NG').set(finance.headers);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('passkey_required');
    const me = await request(t.http).get('/v1/admin/me').set(finance.headers).expect(200);
    expect(me.body.needsPasskey).toBe(true);

    const { added } = await addPasskey(finance.headers);
    expect(added.status).toBe(201);
    await request(t.http).get('/v1/admin/overview?country=NG').set(finance.headers).expect(200);
    expect((await request(t.http).get('/v1/admin/me').set(finance.headers).expect(200)).body.needsPasskey).toBe(false);

    // Settling disputes refunds customers, so that role needs one too; safety needs only the app.
    const disputes = await firstSignIn('disputes');
    expect((await request(t.http).get('/v1/admin/overview?country=NG').set(disputes.headers)).status).toBe(403);
    const safety = await firstSignIn('safety');
    await request(t.http).get('/v1/admin/overview?country=NG').set(safety.headers).expect(200);
  });

  it('signs in with the passkey once there is one, never with a code', async () => {
    const finance = await firstSignIn('finance');
    const { passkey } = await addPasskey(finance.headers);

    const first = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email: finance.email, password: PASSWORD })
      .expect(200);
    expect(first.body.next).toBe('passkey');
    // The password and the authenticator code together are no longer enough.
    const code = await request(t.http)
      .post('/v1/admin/auth/code')
      .set(fromIp())
      .send({ challenge: first.body.challenge, code: totpCode(finance.secret, finance.step + 1) });
    expect(code.status).toBe(401);
    expect(code.body.error.code).toBe('use_passkey');

    const { res } = await passkeySignIn(finance.email, (o) => passkey.sign(o));
    expect(res.status).toBe(200);
    // Eight hours at most, however busy (D6).
    const hours = (Date.parse(res.body.expiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(7.9);
    expect(hours).toBeLessThanOrEqual(8);
    expect(res.body.idleMinutes).toBe(15);
    await request(t.http)
      .get('/v1/admin/overview?country=NG')
      .set({ Authorization: `Bearer ${res.body.token}` })
      .expect(200);
  });

  it("refuses an answer used twice, from another site, without the person verified, or with someone else's passkey", async () => {
    const finance = await firstSignIn('finance');
    const { passkey } = await addPasskey(finance.headers);
    const other = await firstSignIn('verification');
    const { passkey: theirs } = await addPasskey(other.headers);

    // Used once, then not again.
    let answer: unknown;
    const once = await passkeySignIn(finance.email, (o) => (answer = passkey.sign(o)));
    expect(once.res.status).toBe(200);
    const again = await request(t.http)
      .post('/v1/admin/auth/passkey')
      .set(fromIp())
      .send({ challenge: once.first.body.challenge, response: answer });
    expect(again.status).toBe(401);

    for (const bent of [
      (o: { challenge: string }) => passkey.sign(o, { origin: 'https://jiffo-admin.example' }),
      (o: { challenge: string }) => passkey.sign(o, { verified: false }),
      (o: { challenge: string }) => theirs.sign(o),
      // A request made for another sign-in.
      () => passkey.sign({ challenge: once.options.challenge }),
    ]) {
      const { res } = await passkeySignIn(finance.email, bent);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('passkey_refused');
    }
    // A passkey made for a look-alike site isn't added either.
    const options = await request(t.http).post('/v1/admin/auth/passkeys/options').set(finance.headers).expect(200);
    const fake = await request(t.http)
      .post('/v1/admin/auth/passkeys')
      .set(finance.headers)
      .send({ response: new SoftPasskey().register(options.body, { origin: 'https://jiffo-admin.example' }) });
    expect(fake.status).toBe(400);
  });

  it('ends a session after 15 idle minutes', async () => {
    const disputes = await firstSignIn('safety');
    await t.db
      .update(adminSessions)
      .set({ lastSeenAt: new Date(Date.now() - 16 * 60_000) })
      .where(eq(adminSessions.adminId, disputes.id));
    const res = await request(t.http).get('/v1/admin/me').set(disputes.headers);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatchObject({ code: 'session_idle', message: expect.stringMatching(/15 minutes/) });
  });

  it('asks for a fresh confirm before money actions: the passkey for those who have one, a code for the rest', async () => {
    const customer = await signIn(t, 'customer');
    const finance = await firstSignIn('finance');
    const { passkey } = await addPasskey(finance.headers);
    const adjust = () =>
      request(t.http).post('/v1/admin/money/adjustments').set(finance.headers).send({
        personId: customer.userId,
        account: 'customer_wallet',
        direction: 'credit',
        amountKobo: 10_000,
        note: 'Goodwill for a late delivery',
        requestId: randomUUID(),
      });
    // Signed in a while ago: confirm first.
    await t.db
      .update(adminSessions)
      .set({ confirmedAt: new Date(Date.now() - 6 * 60_000) })
      .where(eq(adminSessions.adminId, finance.id));
    const stale = await adjust();
    expect(stale.status).toBe(403);
    expect(stale.body.error.code).toBe('confirm_identity');
    // Looking stays open.
    await request(t.http).get('/v1/admin/money/summary?country=NG&days=7').set(finance.headers).expect(200);

    const start = await request(t.http).post('/v1/admin/auth/confirm/start').set(finance.headers).expect(200);
    expect(start.body.method).toBe('passkey');
    // A code doesn't do for someone with a passkey.
    const byCode = await request(t.http)
      .post('/v1/admin/auth/confirm')
      .set(finance.headers)
      .send({ code: totpCode(finance.secret, finance.step + 1) });
    expect(byCode.status).toBe(403);
    const confirmed = await request(t.http)
      .post('/v1/admin/auth/confirm')
      .set(finance.headers)
      .send({ response: passkey.sign(start.body.options) })
      .expect(200);
    expect(Date.parse(confirmed.body.confirmedUntil)).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect((await adjust()).status).toBe(202);

    // Someone without a passkey confirms with a fresh code before approving.
    const disputes = await firstSignIn('safety');
    await t.db
      .update(adminSessions)
      .set({ confirmedAt: new Date(Date.now() - 6 * 60_000) })
      .where(eq(adminSessions.adminId, disputes.id));
    const approve = await request(t.http)
      .post(`/v1/admin/approvals/${randomUUID()}/approve`)
      .set(disputes.headers)
      .send({});
    expect(approve.body.error.code).toBe('confirm_identity');
    expect((await request(t.http).post('/v1/admin/auth/confirm/start').set(disputes.headers).expect(200)).body).toEqual(
      { method: 'code' },
    );
    // The code used to sign in can't be used again.
    expect(
      (
        await request(t.http)
          .post('/v1/admin/auth/confirm')
          .set(disputes.headers)
          .send({ code: totpCode(disputes.secret, disputes.step) })
      ).status,
    ).toBe(403);
    await request(t.http)
      .post('/v1/admin/auth/confirm')
      .set(disputes.headers)
      .send({ code: totpCode(disputes.secret, disputes.step + 1) })
      .expect(200);
    expect(
      (await request(t.http).post(`/v1/admin/approvals/${randomUUID()}/approve`).set(disputes.headers).send({})).status,
    ).toBe(404);
  });

  it('asks for a confirm before adding a passkey, so a stolen session cannot add its own', async () => {
    const safety = await firstSignIn('safety');
    await t.db
      .update(adminSessions)
      .set({ confirmedAt: new Date(Date.now() - 6 * 60_000) })
      .where(eq(adminSessions.adminId, safety.id));
    const options = await request(t.http).post('/v1/admin/auth/passkeys/options').set(safety.headers);
    expect(options.status).toBe(403);
    expect(options.body.error.code).toBe('confirm_identity');
    await request(t.http)
      .post('/v1/admin/auth/confirm')
      .set(safety.headers)
      .send({ code: totpCode(safety.secret, safety.step + 1) })
      .expect(200);
    expect((await addPasskey(safety.headers)).added.status).toBe(201);
  });

  it("doesn't let failed confirms pause the admin's sign-in", async () => {
    const safety = await firstSignIn('safety');
    for (let i = 0; i < 6; i++) {
      await request(t.http).post('/v1/admin/auth/confirm').set(safety.headers).send({ code: '000000' });
    }
    expect(
      (await request(t.http).post('/v1/admin/auth/confirm').set(safety.headers).send({ code: '000000' })).status,
    ).toBe(429);
    // Signing in still works.
    const first = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email: safety.email, password: PASSWORD })
      .expect(200);
    await request(t.http)
      .post('/v1/admin/auth/code')
      .set(fromIp())
      .send({ challenge: first.body.challenge, code: totpCode(safety.secret, safety.step + 1) })
      .expect(200);
  });

  it('closes a code sign-in started before a passkey was added', async () => {
    const finance = await firstSignIn('finance');
    // A second sign-in reaches the code step, then a passkey is added from the first session.
    const first = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email: finance.email, password: PASSWORD })
      .expect(200);
    expect(first.body.next).toBe('code');
    await addPasskey(finance.headers);
    const code = await request(t.http)
      .post('/v1/admin/auth/code')
      .set(fromIp())
      .send({ challenge: first.body.challenge, code: totpCode(finance.secret, finance.step + 1) });
    expect(code.status).toBe(401);
    expect(code.body.error.code).toBe('use_passkey');
  });

  it('removes passkeys with a reset, so someone who lost their device can sign in again', async () => {
    const finance = await firstSignIn('finance');
    await addPasskey(finance.headers);
    const owner = await adminAs(t, 'owner');
    await request(t.http).post(`/v1/admin/team/${finance.id}/reset`).set(owner.headers).expect(201);
    const token = /invite#(\S+)/.exec(t.email.lastTo(finance.email)!.text)![1]!;
    await request(t.http).post('/v1/admin/auth/invite/accept').send({ token, password: PASSWORD }).expect(200);
    const first = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email: finance.email, password: PASSWORD })
      .expect(200);
    // Set up again from the start: the authenticator app, then a new passkey.
    expect(first.body.next).toBe('setup');
  });

  it('asks for a confirm before settling a dispute or changing a provider', async () => {
    const owner = await adminAs(t, 'owner');
    await t.db
      .update(adminSessions)
      .set({ confirmedAt: new Date(Date.now() - 6 * 60_000) })
      .where(eq(adminSessions.adminId, owner.id));
    const settle = await request(t.http)
      .post(`/v1/admin/errands/${randomUUID()}/actions`)
      .set(owner.headers)
      .send({ event: 'resolve_cancel', version: 0, note: 'Settling a dispute' });
    expect(settle.body.error.code).toBe('confirm_identity');
    const provider = await request(t.http)
      .put('/v1/admin/providers/sms/termii')
      .set(owner.headers)
      .send({ config: { senderId: 'Jiffo' } });
    expect(provider.body.error.code).toBe('confirm_identity');
    // Stepping in without moving money doesn't need it.
    const step = await request(t.http)
      .post(`/v1/admin/errands/${randomUUID()}/actions`)
      .set(owner.headers)
      .send({ event: 'admin_intervene', version: 0, note: 'Checking the address' });
    expect(step.body.error.code).not.toBe('confirm_identity');
  });

  it('keeps at least one passkey for a role that signs in with one', async () => {
    const owner = await adminAs(t, 'owner');
    const list = await request(t.http).get('/v1/admin/auth/passkeys').set(owner.headers).expect(200);
    expect(list.body).toHaveLength(1);
    const res = await request(t.http).delete(`/v1/admin/auth/passkeys/${list.body[0].id}`).set(owner.headers);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('last_passkey');
  });
});
