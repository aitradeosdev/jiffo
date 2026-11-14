import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AdminAuthService } from '../src/admin/admin-auth.service';
import { hashPassword, verifyPassword } from '../src/admin/passwords';
import { base32Encode, matchTotp, totpCode, totpStep } from '../src/admin/totp';
import { adminAudit, admins, adminSessions, adminSignInAttempts, type AdminRole } from '../src/db/schema';
import { createErrand, createTestApp, fund, randomIp, signIn, type TestApp } from './helpers';

const PANEL = 'test-panel-secret-0123456789abcdef0123';
const PASSWORD = 'a long enough password';
let seq = 0;
const newEmail = () => `admin${++seq}.${Date.now()}@jiffoapp.com`;

describe('authenticator codes', () => {
  // RFC 6238, appendix B: the SHA-1 secret is the ASCII bytes "12345678901234567890".
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the published test vectors', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(secret, totpStep(59_000))).toBe('287082');
    expect(totpCode(secret, totpStep(1_111_111_109_000))).toBe('081804');
    expect(totpCode(secret, totpStep(2_000_000_000_000))).toBe('279037');
  });

  it('allows one step of clock drift, and never a step already used', () => {
    const at = 1_111_111_109_000;
    const now = totpStep(at);
    expect(matchTotp(secret, totpCode(secret, now - 1), null, at)).toBe(now - 1);
    expect(matchTotp(secret, totpCode(secret, now + 1), null, at)).toBe(now + 1);
    expect(matchTotp(secret, totpCode(secret, now - 2), null, at)).toBeNull();
    expect(matchTotp(secret, totpCode(secret, now), now, at)).toBeNull();
    expect(matchTotp(secret, 'abcdef', null, at)).toBeNull();
  });
});

describe('admin passwords', () => {
  it('hashes with a fresh salt and checks', async () => {
    const a = await hashPassword(PASSWORD);
    const b = await hashPassword(PASSWORD);
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword(PASSWORD, a)).toBe(true);
    expect(await verifyPassword('something else entirely', a)).toBe(false);
    expect(await verifyPassword(PASSWORD, 'not a hash')).toBe(false);
  });
});

