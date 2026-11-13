import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentProfiles } from '../src/db/schema';
import { act, adminAs, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

type Admin = Awaited<ReturnType<typeof adminAs>>;

describe('admin people', () => {
  let t: TestApp;
  let ops: Admin;
  let support: Admin;
  let owner: Admin;

  beforeAll(async () => {
    t = await createTestApp();
    ops = await adminAs(t, 'operations');
    support = await adminAs(t, 'support');
    owner = await adminAs(t, 'owner');
  });
  afterAll(() => t.close());

  const list = (q: string, who: Admin = support) =>
    request(t.http).get(`/v1/admin/people?country=NG&${q}`).set(who.headers).expect(200);
  const detail = async (id: string) =>
    (await request(t.http).get(`/v1/admin/people/${id}`).set(support.headers).expect(200)).body;
  const post = (id: string, what: string, body: Record<string, unknown>, who: Admin = ops) =>
    request(t.http).post(`/v1/admin/people/${id}/${what}`).set(who.headers).send(body);

  it('lists customers and agents apart, and finds them by name or phone', async () => {
    const customer = await signIn(t, 'customer', { firstName: 'Ngozi' });
    const agent = await signIn(t, 'agent', { firstName: 'Bayo' });
    const ids = (res: { body: { people: Array<{ id: string }> } }) => res.body.people.map((p) => p.id);

    expect(ids(await list('role=customer'))).toContain(customer.userId);
    expect(ids(await list('role=customer'))).not.toContain(agent.userId);
    const agents = await list('role=agent');
    expect(ids(agents)).toContain(agent.userId);
    expect(agents.body.people.find((p: { id: string }) => p.id === agent.userId)).toMatchObject({
      tier: 'bronze',
      online: false,
      errands: 0,
      rating: null,
      balanceKobo: 0,
    });
    // The numbers are the person's own: a funded customer with an errand, and an agent who finished one.
    await fund(t, customer, 2_000_000);
    const done = await createErrand(t, customer);
    await act(t, agent, done.id, 'accept');
    await act(t, agent, done.id, 'start');
    await act(t, agent, done.id, 'mark_delivered');
    const pin = (await request(t.http).get(`/v1/errands/${done.id}/pin`).set(customer.headers).expect(200)).body.pin;
    await act(t, agent, done.id, 'confirm_pin', { pin });
    await request(t.http).post(`/v1/errands/${done.id}/rating`).set(customer.headers).send({ stars: 4 }).expect(201);
    const row = (res: { body: { people: Array<{ id: string }> } }, id: string) =>
      res.body.people.find((p) => p.id === id);
    expect(row(await list('role=agent'), agent.userId)).toMatchObject({ errands: 1, rating: 4 });
    expect(
      (row(await list('role=agent'), agent.userId) as unknown as { balanceKobo: number }).balanceKobo,
    ).toBeGreaterThan(0);
    expect(row(await list('role=customer'), customer.userId)).toMatchObject({ errands: 1 });
    expect(
      (row(await list('role=customer'), customer.userId) as unknown as { balanceKobo: number }).balanceKobo,
    ).toBeLessThan(2_000_000);
    expect(ids(await list(`role=customer&q=Ngozi`))).toContain(customer.userId);
    expect(ids(await list(`role=customer&q=0${customer.phone.slice(4)}`))).toEqual([customer.userId]);
    await request(t.http).get('/v1/admin/people?country=NG').set(customer.headers).expect(401);
  });

  it("shows a person's activity, money and devices", async () => {
    const customer = await signIn(t, 'customer');
    await fund(t, customer, 1_000_000);
    const errand = await createErrand(t, customer);
    const d = await detail(customer.userId);
    expect(d.person).toMatchObject({ id: customer.userId, phone: customer.phone, status: 'active' });
    expect(d.apps).toEqual(['customer']);
    expect(d.agent).toBeNull();
    expect(d.customer).toMatchObject({ walletKobo: 1_000_000, stats: { total: 1, completed: 0 } });
    expect(d.errands.map((e: { id: string }) => e.id)).toEqual([errand.id]);
    expect(d.money[0]).toMatchObject({ kind: 'deposit', amountKobo: 1_000_000 });
    expect(d.devices[0]).toMatchObject({ app: 'customer', platform: 'android', activeSessions: 1 });
    expect(d.devices[0].pushToken).toBeUndefined();
    await request(t.http).get('/v1/admin/people/not-a-uuid').set(support.headers).expect(404);
  });

  it("sets an agent's tier, which only operations and owners can do", async () => {
    const agent = await signIn(t, 'agent');
    const customer = await signIn(t, 'customer');
    expect((await post(agent.userId, 'tier', { tier: 'gold', note: 'Great ratings' }, support)).status).toBe(403);
    expect((await post(agent.userId, 'tier', { tier: 'gold', note: 'ok' })).status).toBe(400);
    expect((await post(customer.userId, 'tier', { tier: 'gold', note: 'Great ratings' })).status).toBe(404);
    await post(agent.userId, 'tier', { tier: 'gold', note: '50 errands, 4.9 stars' }).expect(200);
    // The tier they already have changes nothing and records nothing.
    expect((await post(agent.userId, 'tier', { tier: 'gold', note: 'Clicked twice by mistake' })).body).toEqual({
      tier: 'gold',
      changed: false,
    });

    const [row] = await t.db.select().from(agentProfiles).where(eq(agentProfiles.userId, agent.userId));
    expect(row).toMatchObject({ tier: 'gold', tierSetBy: ops.id });
    expect((await request(t.http).get('/v1/agent/profile').set(agent.headers).expect(200)).body.tier).toBe('gold');
    const d = await detail(agent.userId);
    expect(d.agent).toMatchObject({ tier: 'gold', tierSetBy: ops.name });
    // What each tier means, from the country's current settings.
    expect(d.agent.tiers.map((x: { tier: string }) => x.tier)).toEqual(['bronze', 'silver', 'gold', 'platinum']);
    expect(d.agent.tiers[0]).toMatchObject({ tier: 'bronze', holdHours: 24 });
    expect(d.agent.tiers[1]).toMatchObject({ tier: 'silver', holdHours: 0 });

    const audit = await request(t.http)
      .get(`/v1/admin/audit?targetType=person&targetId=${agent.userId}`)
      .set(owner.headers)
      .expect(200);
    expect(audit.body.entries[0]).toMatchObject({
      action: 'agent.tier',
      data: { from: 'bronze', to: 'gold', note: '50 errands, 4.9 stars' },
      targetLabel: 'Tunde',
    });
  });

  it('suspends only between errands, closing ones still waiting, and reactivates', async () => {
    const customer: Person = await signIn(t, 'customer');
    const agent: Person = await signIn(t, 'agent');
    await fund(t, customer, 5_000_000);
    const busy = await createErrand(t, customer);
    await act(t, agent, busy.id, 'accept');

    const refused = await post(agent.userId, 'suspend', { note: 'Reported for rudeness' });
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatchObject({ code: 'has_live_errands', errandIds: [busy.id] });
    expect((await post(customer.userId, 'suspend', { note: 'Chargeback fraud' })).status).toBe(409);

    // Once the busy errand is over, the customer can be suspended; their waiting errand closes.
    await act(t, customer, busy.id, 'cancel', { reason: 'Changed my mind' });
    const waiting = await createErrand(t, customer);
    const res = await post(customer.userId, 'suspend', { note: 'Chargeback fraud' });
    expect(res.status).toBe(200);
    expect(res.body.closedErrands).toEqual([waiting.id]);
    const [{ body: errandNow }] = await Promise.all([
      request(t.http).get(`/v1/admin/errands/${waiting.id}`).set(support.headers).expect(200),
    ]);
    // Cancelled by support, in the suspension's own transaction, with the reason on the timeline.
    expect(errandNow.errand.status).toBe('cancelled');
    expect(errandNow.events.at(-1)).toMatchObject({ event: 'admin_cancel', actorRole: 'admin', actorName: ops.name });
    // Their sessions ended.
    await request(t.http).get('/v1/me').set(customer.headers).expect(401);
    expect((await detail(customer.userId)).person.status).toBe('suspended');
    expect((await post(customer.userId, 'suspend', { note: 'Chargeback fraud' })).status).toBe(409);

    await post(customer.userId, 'reactivate', { note: 'Bank confirmed it was a mistake' }).expect(200);
    expect((await detail(customer.userId)).person.status).toBe('active');
    const audit = await request(t.http)
      .get(`/v1/admin/audit?targetType=person&targetId=${customer.userId}`)
      .set(owner.headers)
      .expect(200);
    expect(audit.body.entries.map((e: { action: string }) => e.action)).toEqual([
      'person.reactivate',
      'person.suspend',
    ]);
  });
});
