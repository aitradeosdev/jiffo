import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../src/admin/audit.service';
import { adminAudit } from '../src/db/schema';
import { adminAs, approved, createTestApp, fund, signIn, type TestApp } from './helpers';

/**
 * The audit log and personal details (docs/security-plan.md, D5, D7): every change says why and from which
 * browser, the log can't be rewritten, the command line is in it, and personal details are masked unless
 * revealed with a reason, a limited number of times a day.
 */
describe('admin audit log and personal details', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const entry = async (action: string, targetId: string) =>
    (
      await t.db
        .select()
        .from(adminAudit)
        .where(and(eq(adminAudit.action, action), eq(adminAudit.targetId, targetId)))
    )[0];

  it('refuses a change without a reason, and keeps the reason and browser of one with it', async () => {
    const owner = await adminAs(t, 'owner');
    const key = `audit${Date.now() % 1_000_000}`;
    const body = { country: 'NG', key, name: 'Audit test', icon: 'bag' };
    const { 'x-jiffo-reason': _, ...noReason } = owner.headers;
    const refused = await request(t.http).post('/v1/admin/categories').set(noReason).send(body);
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('reason_required');
    // Too short to say anything.
    await request(t.http)
      .post('/v1/admin/categories')
      .set({ ...noReason, 'x-jiffo-reason': 'ok' })
      .send(body)
      .expect(400);

    const made = await request(t.http)
      .post('/v1/admin/categories')
      .set({ ...noReason, 'x-jiffo-reason': 'New category for the Lagos launch', 'user-agent': 'TestBrowser/1.0' })
      .send(body)
      .expect(201);
    expect(await entry('category.create', made.body.id)).toMatchObject({
      adminId: owner.id,
      via: 'panel',
      reason: 'New category for the Lagos launch',
      userAgent: 'TestBrowser/1.0',
    });
    // Out of the public list again, for the other tests.
    await request(t.http).delete(`/v1/admin/categories/${made.body.id}`).set(owner.headers).expect(200);
  });

  it('takes a reason as long as a note may be, and one with characters a header carries only encoded', async () => {
    const safety = await adminAs(t, 'safety');
    const customer = await signIn(t, 'customer');
    const long = `Threatened an agent in chat. ${'They sent more messages after a warning. '.repeat(20)}`.slice(0, 900);
    await request(t.http)
      .post(`/v1/admin/people/${customer.userId}/suspend`)
      .set(safety.headers)
      .send({ note: long })
      .expect(200);
    expect(await entry('person.suspend', customer.userId)).toMatchObject({ reason: long.trim() });

    const owner = await adminAs(t, 'owner');
    const key = `naira${Date.now() % 1_000_000}`;
    const { 'x-jiffo-reason': _, ...noReason } = owner.headers;
    const said = 'Customers can’t find ₦500 errands';
    const made = await request(t.http)
      .post('/v1/admin/categories')
      .set({ ...noReason, 'x-jiffo-reason': encodeURIComponent(said) })
      .send({ country: 'NG', key, name: 'Naira test', icon: 'bag' })
      .expect(201);
    expect(await entry('category.create', made.body.id)).toMatchObject({ reason: said });
    await request(t.http).delete(`/v1/admin/categories/${made.body.id}`).set(owner.headers).expect(200);
  });

  it('runs an approved change with the reason typed and the browser of the person who asked', async () => {
    const asker = await adminAs(t, 'owner');
    const approver = await adminAs(t, 'owner');
    const email = `audit-${randomUUID().slice(0, 8)}@jiffoapp.com`;
    const asked = await request(t.http)
      .post('/v1/admin/team')
      .set({ ...asker.headers, 'x-jiffo-reason': 'Hiring for the Abuja launch', 'user-agent': 'AskerBrowser/1.0' })
      .send({ email, name: 'Abuja Hire', role: 'support' })
      .expect(202);
    await request(t.http)
      .post(`/v1/admin/approvals/${asked.body.approval.id}/approve`)
      .set({ ...approver.headers, 'user-agent': 'ApproverBrowser/2.0' })
      .send({})
      .expect(200);
    const [invited] = await t.db
      .select()
      .from(adminAudit)
      .where(and(eq(adminAudit.action, 'team.invite'), sql`${adminAudit.data}->>'email' = ${email}`));
    expect(invited).toMatchObject({
      adminId: asker.id,
      reason: 'Hiring for the Abuja launch',
      userAgent: 'AskerBrowser/1.0',
    });
  });

  it('keeps the log append-only: no change, deletion or emptying, whoever asks', async () => {
    const [row] = await t.db.select({ id: adminAudit.id }).from(adminAudit).limit(1);
    await expect(t.db.execute(sql`update admin_audit set reason = 'rewritten' where id = ${row!.id}`)).rejects.toThrow(
      /append-only/,
    );
    await expect(t.db.execute(sql`delete from admin_audit where id = ${row!.id}`)).rejects.toThrow(/append-only/);
    await expect(t.db.execute(sql`truncate admin_audit`)).rejects.toThrow(/append-only/);
  });

  it('records balances and statuses before and after', async () => {
    const customer = await signIn(t, 'customer');
    await fund(t, customer, 100_000);
    const credited = await approved(t, 'finance', (h) =>
      request(t.http).post('/v1/admin/money/adjustments').set(h).send({
        personId: customer.userId,
        account: 'customer_wallet',
        direction: 'credit',
        amountKobo: 25_000,
        note: 'Goodwill for a late delivery',
        requestId: randomUUID(),
      }),
    );
    expect(credited.status).toBe(200);
    expect((await entry('money.adjust', customer.userId))!.data).toMatchObject({
      balanceBeforeKobo: 100_000,
      balanceAfterKobo: 125_000,
    });

    const safety = await adminAs(t, 'safety');
    await request(t.http)
      .post(`/v1/admin/people/${customer.userId}/suspend`)
      .set(safety.headers)
      .send({ note: 'Threatened an agent in chat' })
      .expect(200);
    expect(await entry('person.suspend', customer.userId)).toMatchObject({
      reason: 'Threatened an agent in chat',
      data: { from: 'active', to: 'suspended' },
    });
  });

  it("records the command line's changes, with no admin and the reason given", async () => {
    const target = randomUUID();
    await t.db.transaction((tx) =>
      t.app.get(AuditService).recordCli(tx, {
        action: 'team.reset',
        targetType: 'admin',
        targetId: target,
        reason: 'Owner lost their phone',
      }),
    );
    expect(await entry('team.reset', target)).toMatchObject({
      adminId: null,
      via: 'cli',
      reason: 'Owner lost their phone',
    });
    const owner = await adminAs(t, 'owner');
    const list = await request(t.http)
      .get(`/v1/admin/audit?targetType=admin&targetId=${target}`)
      .set(owner.headers)
      .expect(200);
    expect(list.body.entries[0]).toMatchObject({ via: 'cli', admin: null, reason: 'Owner lost their phone' });
    // A row from the panel must name its admin.
    await expect(
      t.db.execute(sql`insert into admin_audit (action, via) values ('test.nobody', 'panel')`),
    ).rejects.toThrow(/admin_audit_actor/);
  });

  it('caps how many people one staff member can reveal in a day, and needs a reason each time', async () => {
    const owner = await adminAs(t, 'owner');
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    const before = settings.security.dailyIdReveals;
    settings.security.dailyIdReveals = 2;
    const save = (s: unknown, basedOn: number) =>
      approved(t, 'owner', (h) =>
        request(t.http)
          .post('/v1/admin/settings?country=NG')
          .set(h)
          .send({ basedOn, settings: s, note: 'Reveal cap for a test' }),
      );
    expect((await save(settings, now.version)).status).toBe(200);
    try {
      const verification = await adminAs(t, 'verification');
      const reveal = async (body: object = { note: 'Checking the ID against the selfie' }) => {
        const person = await signIn(t, 'customer');
        return request(t.http).post(`/v1/admin/people/${person.userId}/reveal`).set(verification.headers).send(body);
      };
      expect((await reveal({ note: 'ok' })).status).toBe(400);
      await reveal().then((r) => expect(r.status).toBe(200));
      await reveal().then((r) => expect(r.status).toBe(200));
      const third = await reveal();
      expect(third.status).toBe(429);
      expect(third.body.error.code).toBe('reveal_limit');
      // Someone with nothing masked to show uses no reveal.
      const agent = await signIn(t, 'agent', { unapproved: true });
      const none = await request(t.http)
        .post(`/v1/admin/people/${agent.userId}/reveal`)
        .set(verification.headers)
        .send({ note: 'Checking the ID against the selfie' });
      expect(none.status).toBe(404);
      expect(none.body.error.code).toBe('nothing_to_reveal');
    } finally {
      const latest = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
      const back = structuredClone(latest.settings);
      back.security.dailyIdReveals = before;
      expect((await save(back, latest.version)).status).toBe(200);
    }
  });
});
