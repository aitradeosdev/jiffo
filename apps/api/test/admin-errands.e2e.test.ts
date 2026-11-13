import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAudit } from '../src/db/schema';
import { WalletService } from '../src/money/wallet.service';
import {
  act,
  adminAs,
  balanceOf,
  createErrand,
  createTestApp,
  fund,
  photo,
  signIn,
  type Person,
  type TestApp,
} from './helpers';

type Admin = Awaited<ReturnType<typeof adminAs>>;

describe('admin errands and disputes', () => {
  let t: TestApp;
  let customer: Person;
  let agent: Person;
  let ops: Admin;
  let support: Admin;

  beforeAll(async () => {
    t = await createTestApp();
    customer = await signIn(t, 'customer');
    agent = await signIn(t, 'agent');
    await fund(t, customer, 20_000_000);
    ops = await adminAs(t, 'operations');
    support = await adminAs(t, 'support');
  });
  afterAll(() => t.close());

  const detail = async (id: string, who: Admin = ops) =>
    (await request(t.http).get(`/v1/admin/errands/${id}`).set(who.headers).expect(200)).body;
  const settle = (id: string, body: Record<string, unknown>, who: Admin = ops) =>
    request(t.http).post(`/v1/admin/errands/${id}/actions`).set(who.headers).send(body);
  const trialBalance = () => t.app.get(WalletService).trialBalance();

  /** An errand the customer disputed after the agent started it. */
  async function disputed(overrides: Record<string, unknown> = {}) {
    const errand = await createErrand(t, customer, overrides);
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    await act(t, customer, errand.id, 'open_dispute', { reason: 'The agent went to the wrong shop' });
    return errand;
  }

  it('lists, filters and searches errands', async () => {
    await createErrand(t, customer);
    const mine = await createErrand(t, customer, { description: 'Collect my tailored agbada from Yaba' });
    const list = async (q: string) => {
      const r = await request(t.http).get(`/v1/admin/errands?country=NG&${q}`).set(support.headers);
      if (r.status !== 200) throw new Error(`${q}: ${JSON.stringify(r.body)}`);
      return r;
    };

    const all = await list('filter=waiting');
    expect(all.body.errands.map((e: { id: string }) => e.id)).toContain(mine.id);
    expect(all.body.errands[0]).toMatchObject({ customer: { phone: customer.phone }, agent: null });

    for (const q of ['agbada', mine.id.slice(0, 8), customer.phone.slice(-7), `0${customer.phone.slice(4)}`]) {
      const found = await list(`q=${encodeURIComponent(q)}`);
      expect(
        found.body.errands.map((e: { id: string }) => e.id),
        q,
      ).toContain(mine.id);
    }
    expect((await list('q=nothing-matches-this')).body.errands).toEqual([]);

    // Pages follow on without repeating or skipping.
    const first = await list('limit=1');
    expect(first.body.next).toBeTruthy();
    const second = await list(`limit=1&before=${encodeURIComponent(first.body.next)}`);
    expect(second.body.errands[0].id).not.toBe(first.body.errands[0].id);
    await request(t.http).get('/v1/admin/errands?country=NG&before=junk').set(support.headers).expect(400);
    // App sessions are not admin sessions.
    await request(t.http).get('/v1/admin/errands?country=NG').set(customer.headers).expect(401);
  });

  it('shows one errand in full, without its PIN', async () => {
    const errand = await createErrand(t, customer, { categoryKey: 'groceries' });
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'send_item_amount', {
      amountKobo: 400_000,
      photos: [await photo(t, agent, errand.id, 'receipt')],
    });
    const d = await detail(errand.id, support);
    expect(d.errand).toMatchObject({ id: errand.id, status: 'item_pending' });
    expect(d.errand.pinCipher).toBeUndefined();
    expect(d.customer.phone).toBe(customer.phone);
    expect(d.agent).toMatchObject({ phone: agent.phone, tier: 'bronze' });
    expect(d.events.map((e: { event: string }) => e.event)).toEqual(['create', 'accept', 'start', 'send_item_amount']);
    expect(d.photos).toEqual([expect.objectContaining({ purpose: 'receipt', from: 'agent' })]);
    expect(d.chat.some((m: { body: string }) => m.body.startsWith('Item amount sent'))).toBe(true);
    expect(d.money.heldFeeKobo).toBe(d.errand.feeKobo + d.errand.serviceFeeKobo);
    expect(d.money.journal.map((j: { kind: string }) => j.kind)).toEqual(['fee_lock']);
    expect(d.actions).toEqual(['admin_intervene']);
    await request(t.http).get('/v1/admin/errands/not-a-uuid').set(support.headers).expect(404);
  });

  it('queues disputes, oldest first, with who opened them and why', async () => {
    const errand = await disputed();
    const res = await request(t.http).get('/v1/admin/disputes?country=NG').set(support.headers).expect(200);
    const row = res.body.disputes.find((d: { id: string }) => d.id === errand.id);
    expect(row).toMatchObject({
      openedBy: 'customer',
      cause: 'open_dispute',
      reason: 'The agent went to the wrong shop',
    });
    expect(row.since).toBeTruthy();
  });

  it('settles a dispute as complete, paying the agent as at a hand-off', async () => {
    const errand = await disputed();
    const before = await balanceOf(t, agent);
    const d = await detail(errand.id);
    expect(d.actions).toEqual(['resolve_complete', 'resolve_cancel']);

    // Support can look but not act, and every action needs a reason.
    expect(
      (
        await settle(
          errand.id,
          { event: 'resolve_complete', version: d.errand.version, note: 'Delivered fine' },
          support,
        )
      ).status,
    ).toBe(403);
    expect((await settle(errand.id, { event: 'resolve_complete', version: d.errand.version, note: 'ok' })).status).toBe(
      400,
    );
    expect(
      (await settle(errand.id, { event: 'resolve_complete', version: d.errand.version - 1, note: 'Delivered fine' }))
        .status,
    ).toBe(409);

    const res = await settle(errand.id, {
      event: 'resolve_complete',
      version: d.errand.version,
      note: 'Photos show the right items were delivered',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');

    const after = await balanceOf(t, agent);
    expect(after.heldKobo - before.heldKobo).toBe(d.money.standard.agentKobo);
    const done = await detail(errand.id);
    expect(done.money.heldFeeKobo).toBe(0);
    const last = done.events.at(-1);
    expect(last).toMatchObject({ event: 'resolve_complete', actorRole: 'admin', actorName: ops.name });
    expect(last.data.note).toBe('Photos show the right items were delivered');
    expect(done.chat.some((m: { body: string }) => m.body === 'Support settled this errand as complete')).toBe(true);
    const audit = await t.db.select().from(adminAudit).where(eq(adminAudit.targetId, errand.id));
    expect(audit).toEqual([
      expect.objectContaining({ adminId: ops.id, action: 'errand.resolve_complete', countryCode: 'NG' }),
    ]);
    expect(await trialBalance()).toBe(0);
  });

  it('settles a dispute as cancelled, returning everything held', async () => {
    const start = (await balanceOf(t, customer)).balanceKobo;
    const errand = await disputed();
    const d = await detail(errand.id);
    expect((await balanceOf(t, customer)).balanceKobo).toBe(start - d.money.heldFeeKobo);
    await settle(errand.id, { event: 'resolve_cancel', version: d.errand.version, note: 'Agent never left' }).expect(
      200,
    );
    expect((await balanceOf(t, customer)).balanceKobo).toBe(start);
    expect(await trialBalance()).toBe(0);
  });

  it('shares out the money by hand, including items the customer never locked', async () => {
    const errand = await createErrand(t, customer, { categoryKey: 'groceries' });
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'send_item_amount', {
      amountKobo: 900_000,
      photos: [await photo(t, agent, errand.id, 'receipt')],
    });
    // The customer never locks it: the timer sends it to a dispute.
    await t.timers.fireAll(errand.id);
    const d = await detail(errand.id);
    expect(d.errand.status).toBe('disputed');
    const res = await request(t.http).get('/v1/admin/disputes?country=NG').set(support.headers).expect(200);
    expect(res.body.disputes.find((x: { id: string }) => x.id === errand.id)).toMatchObject({
      openedBy: 'system',
      cause: 'item_lock_timeout',
    });

    const base = {
      event: 'resolve_complete',
      version: d.errand.version,
      note: 'Customer stopped answering after the receipt',
    };
    const fee = d.money.heldFeeKobo;
    const tooMuch = await settle(errand.id, {
      ...base,
      split: { agentKobo: fee, jiffoKobo: 1, itemsToAgentKobo: 0, chargeCustomerKobo: 0 },
    });
    expect(tooMuch.status).toBe(422);
    const overCharge = await settle(errand.id, {
      ...base,
      split: { agentKobo: 0, jiffoKobo: 0, itemsToAgentKobo: 0, chargeCustomerKobo: 900_001 },
    });
    expect(overCharge.body.error.code).toBe('charge_not_allowed');
    // Only settling shares money out.
    expect((await settle(errand.id, { ...base, event: 'resolve_cancel', split: undefined, version: 0 })).status).toBe(
      409,
    );

    const customerBefore = (await balanceOf(t, customer)).balanceKobo;
    const agentBefore = await balanceOf(t, agent);
    const split = { agentKobo: 150_000, jiffoKobo: 20_000, itemsToAgentKobo: 0, chargeCustomerKobo: 900_000 };
    await settle(errand.id, { ...base, split }).expect(200);

    const refund = fee - split.agentKobo - split.jiffoKobo;
    expect((await balanceOf(t, customer)).balanceKobo - customerBefore).toBe(refund - 900_000);
    const agentAfter = await balanceOf(t, agent);
    expect(agentAfter.availableKobo - agentBefore.availableKobo).toBe(900_000);
    expect(agentAfter.heldKobo - agentBefore.heldKobo).toBe(150_000);
    expect(await trialBalance()).toBe(0);

    const history = await request(t.http).get('/v1/wallet/transactions').set(customer.headers).expect(200);
    expect(history.body.transactions?.[0]?.label ?? history.body[0]?.label).toBe('Settled by Jiffo support');
  });

  it('steps into an errand and arranges a redelivery', async () => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'mark_delivered');
    await act(t, agent, errand.id, 'report_unreachable', { note: 'No answer at the gate' });
    let d = await detail(errand.id);
    expect(d.actions).toEqual(['redeliver', 'admin_intervene']);
    expect(
      (
        await settle(errand.id, {
          event: 'admin_intervene',
          version: d.errand.version,
          note: 'Checking the address',
          split: { agentKobo: 0, jiffoKobo: 0, itemsToAgentKobo: 0, chargeCustomerKobo: 0 },
        })
      ).status,
    ).toBe(400);
    await settle(errand.id, {
      event: 'redeliver',
      version: d.errand.version,
      note: 'Customer called support, home now',
    }).expect(200);
    d = await detail(errand.id);
    expect(d.errand.status).toBe('started');
    await act(t, agent, errand.id, 'mark_delivered');
    await act(t, agent, errand.id, 'report_unreachable', { note: 'Still no answer' });
    d = await detail(errand.id);
    await settle(errand.id, { event: 'admin_intervene', version: d.errand.version, note: 'Looking into it' }).expect(
      200,
    );
    expect((await detail(errand.id)).errand.status).toBe('disputed');
  });
});
