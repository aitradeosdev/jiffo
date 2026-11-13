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
  const fromIp = (ip = randomIp()) => ({ 'x-jiffo-panel': PANEL, 'x-jiffo-client-ip': ip });

  /** Adds a teammate the way the command-line tool does, and returns their invite token. */
  async function invite(role: AdminRole, email = newEmail()) {
    const [row] = await t.db.insert(admins).values({ email, name: 'Test Admin', role }).returning({ id: admins.id });
    const { inviteUrl } = await auth().issueInvite(t.db, row!.id);
    return { id: row!.id, email, token: tokenOf(inviteUrl) };
  }

  /** A teammate who accepted their invite, set up the authenticator app and is signed in. */
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
    const info = await request(t.http).get(`/v1/admin/auth/invite?token=${token}`).expect(200);
    expect(info.body).toEqual({ email, name: 'Test Admin', role: 'operations' });

    const short = await request(t.http).post('/v1/admin/auth/invite/accept').send({ token, password: 'short' });
    expect(short.status).toBe(400);
    expect(short.body.error.code).toBe('password_too_short');
    await request(t.http).post('/v1/admin/auth/invite/accept').send({ token, password: PASSWORD }).expect(200);
    // The link works once.
    await request(t.http).post('/v1/admin/auth/invite/accept').send({ token, password: PASSWORD }).expect(404);
    await request(t.http).get(`/v1/admin/auth/invite?token=${token}`).expect(404);

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
    expect(me.body).toMatchObject({ email, role: 'operations', permissions: ['read', 'operate'] });
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

  it('pauses sign-in after five wrong attempts for one email', async () => {
    const admin = await makeAdmin('support');
    for (let i = 0; i < 5; i++) {
      await request(t.http)
        .post('/v1/admin/auth/sign-in')
        .set(fromIp())
        .send({ email: admin.email, password: `wrong password ${i}` })
        .expect(401);
    }
    const locked = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email: admin.email, password: PASSWORD });
    expect(locked.status).toBe(429);
    // Unknown emails get the same answers, so nobody can find out who is on the team.
    const unknown = await request(t.http)
      .post('/v1/admin/auth/sign-in')
      .set(fromIp())
      .send({ email: 'nobody@jiffoapp.com', password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.code).toBe('invalid_credentials');
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
    const res = await request(t.http)
      .post('/v1/admin/team')
      .set(owner.headers)
      .send({ email: 'New.Person@JiffoApp.com', name: 'New Person', role: 'finance' })
      .expect(201);
    expect(res.body.inviteUrl).toMatch(/^http:\/\/localhost:3001\/invite#/);
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
    const second = await makeAdmin('owner');
    const demote = await request(t.http)
      .patch(`/v1/admin/team/${owner.id}`)
      .set(second.headers)
      .send({ role: 'operations' })
      .expect(200);
    expect(demote.body.role).toBe('operations');
    // Their session ended with the role change.
    await request(t.http).get('/v1/admin/me').set(owner.headers).expect(401);
    const last = await request(t.http)
      .patch(`/v1/admin/team/${owner.id}`)
      .set(second.headers)
      .send({ role: 'owner' })
      .expect(200);
    expect(last.body.role).toBe('owner');
    const again = await signInAgain(owner);
    owner.headers = { Authorization: `Bearer ${again.res.body.token}` };

    // Disabling ends sessions; a reset clears the password and the app and sends a new link.
    const ops = await makeAdmin('operations');
    await request(t.http).patch(`/v1/admin/team/${ops.id}`).set(owner.headers).send({ status: 'disabled' }).expect(200);
    await request(t.http).get('/v1/admin/me').set(ops.headers).expect(401);
    await request(t.http).post(`/v1/admin/team/${ops.id}/reset`).set(owner.headers).expect(409);
    await request(t.http).patch(`/v1/admin/team/${ops.id}`).set(owner.headers).send({ status: 'active' }).expect(200);
    const reset = await request(t.http).post(`/v1/admin/team/${ops.id}/reset`).set(owner.headers).expect(201);
    const [row] = await t.db.select().from(admins).where(eq(admins.id, ops.id));
    expect(row).toMatchObject({ status: 'invited', passwordHash: null, totpEnabledAt: null });
    await request(t.http)
      .get(`/v1/admin/auth/invite?token=${tokenOf(reset.body.inviteUrl)}`)
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
