import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminApprovals, adminAudit, admins, users } from '../src/db/schema';
import {
  act,
  adminAs,
  balanceOf,
  createErrand,
  createTestApp,
  fund,
  signIn,
  type Person,
  type TestApp,
} from './helpers';

/**
 * Staff and their own app accounts (docs/security-plan.md, D3): each teammate's phone number links them to
 * the customer or agent account they hold, and no change to that account, or to an errand it is part of,
 * can come from them, whichever route it takes.
 */
describe('staff and their own app accounts', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const auditBy = (adminId: string) => t.db.select().from(adminAudit).where(eq(adminAudit.adminId, adminId));
  const refused = (res: request.Response, code = 'own_account') => {
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error.code).toBe(code);
  };

  it("refuses any change to a teammate's own account, and changes nothing", async () => {
    const me = await signIn(t, 'customer');
    await fund(t, me, 50_000);
    const before = await balanceOf(t, me);
    const finance = await adminAs(t, 'finance', { phone: me.phone });
    const safety = await adminAs(t, 'safety', { phone: me.phone });
    const verification = await adminAs(t, 'verification', { phone: me.phone });

    refused(
      await request(t.http).post('/v1/admin/money/adjustments').set(finance.headers).send({
        personId: me.userId,
        account: 'customer_wallet',
        direction: 'credit',
        amountKobo: 1_000_000,
        note: 'Goodwill for a late delivery',
        requestId: randomUUID(),
      }),
    );
    refused(
      await request(t.http)
        .post(`/v1/admin/people/${me.userId}/suspend`)
        .set(safety.headers)
        .send({ note: 'Testing a suspension' }),
    );
    refused(
      await request(t.http)
        .post(`/v1/admin/people/${me.userId}/reveal`)
        .set(verification.headers)
        .send({ note: 'Checking my own details' }),
    );

    expect(await balanceOf(t, me)).toEqual(before);
    const [row] = await t.db.select({ status: users.status }).from(users).where(eq(users.id, me.userId));
    expect(row!.status).toBe('active');
    for (const who of [finance, safety, verification]) expect(await auditBy(who.id)).toEqual([]);
    // Nothing was left waiting for a second admin either.
    expect(await t.db.select().from(adminApprovals).where(eq(adminApprovals.requestedBy, finance.id))).toEqual([]);
  });

  it('refuses approving a request about their own account', async () => {
    const me = await signIn(t, 'customer');
    const asker = await adminAs(t, 'finance');
    const approver = await adminAs(t, 'finance', { phone: me.phone });
    const asked = await request(t.http).post('/v1/admin/money/adjustments').set(asker.headers).send({
      personId: me.userId,
      account: 'customer_wallet',
      direction: 'credit',
      amountKobo: 500_000,
      note: 'Refund for a cancelled errand',
      requestId: randomUUID(),
    });
    expect(asked.status).toBe(202);
    refused(
      await request(t.http)
        .post(`/v1/admin/approvals/${asked.body.approval.id}/approve`)
        .set(approver.headers)
        .send({ note: 'Looks right' }),
    );
    const [approval] = await t.db.select().from(adminApprovals).where(eq(adminApprovals.id, asked.body.approval.id));
    expect(approval!.status).toBe('pending');
    expect((await balanceOf(t, me)).balanceKobo).toBe(0);
  });

  it('refuses settling an errand they are the customer or the agent of', async () => {
    const customer = await signIn(t, 'customer');
    const agent: Person = await signIn(t, 'agent');
    await fund(t, customer, 2_000_000);
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    await act(t, customer, errand.id, 'open_dispute', { reason: 'The agent went to the wrong shop' });
    for (const phone of [customer.phone, agent.phone]) {
      const disputes = await adminAs(t, 'disputes', { phone });
      const view = await request(t.http).get(`/v1/admin/errands/${errand.id}`).set(disputes.headers).expect(200);
      refused(
        await request(t.http).post(`/v1/admin/errands/${errand.id}/actions`).set(disputes.headers).send({
          event: 'resolve_complete',
          version: view.body.errand.version,
          note: 'Delivered as asked',
        }),
      );
    }
    // Someone else can.
    const other = await adminAs(t, 'disputes');
    const view = await request(t.http).get(`/v1/admin/errands/${errand.id}`).set(other.headers).expect(200);
    await request(t.http)
      .post(`/v1/admin/errands/${errand.id}/actions`)
      .set(other.headers)
      .send({ event: 'resolve_complete', version: view.body.errand.version, note: 'Delivered as asked' })
      .expect(200);
  });

  it("needs a teammate's phone before they change anyone's account; other changes still work", async () => {
    const person = await signIn(t, 'customer');
    const safety = await adminAs(t, 'safety', { phone: null });
    refused(
      await request(t.http)
        .post(`/v1/admin/people/${person.userId}/suspend`)
        .set(safety.headers)
        .send({ note: 'Threatened an agent' }),
      'phone_needed',
    );
    const owner = await adminAs(t, 'owner', { phone: null });
    const made = await request(t.http)
      .post('/v1/admin/categories')
      .set(owner.headers)
      .send({ country: 'NG', key: `own${Date.now() % 1_000_000}`, name: 'Own test', icon: 'bag' })
      .expect(201);
    await request(t.http).delete(`/v1/admin/categories/${made.body.id}`).set(owner.headers).expect(200);
  });

  it('takes a phone with every invite; adding one is at once, and changing it waits for a second owner', async () => {
    const owner = await adminAs(t, 'owner');
    const second = await adminAs(t, 'owner');
    const email = `own-${randomUUID().slice(0, 8)}@jiffoapp.com`;
    const invite = (body: object) => request(t.http).post('/v1/admin/team').set(owner.headers).send(body);
    await invite({ email, name: 'New Teammate', role: 'support' }).expect(400);
    const bad = await invite({ email, name: 'New Teammate', role: 'support', phone: '12345' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('invalid_phone');
    const asked = await invite({ email, name: 'New Teammate', role: 'support', phone: '0803 123 4567' }).expect(202);
    await request(t.http)
      .post(`/v1/admin/approvals/${asked.body.approval.id}/approve`)
      .set(second.headers)
      .send({})
      .expect(200);
    const [invited] = await t.db.select().from(admins).where(eq(admins.email, email));
    expect(invited!.phone).toBe('+2348031234567');
    const team = await request(t.http).get('/v1/admin/team').set(owner.headers).expect(200);
    expect(team.body.find((a: { id: string }) => a.id === invited!.id)).toMatchObject({
      phone: '+234•••••••567',
    });

    // A teammate with no phone yet gets one at once: it only adds protection.
    const none = await adminAs(t, 'support', { phone: null });
    await request(t.http)
      .patch(`/v1/admin/team/${none.id}`)
      .set(owner.headers)
      .send({ phone: '08031234568' })
      .expect(200);
    const [added] = await t.db.select({ phone: admins.phone }).from(admins).where(eq(admins.id, none.id));
    expect(added!.phone).toBe('+2348031234568');
    // Changing it could unlink their account, so a second owner must agree.
    const change = await request(t.http)
      .patch(`/v1/admin/team/${none.id}`)
      .set(owner.headers)
      .send({ phone: '08031234569' })
      .expect(202);
    expect(change.body.approval.summary).toMatch(/phone/);
    const [still] = await t.db.select({ phone: admins.phone }).from(admins).where(eq(admins.id, none.id));
    expect(still!.phone).toBe('+2348031234568');
    await request(t.http)
      .post(`/v1/admin/approvals/${change.body.approval.id}/approve`)
      .set(second.headers)
      .send({})
      .expect(200);
    const [changed] = await t.db.select({ phone: admins.phone }).from(admins).where(eq(admins.id, none.id));
    expect(changed!.phone).toBe('+2348031234569');
    // Nobody changes their own.
    refused(
      await request(t.http).patch(`/v1/admin/team/${owner.id}`).set(owner.headers).send({ phone: '08031234570' }),
    );
    const entries = await t.db
      .select()
      .from(adminAudit)
      .where(and(eq(adminAudit.targetType, 'admin'), eq(adminAudit.targetId, none.id)));
    expect(entries.map((e) => e.action)).toEqual(expect.arrayContaining(['team.update']));
  });
});
