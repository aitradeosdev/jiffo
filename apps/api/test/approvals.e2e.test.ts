import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TermiiMessagingAdapter } from '../src/adapters/messaging';
import { adminApprovals, adminAudit, admins, errands, providerSettings, users } from '../src/db/schema';
import { ProvidersService } from '../src/providers/providers.service';
import {
  act,
  adminAs,
  approved,
  balanceOf,
  createErrand,
  createTestApp,
  fund,
  signIn,
  switchProvider,
  type Person,
  type TestApp,
} from './helpers';

type Admin = Awaited<ReturnType<typeof adminAs>>;

/**
 * Two-person approval (docs/security-plan.md, D3, D4, E7, X7): changes that need it wait for someone else
 * whose role allows them, the person who asked can never approve their own, and each runs once.
 */
describe('admin approvals', () => {
  let t: TestApp;
  let finance: Admin;
  let financeTwo: Admin;
  let owner: Admin;
  let customer: Person;

  const credit = (who: Admin, amountKobo = 25_000, personId = customer.userId) =>
    request(t.http).post('/v1/admin/money/adjustments').set(who.headers).send({
      personId,
      account: 'customer_wallet',
      direction: 'credit',
      amountKobo,
      note: 'Goodwill for a late delivery',
      requestId: randomUUID(),
    });
  const approve = (id: string, who: Admin) =>
    request(t.http).post(`/v1/admin/approvals/${id}/approve`).set(who.headers).send({ note: 'Checked the errand' });
  const rowOf = async (id: string) => (await t.db.select().from(adminApprovals).where(eq(adminApprovals.id, id)))[0]!;

  /** Sets Security settings for the test, approved like any change, and gives back how to put them back. */
  async function security(changes: Record<string, number>) {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const before = structuredClone(now.settings.security);
    const settings = structuredClone(now.settings);
    Object.assign(settings.security, changes);
    const save = async (s: unknown, basedOn: number) =>
      approved(t, 'owner', (h) =>
        request(t.http).post('/v1/admin/settings?country=NG').set(h).send({ basedOn, settings: s, note: 'For a test' }),
      );
    const saved = await save(settings, now.version);
    expect(saved.status).toBe(200);
    return async () => {
      const latest = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
      const back = structuredClone(latest.settings);
      back.security = before;
      expect((await save(back, latest.version)).status).toBe(200);
    };
  }

  beforeAll(async () => {
    t = await createTestApp();
    [finance, financeTwo, owner] = await Promise.all([
      adminAs(t, 'finance'),
      adminAs(t, 'finance'),
      adminAs(t, 'owner'),
    ]);
    customer = await signIn(t, 'customer');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => t.close());

  it('holds a wallet adjustment until someone else with money access approves it', async () => {
    const before = (await balanceOf(t, customer)).balanceKobo;
    const asked = await credit(finance).expect(202);
    expect(asked.body).toMatchObject({
      pending: true,
      approval: { kind: 'wallet_adjustment', status: 'pending', requestedBy: { id: finance.id } },
    });
    expect(asked.body.approval.summary).toMatch(/^Credit ₦250 to .+'s customer wallet$/);
    expect((await balanceOf(t, customer)).balanceKobo).toBe(before);

    // Not the person who asked; not a role without money access.
    const own = await approve(asked.body.approval.id, finance);
    expect(own.status).toBe(403);
    expect(own.body.error.code).toBe('own_request');
    for (const role of ['support', 'operations', 'verification'] as const) {
      expect((await approve(asked.body.approval.id, await adminAs(t, role))).status).toBe(403);
    }
    expect((await balanceOf(t, customer)).balanceKobo).toBe(before);

    // Another finance admin approves: it runs as the person who asked, with both in the audit log.
    const done = await approve(asked.body.approval.id, financeTwo).expect(200);
    expect(done.body).toMatchObject({
      posted: true,
      approval: { status: 'approved', decidedBy: { id: financeTwo.id } },
    });
    expect((await balanceOf(t, customer)).balanceKobo).toBe(before + 25_000);
    const [entry] = await t.db
      .select()
      .from(adminAudit)
      .where(
        sql`${adminAudit.action} = 'money.adjust' and ${adminAudit.data}->'approval'->>'id' = ${asked.body.approval.id}`,
      );
    expect(entry).toMatchObject({ adminId: finance.id, data: { approval: { approvedBy: financeTwo.id } } });

    // Decided once: approving again changes nothing.
    expect((await approve(asked.body.approval.id, owner)).status).toBe(409);
    expect((await balanceOf(t, customer)).balanceKobo).toBe(before + 25_000);
  });

  it('runs a change once when two people approve it at the same moment', async () => {
    const before = (await balanceOf(t, customer)).balanceKobo;
    const asked = await credit(finance).expect(202);
    const results = await Promise.all([
      approve(asked.body.approval.id, financeTwo),
      approve(asked.body.approval.id, owner),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await balanceOf(t, customer)).balanceKobo).toBe(before + 25_000);
  });

  it('refuses, in the database itself, a decision by the person who asked', async () => {
    const asked = await credit(finance).expect(202);
    await expect(
      t.db.execute(
        sql`update admin_approvals set status = 'approved', decided_by = requested_by where id = ${asked.body.approval.id}`,
      ),
    ).rejects.toThrow(/admin_approvals_second_person/);
  });

  it('goes ahead alone only when nobody else ever could approve, and says so', async () => {
    const solo = await adminAs(t, 'finance');
    // A team where nobody else who could approve money has ever signed in, as a new team is.
    const others = await t.db
      .select({ id: admins.id, lastSignInAt: admins.lastSignInAt })
      .from(admins)
      .where(
        sql`${admins.id} <> ${solo.id} and ${admins.role} in ('finance', 'owner') and ${admins.lastSignInAt} is not null`,
      );
    await t.db
      .update(admins)
      .set({ lastSignInAt: null })
      .where(
        inArray(
          admins.id,
          others.map((o) => o.id),
        ),
      );
    try {
      const before = (await balanceOf(t, customer)).balanceKobo;
      const done = await credit(solo).expect(200);
      expect(done.body).toMatchObject({
        posted: true,
        approval: { status: 'approved', selfApproved: true, decidedBy: { id: solo.id } },
      });
      expect((await balanceOf(t, customer)).balanceKobo).toBe(before + 25_000);
    } finally {
      for (const o of others)
        await t.db.update(admins).set({ lastSignInAt: o.lastSignInAt }).where(eq(admins.id, o.id));
    }
    // With someone else on the team, the same request waits again.
    expect((await credit(solo)).status).toBe(202);
  });

  it("doesn't let an owner approve alone by disabling or resetting the other approvers", async () => {
    const solo = await adminAs(t, 'finance');
    // Everyone else who could approve money is disabled (or reset): they still count, so it waits.
    const away = await t.db
      .update(admins)
      .set({ status: 'disabled' })
      .where(sql`${admins.status} = 'active' and ${admins.id} <> ${solo.id} and ${admins.role} in ('finance', 'owner')`)
      .returning({ id: admins.id });
    try {
      const asked = await credit(solo);
      expect(asked.status).toBe(202);
      expect(asked.body.approval.status).toBe('pending');
    } finally {
      await t.db
        .update(admins)
        .set({ status: 'active' })
        .where(
          inArray(
            admins.id,
            away.map((a) => a.id),
          ),
        );
    }
  });

  it('marks a request that stopped while running as failed, saying to check', async () => {
    const asked = await credit(finance).expect(202);
    await t.db
      .update(adminApprovals)
      .set({ status: 'running', decidedBy: financeTwo.id, decidedAt: new Date(Date.now() - 11 * 60_000) })
      .where(eq(adminApprovals.id, asked.body.approval.id));
    await request(t.http).get('/v1/admin/approvals?done=true').set(financeTwo.headers).expect(200);
    expect(await rowOf(asked.body.approval.id)).toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/Check the audit log/),
    });
  });

  it('lets the asker take a request back, and another admin turn it down, with nothing moved', async () => {
    const before = (await balanceOf(t, customer)).balanceKobo;
    const one = await credit(finance).expect(202);
    expect(
      (await request(t.http).post(`/v1/admin/approvals/${one.body.approval.id}/cancel`).set(financeTwo.headers)).status,
    ).toBe(409);
    await request(t.http).post(`/v1/admin/approvals/${one.body.approval.id}/cancel`).set(finance.headers).expect(200);
    expect((await rowOf(one.body.approval.id)).status).toBe('cancelled');

    const two = await credit(finance).expect(202);
    const reject = (body: object) =>
      request(t.http).post(`/v1/admin/approvals/${two.body.approval.id}/reject`).set(financeTwo.headers).send(body);
    expect((await reject({})).status).toBe(400);
    await reject({ note: 'Already refunded by bank transfer' }).expect(200);
    expect(await rowOf(two.body.approval.id)).toMatchObject({
      status: 'rejected',
      decidedBy: financeTwo.id,
      decisionNote: 'Already refunded by bank transfer',
    });
    expect((await approve(two.body.approval.id, owner)).status).toBe(409);
    expect((await balanceOf(t, customer)).balanceKobo).toBe(before);
  });

  it('lets a request lapse, and checks the asker is still allowed when it runs', async () => {
    const stale = await credit(finance).expect(202);
    await t.db
      .update(adminApprovals)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(adminApprovals.id, stale.body.approval.id));
    expect((await approve(stale.body.approval.id, financeTwo)).status).toBe(409);
    expect((await rowOf(stale.body.approval.id)).status).toBe('expired');

    // Moved to support since asking: their request no longer runs.
    const mover = await adminAs(t, 'finance');
    const asked = await credit(mover).expect(202);
    await t.db.update(admins).set({ role: 'support' }).where(eq(admins.id, mover.id));
    const refused = await approve(asked.body.approval.id, financeTwo);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe('requester_not_permitted');
    expect(await rowOf(asked.body.approval.id)).toMatchObject({ status: 'failed' });
  });

  it('shows each admin what waits for them, and their own requests', async () => {
    const asked = await credit(finance).expect(202);
    const list = async (who: Admin) =>
      (await request(t.http).get('/v1/admin/approvals').set(who.headers).expect(200)).body.approvals as Array<{
        id: string;
        canDecide: boolean;
        canCancel: boolean;
      }>;
    expect((await list(financeTwo)).find((a) => a.id === asked.body.approval.id)).toMatchObject({
      canDecide: true,
      canCancel: false,
    });
    expect((await list(finance)).find((a) => a.id === asked.body.approval.id)).toMatchObject({
      canDecide: false,
      canCancel: true,
    });
    // Support can't decide money, so money requests aren't theirs to see here.
    expect((await list(await adminAs(t, 'support'))).find((a) => a.id === asked.body.approval.id)).toBeUndefined();
    const waiting = await request(t.http).get('/v1/admin/approvals/waiting').set(financeTwo.headers).expect(200);
    expect(waiting.body.waiting).toBeGreaterThan(0);
  });

  it('holds a dispute split that pays the agent more than the set amount; smaller ones run at once', async () => {
    const restore = await security({ disputeSplitApprovalKobo: 100_000 });
    try {
      const agent = await signIn(t, 'agent');
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, 3_000_000);
      const ops = await adminAs(t, 'operations');
      const disputes = await adminAs(t, 'disputes');
      const disputed = async () => {
        const errand = await createErrand(t, buyer);
        await act(t, agent, errand.id, 'accept');
        await act(t, agent, errand.id, 'start');
        await act(t, buyer, errand.id, 'open_dispute', { reason: 'The agent went to the wrong shop' });
        const d = (await request(t.http).get(`/v1/admin/errands/${errand.id}`).set(ops.headers).expect(200)).body;
        return { id: errand.id as string, version: d.errand.version as number };
      };
      const settle = (e: { id: string; version: number }, agentKobo: number, who: Admin = ops) =>
        request(t.http)
          .post(`/v1/admin/errands/${e.id}/actions`)
          .set(who.headers)
          .send({
            event: 'resolve_complete',
            version: e.version,
            note: 'Both sides agreed on part of the fee',
            split: { agentKobo, jiffoKobo: 0, itemsToAgentKobo: 0, chargeCustomerKobo: 0 },
          });

      const small = await disputed();
      await settle(small, 50_000).expect(200);

      const big = await disputed();
      const asked = await settle(big, 150_000).expect(202);
      expect(asked.body.approval).toMatchObject({ kind: 'dispute_split', targetId: big.id });
      expect((await approve(asked.body.approval.id, ops)).status).toBe(403);
      const before = (await balanceOf(t, agent)).heldKobo + (await balanceOf(t, agent)).availableKobo;
      await approve(asked.body.approval.id, disputes).expect(200);
      const after = await balanceOf(t, agent);
      expect(after.heldKobo + after.availableKobo - before).toBe(150_000);

      // Settling as complete the standard way pays the agent their share of the fee: above the amount, it waits.
      const standard = await disputed();
      const whole = await request(t.http)
        .post(`/v1/admin/errands/${standard.id}/actions`)
        .set(ops.headers)
        .send({ event: 'resolve_complete', version: standard.version, note: 'The agent did deliver it' })
        .expect(202);
      expect(whole.body.approval.summary).toMatch(/as complete: .+ to the agent$/);
      await approve(whole.body.approval.id, disputes).expect(200);
      // Cancelling the standard way pays the agent nothing, so it runs at once.
      const refunded = await disputed();
      await request(t.http)
        .post(`/v1/admin/errands/${refunded.id}/actions`)
        .set(ops.headers)
        .send({ event: 'resolve_cancel', version: refunded.version, note: 'The agent never went to the shop' })
        .expect(200);

      // Stepping into an errand is operations' work, not disputes'.
      const other = await disputed();
      const cancel = await request(t.http)
        .post(`/v1/admin/errands/${other.id}/actions`)
        .set(disputes.headers)
        .send({ event: 'admin_cancel', version: other.version, note: 'Trying to cancel it' });
      expect(cancel.status).toBe(403);
    } finally {
      await restore();
    }
  });

  it('holds suspending an agent who has done many errands; anyone else is suspended at once', async () => {
    const restore = await security({ busyAgentErrands: 1 });
    try {
      const safety = await adminAs(t, 'safety');
      const ops = await adminAs(t, 'operations');
      const newcomer = await signIn(t, 'customer');
      await request(t.http)
        .post(`/v1/admin/people/${newcomer.userId}/suspend`)
        .set(safety.headers)
        .send({ note: 'Threatened an agent in chat' })
        .expect(200);

      // An agent with one errand done (written directly: how it got done is tested elsewhere).
      const busy = await signIn(t, 'agent');
      const buyer = await signIn(t, 'customer');
      await fund(t, buyer, 1_000_000);
      const done = await createErrand(t, buyer);
      await t.db.update(errands).set({ agentId: busy.userId, status: 'completed' }).where(eq(errands.id, done.id));
      const asked = await request(t.http)
        .post(`/v1/admin/people/${busy.userId}/suspend`)
        .set(safety.headers)
        .send({ note: 'Reported by several customers' })
        .expect(202);
      expect(asked.body.approval.summary).toMatch(/an agent with 1 completed errands$/);
      expect((await t.db.select().from(users).where(eq(users.id, busy.userId)))[0]!.status).toBe('active');
      // A role that can't suspend can't approve it; one that can, can.
      expect((await approve(asked.body.approval.id, await adminAs(t, 'verification'))).status).toBe(403);
      await approve(asked.body.approval.id, ops).expect(200);
      expect((await t.db.select().from(users).where(eq(users.id, busy.userId)))[0]!.status).toBe('suspended');
    } finally {
      await restore();
    }
  });

  it('holds switching providers and changing the keys of the one in use, and never stores keys readable', async () => {
    const api = (method: 'put' | 'post', path: string) =>
      request(t.http)[method](`/v1/admin/providers${path}`).set(owner.headers);
    try {
      await api('put', '/sms/termii')
        .send({ config: { senderId: 'Jiffo' }, secrets: { apiKey: 'TL-test-first-0123456789' } })
        .expect(200);
      vi.spyOn(TermiiMessagingAdapter.prototype, 'check').mockResolvedValue('Connected');
      await api('post', '/sms/termii/test').expect(200);
      const asked = await api('post', '/sms/active').send({ provider: 'termii' }).expect(202);
      expect(asked.body.approval.summary).toMatch(/^SMS: switch from the server's choice to Termii$/);
      // Saved again after asking: what was approved is no longer what would switch on.
      await api('put', '/sms/termii')
        .send({ config: { senderId: 'Jiffo2' } })
        .expect(200);
      await api('post', '/sms/termii/test').expect(200);
      const second = await adminAs(t, 'owner');
      expect((await approve(asked.body.approval.id, second)).body.error.code).toBe('provider_changed');
      await switchProvider(t, 'sms', 'termii');

      // New keys for the provider in use wait, sealed.
      const change = await api('put', '/sms/termii')
        .send({ secrets: { apiKey: 'TL-test-second-9876543210' } })
        .expect(202);
      const [pending] = await t.db.select().from(adminApprovals).where(eq(adminApprovals.id, change.body.approval.id));
      expect(JSON.stringify(pending)).not.toContain('TL-test-second');
      const before = (await t.db.select().from(providerSettings).where(eq(providerSettings.provider, 'termii')))[0]!;
      expect(before.secretHints).toEqual({ apiKey: '••••6789' });
      await approve(change.body.approval.id, second).expect(200);
      const after = (await t.db.select().from(providerSettings).where(eq(providerSettings.provider, 'termii')))[0]!;
      expect(after.secretHints).toEqual({ apiKey: '••••3210' });
      expect(after.active).toBe(true);
    } finally {
      await t.db.delete(providerSettings);
      await t.app.get(ProvidersService).reload();
    }
  });

  it('disables a teammate at once, even with a role change that waits', async () => {
    const target = await adminAs(t, 'operations');
    const res = await request(t.http)
      .patch(`/v1/admin/team/${target.id}`)
      .set(owner.headers)
      .send({ role: 'owner', status: 'disabled' })
      .expect(202);
    expect(res.body.approval).toMatchObject({ kind: 'team_change', status: 'pending' });
    const [row] = await t.db.select().from(admins).where(eq(admins.id, target.id));
    expect(row).toMatchObject({ status: 'disabled', role: 'operations' });
    await request(t.http).get('/v1/admin/me').set(target.headers).expect(401);
  });

  it('gives each role only its own work', async () => {
    const [verification, safety, disputes] = await Promise.all([
      adminAs(t, 'verification'),
      adminAs(t, 'safety'),
      adminAs(t, 'disputes'),
    ]);
    const person = await signIn(t, 'agent');
    const post = (who: Admin, path: string, body: object) =>
      request(t.http).post(`/v1/admin/people/${person.userId}${path}`).set(who.headers).send(body);
    // Verification decides checks but suspends nobody; safety suspends but sets no tiers; disputes neither.
    expect((await post(verification, '/suspend', { note: 'Testing the role' })).status).toBe(403);
    expect((await post(safety, '/tier', { tier: 'gold', note: 'Testing the role' })).status).toBe(403);
    expect((await post(disputes, '/suspend', { note: 'Testing the role' })).status).toBe(403);
    expect((await post(safety, '/application', { decision: 'approve', note: 'Testing the role' })).status).toBe(403);
    expect((await credit(verification)).status).toBe(403);
  });
});