describe('admin', () => {
  let t: TestApp;
  let owner: Admin;

  interface Admin {
    id: string;
    email: string;
    secret: string;
    lastStep: number;
    headers: { Authorization: string };
  }

  beforeAll(async () => {
    t = await createTestApp();
    owner = await makeAdmin('owner');
  });
  afterAll(() => t.close());

  const auth = () => t.app.get(AdminAuthService);
  const tokenOf = (url: string) => url.split('#')[1]!;
  /** The link in the last email to this address: invites and resets go nowhere else. */
  const emailedToken = (email: string) => {
    const text = t.email.lastTo(email)?.text ?? '';
    const url = /https?:\/\/\S+\/invite#\S+/.exec(text)?.[0];
    if (!url) throw new Error(`No link emailed to ${email}`);
    return tokenOf(url);
  };
  const fromIp = (ip = randomIp()) => ({ 'x-jiffo-panel': PANEL, 'x-jiffo-client-ip': ip });

  /** Adds a teammate the way the command-line tool does, and returns their invite token. */
  async function invite(role: AdminRole, email = newEmail()) {
    const [row] = await t.db.insert(admins).values({ email, name: 'Test Admin', role }).returning({ id: admins.id });
    const { inviteUrl } = await auth().issueInvite(t.db, row!.id);
    return { id: row!.id, email, token: tokenOf(inviteUrl) };
  }

  /** A teammate who accepted their invite, set up the authenticator app and is signed in. */
  /** Approves a change that waits; one that ran at once (or was refused) is returned as it was. */
  const decided = async (asked: request.Response, approver: Admin) =>
    asked.status === 202
      ? request(t.http).post(`/v1/admin/approvals/${asked.body.approval.id}/approve`).set(approver.headers).send({})
      : asked;

  async function makeAdmin(role: AdminRole): Promise<Admin> {
    const { id, email, token } = await invite(role);
    await request(t.http).post('/v1/admin/auth/invite/accept').send({ token, password: PASSWORD }).expect(200);
    const signedIn = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(signedIn.body.next).toBe('setup');
    const setup = await request(t.http)
      .post('/v1/admin/auth/setup')
      .send({ challenge: signedIn.body.challenge })
      .expect(200);
    const step = totpStep();
    const done = await request(t.http)
      .post('/v1/admin/auth/code')
      .set(fromIp())
      .send({ challenge: signedIn.body.challenge, code: totpCode(setup.body.secret, step) })
      .expect(200);
    return {
      id,
      email,
      secret: setup.body.secret,
      lastStep: step,
      headers: { Authorization: `Bearer ${done.body.token}` },
    };
  }

  /** Signs in again with the next code the app would show. */
  async function signInAgain(admin: Admin, ip = randomIp()) {
    const first = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp(ip))
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    expect(first.body.next).toBe('code');
    // The next code the app would show: newer than the last one used, and not older than the clock allows.
    admin.lastStep = Math.max(admin.lastStep + 1, totpStep() - 1);
    const res = await request(t.http)
      .post('/v1/admin/auth/code')
      .set(fromIp(ip))
      .send({ challenge: first.body.challenge, code: totpCode(admin.secret, admin.lastStep) });
    return { res, challenge: first.body.challenge as string };
  }

  it('takes a new teammate from invite link to signed in', async () => {
    const { email, token } = await invite('operations');
    const info = await request(t.http).post('/v1/admin/auth/invite/check').send({ token }).expect(200);
    expect(info.body).toEqual({ email, name: 'Test Admin', role: 'operations' });

    const short = await request(t.http).post('/v1/admin/auth/invite/accept').send({ token, password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('password_too_short');
    await request(t.http).post('/v1/admin/auth/invite/accept').send({ token, password: PASSWORD }).expect(200);
    // The link works once.
    await request(t.http).post('/v1/admin/auth/invite/accept').send({ token, password: PASSWORD }).expect(404);
    await request(t.http).post('/v1/admin/auth/invite/check').send({ token }).expect(404);

    const wrong = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email, password: 'not the password at all' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('invalid_credentials');

    const ok = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email: email.toUpperCase(), password: PASSWORD })
      .expect(200);
    expect(ok.body.next).toBe('setup');
    // Sessions only come from a code, never from the password alone.
    await request(t.http)
      .get('/v1/admin/me')
      .set({ Authorization: `Bearer ${ok.body.challenge}` })
      .expect(401);

    const setup = await request(t.http).post('/v1/admin/auth/setup').send({ challenge: ok.body.challenge }).expect(200);
    expect(setup.body.otpauthUrl).toContain(`secret=${setup.body.secret}`);
    // Reloading the setup page shows the same secret, so a scan already made still works.
    const again = await request(t.http).post('/v1/admin/auth/setup').send({ challenge: ok.body.challenge }).expect(200);
    expect(again.body.secret).toBe(setup.body.secret);
    const bad = await request(t.http)
      .post('/v1/admin/auth/code')
      .set(fromIp())
      .send({
        challenge: ok.body.challenge,
        code: '000000' === totpCode(setup.body.secret, totpStep()) ? '111111' : '000000',
      });
    expect(bad.body.error.code).toBe('wrong_code');
    const done = await request(t.http)
      .post('/v1/admin/auth/code')
      .set(fromIp())
      .send({ challenge: ok.body.challenge, code: totpCode(setup.body.secret, totpStep()) })
      .expect(200);

    const me = await request(t.http)
      .get('/v1/admin/me')
      .set({ Authorization: `Bearer ${done.body.token}` })
      .expect(200);
    expect(me.body).toMatchObject({
      email,
      role: 'operations',
      permissions: ['read', 'errands', 'disputes', 'suspend', 'tiers'],
    });
    expect(me.body.countries.map((c: { code: string }) => c.code)).toContain('NG');
    // Once the app is on, the setup step is closed, so a stolen password can't replace it.
    await request(t.http).post('/v1/admin/auth/setup').send({ challenge: ok.body.challenge }).expect(401);
  });

  it('refuses a code that was already used', async () => {
    const admin = await makeAdmin('support');
    const first = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    const replay = await request(t.http)
      .post('/v1/admin/auth/code')
      .set(fromIp())
      .send({ challenge: first.body.challenge, code: totpCode(admin.secret, admin.lastStep) });
    expect(replay.status).toBe(401);
    const { res } = await signInAgain(admin);
    expect(res.status).toBe(200);
  });

  it('pauses wrong passwords per network, so a stranger elsewhere cannot lock a teammate out', async () => {
    const admin = await makeAdmin('support');
    const attacker = randomIp();
    for (let i = 0; i < 5; i++) {
      await request(t.http)
        .post('/v1/admin/auth/sign-in')
        .set(fromIp(attacker))
        .send({ email: admin.email, password: `wrong password ${i}` })
        .expect(401);
    }
    const paused = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp(attacker))
      .send({ email: admin.email, password: PASSWORD });
    expect(paused.status).toBe(429);
    // The teammate, on their own network, still signs in.
    const { res } = await signInAgain(admin);
    expect(res.status).toBe(200);
    // Unknown emails get the same answers, so nobody can find out who is on the team.
    const unknown = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email: 'nobody@jiffoapp.com', password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('invalid_credentials');
  });

  it('pauses wrong codes per admin, even when a burst arrives at once, until a reset', async () => {
    const admin = await makeAdmin('support');
    const first = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
    const right = totpCode(admin.secret, totpStep());
    const wrong = (i: number) => String((Number(right) + 1 + i) % 1_000_000).padStart(6, '0');
    // Twelve guesses at the same moment, from twelve networks: only five are ever checked.
    const answers = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        request(t.http)
          .post('/v1/admin/auth/code')
          .set(fromIp())
          .send({ challenge: first.body.challenge, code: wrong(i) }),
      ),
    );
    const statuses = answers.map((a) => a.status);
    expect(statuses.filter((code) => code === 401)).toHaveLength(5);
    expect(statuses.filter((code) => code === 429)).toHaveLength(7);
    // The right code is refused too while paused.
    await request(t.http)
      .post('/v1/admin/auth/code')
      .set(fromIp())
      .send({ challenge: first.body.challenge, code: right })
      .expect(429);

    // A reset by an owner lifts the pause along with everything else.
    await request(t.http).post(`/v1/admin/team/${admin.id}/reset`).set(owner.headers).expect(201);
    await request(t.http)
      .post('/v1/admin/auth/invite/accept')
      .send({ token: emailedToken(admin.email), password: PASSWORD })
      .expect(200);
    await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email: admin.email, password: PASSWORD })
      .expect(200);
  });

  it('believes the forwarded IP only with the panel secret', async () => {
    const email = newEmail();
    await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set({ 'x-jiffo-panel': PANEL, 'x-jiffo-client-ip': '203.0.113.7' })
      .send({ email, password: PASSWORD })
      .expect(401);
    await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set({ 'x-jiffo-panel': 'wrong-secret-wrong-secret-wrong-secret', 'x-jiffo-client-ip': '203.0.113.8' })
      .send({ email, password: PASSWORD })
      .expect(401);
    const ips = await t.db
      .select({ ip: adminSignInAttempts.ip })
      .from(adminSignInAttempts)
      .where(eq(adminSignInAttempts.email, email));
    expect(ips.map((r) => r.ip)).toContain('203.0.113.7');
    expect(ips.map((r) => r.ip)).not.toContain('203.0.113.8');
  });

  it('ends sessions on sign-out and after 30 idle minutes', async () => {
    const admin = await makeAdmin('support');
    await request(t.http).get('/v1/admin/me').set(admin.headers).expect(200);
    const token = admin.headers.Authorization.split(' ')[1]!;
    const { sha256 } = await import('../src/common/crypto');
    await t.db
      .update(adminSessions)
      .set({ lastSeenAt: new Date(Date.now() - 31 * 60_000) })
      .where(eq(adminSessions.tokenHash, sha256(token)));
    const idle = await request(t.http).get('/v1/admin/me').set(admin.headers);
    expect(idle.status).toBe(401);
    expect(idle.body.error.code).toBe('session_idle');

    const { res } = await signInAgain(admin);
    const headers = { Authorization: `Bearer ${res.body.token}` };
    await request(t.http).post('/v1/admin/auth/sign-out').set(headers).expect(204);
    await request(t.http).get('/v1/admin/me').set(headers).expect(401);
  });

  it('lets each role do only its own work', async () => {
    const support = await makeAdmin('support');
    await request(t.http).get('/v1/admin/overview?country=NG').set(support.headers).expect(200);
    await request(t.http).get('/v1/admin/team').set(support.headers).expect(403);
    await request(t.http).get('/v1/admin/audit').set(support.headers).expect(403);
    // An app session is not an admin session.
    const customer = await signIn(t, 'customer');
    await request(t.http).get('/v1/admin/overview?country=NG').set(customer.headers).expect(401);
  });

  it('runs the team, keeps an owner and records every change', async () => {
    // Team changes need a second owner (docs/security-plan.md, D4): this test always has two more.
    const [second, third] = [await makeAdmin('owner'), await makeAdmin('owner')];

    const asked = await request(t.http)
      .post('/v1/admin/team')
      .set(owner.headers)
      .send({ email: 'New.Person@JiffoApp.com', name: 'New Person', role: 'finance' })
      .expect(202);
    // Nothing is sent, and nobody is added, until another owner approves.
    expect(t.email.lastTo('new.person@jiffoapp.com')).toBeUndefined();
    expect(asked.body.approval).toMatchObject({ kind: 'team_invite', status: 'pending' });
    await request(t.http).post(`/v1/admin/approvals/${asked.body.approval.id}/approve`).set(owner.headers).expect(403);
    const res = await decided(asked, second);
    expect(res.status).toBe(200);
    // The link goes to the new teammate's email, and never back to either owner.
    expect(res.body).toMatchObject({ emailedTo: 'new.person@jiffoapp.com', expiresInHours: 72 });
    expect(JSON.stringify(res.body)).not.toMatch(/invite#/);
    expect(t.email.lastTo('new.person@jiffoapp.com')?.text).toMatch(
      /^Hi New Person,[\s\S]*Test Admin added you[\s\S]*http:\/\/localhost:3001\/invite#/,
    );
    const dup = await request(t.http)
      .post('/v1/admin/team')
      .set(owner.headers)
      .send({ email: 'new.person@jiffoapp.com', name: 'Again', role: 'finance' });
    expect(dup.status).toBe(409);

    const list = await request(t.http).get('/v1/admin/team').set(owner.headers).expect(200);
    expect(list.body.find((a: { email: string }) => a.email === 'new.person@jiffoapp.com')).toMatchObject({
      status: 'invited',
      role: 'finance',
      twoStep: false,
    });

    // Nobody changes their own access, and the last owner can't be removed.
    await request(t.http).patch(`/v1/admin/team/${owner.id}`).set(owner.headers).send({ role: 'support' }).expect(403);
    const demote = await decided(
      await request(t.http).patch(`/v1/admin/team/${owner.id}`).set(second.headers).send({ role: 'operations' }),
      third,
    );
    expect(demote.status).toBe(200);
    expect(demote.body.role).toBe('operations');
    // Their session ended with the role change.
    await request(t.http).get('/v1/admin/me').set(owner.headers).expect(401);
    const last = await decided(
      await request(t.http).patch(`/v1/admin/team/${owner.id}`).set(second.headers).send({ role: 'owner' }),
      third,
    );
    expect(last.status).toBe(200);
    expect(last.body.role).toBe('owner');
    const again = await signInAgain(owner);
    owner.headers = { Authorization: `Bearer ${again.res.body.token}` };

    // Disabling ends sessions at once; giving access back waits for a second owner; a reset clears the
    // password and the app and sends a new link.
    const ops = await makeAdmin('operations');
    await request(t.http).patch(`/v1/admin/team/${ops.id}`).set(owner.headers).send({ status: 'disabled' }).expect(200);
    await request(t.http).get('/v1/admin/me').set(ops.headers).expect(401);
    await request(t.http).post(`/v1/admin/team/${ops.id}/reset`).set(owner.headers).expect(409);
    const back = await decided(
      await request(t.http).patch(`/v1/admin/team/${ops.id}`).set(owner.headers).send({ status: 'active' }),
      second,
    );
    expect(back.status).toBe(200);
    const reset = await request(t.http).post(`/v1/admin/team/${ops.id}/reset`).set(owner.headers).expect(201);
    expect(reset.body).toMatchObject({ emailedTo: ops.email });
    expect(JSON.stringify(reset.body)).not.toMatch(/invite#/);
    const [row] = await t.db.select().from(admins).where(eq(admins.id, ops.id));
    expect(row).toMatchObject({ status: 'invited', passwordHash: null, totpEnabledAt: null });
    await request(t.http)
      .post('/v1/admin/auth/invite/check')
      .send({ token: emailedToken(ops.email) })
      .expect(200);

    const audit = await request(t.http)
      .get(`/v1/admin/audit?targetType=admin&targetId=${ops.id}`)
      .set(owner.headers)
      .expect(200);
    expect(audit.body.entries.map((e: { action: string }) => e.action)).toEqual([
      'team.reset',
      'team.update',
      'team.update',
    ]);
    const [entry] = await t.db
      .select()
      .from(adminAudit)
      .where(and(eq(adminAudit.targetId, ops.id), eq(adminAudit.action, 'team.reset')));
    expect(entry?.adminId).toBe(owner.id);
  });

  it("emails invite and reset links only to the teammate, and keeps nothing when the email can't go", async () => {
    const email = `${randomUUID()}@jiffoapp.com`;
    const before = t.email.sent.length;
    const approver = await makeAdmin('owner');
    const ask = (body: Record<string, unknown>) => request(t.http).post('/v1/admin/team').set(owner.headers).send(body);
    expect((await decided(await ask({ email, name: 'Ada Teammate', role: 'support' }), approver)).status).toBe(200);
    // One email, to the teammate; the owner who made the link gets nothing.
    expect(t.email.sent.slice(before).map((m) => m.to)).toEqual([email]);
    expect(t.email.lastTo(owner.email)).toBeUndefined();
    const invite = t.email.lastTo(email)!;
    expect(invite.subject).toBe('Your invite to Jiffo Admin');
    expect(invite.text).toContain('Test Admin added you to the Jiffo admin team as Support.');

    // The teammate is the only one who can use it: the link sets their password.
    await request(t.http)
      .post('/v1/admin/auth/invite/accept')
      .send({ token: emailedToken(email), password: PASSWORD })
      .expect(200);

    // An invite whose email can't go is taken back, so it can simply be made again.
    t.email.failNext = new Error('provider down');
    const other = `${randomUUID()}@jiffoapp.com`;
    const refused = await decided(await ask({ email: other, name: 'Not Sent', role: 'support' }), approver);
    expect(refused.status).toBe(503);
    expect(refused.body.error.code).toBe('email_failed');
    expect(await t.db.select().from(admins).where(eq(admins.email, other))).toHaveLength(0);
    expect((await decided(await ask({ email: other, name: 'Sent Now', role: 'support' }), approver)).status).toBe(200);
    expect(t.email.lastTo(other)?.text).toMatch(/^Hi Sent Now,/);

    // A reset whose email fails still resets, and says so; resetting again sends a fresh link.
    const [teammate] = await t.db.select().from(admins).where(eq(admins.email, email));
    t.email.failNext = new Error('provider down');
    const failed = await request(t.http).post(`/v1/admin/team/${teammate!.id}/reset`).set(owner.headers).expect(503);
    expect(failed.body.error).toMatchObject({ code: 'email_failed', message: expect.stringMatching(/was reset/) });
    const [after] = await t.db.select().from(admins).where(eq(admins.id, teammate!.id));
    expect(after).toMatchObject({ status: 'invited', passwordHash: null });
    await request(t.http).post(`/v1/admin/team/${teammate!.id}/reset`).set(owner.headers).expect(201);
    await request(t.http)
      .post('/v1/admin/auth/invite/check')
      .send({ token: emailedToken(email) })
      .expect(200);
  });

  it('counts the day on the overview', async () => {
    const before = await request(t.http).get('/v1/admin/overview?country=NG').set(owner.headers).expect(200);
    const customer = await signIn(t, 'customer');
    await fund(t, customer, 5_000_000);
    await createErrand(t, customer);
    const after = await request(t.http).get('/v1/admin/overview?country=ng').set(owner.headers).expect(200);
    expect(after.body.errands.waiting).toBe(before.body.errands.waiting + 1);
    expect(after.body.errands.requestedToday).toBe(before.body.errands.requestedToday + 1);
    expect(after.body.today.topUps).toBe(before.body.today.topUps + 1);
    expect(after.body.balances.customerWalletsKobo).toBe(before.body.balances.customerWalletsKobo + 5_000_000);
    expect(after.body.week).toHaveLength(7);
    await request(t.http).get('/v1/admin/overview?country=XX').set(owner.headers).expect(404);
  });
});
