import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentProfiles, earningHolds } from '../src/db/schema';
import { LedgerService } from '../src/money/ledger.service';
import { act, balanceOf, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

describe('agent profile', () => {
  let t: TestApp;
  let customer: Person;

  beforeAll(async () => {
    t = await createTestApp();
    customer = await signIn(t, 'customer');
    await fund(t, customer, 20_000_000);
  });
  afterAll(() => t.close());

  const board = (agent: Person) =>
    request(t.http).get('/v1/errands/board?lat=6.4480&lng=3.4700&radiusKm=5').set(agent.headers).expect(200);
  const ids = (res: { body: Array<{ id: string }> }) => res.body.map((e) => e.id);
  const setTier = (agent: Person, tier: 'bronze' | 'silver' | 'gold' | 'platinum') =>
    t.db
      .insert(agentProfiles)
      .values({ userId: agent.userId, tier, tierSetAt: new Date() })
      .onConflictDoUpdate({ target: agentProfiles.userId, set: { tier, tierSetAt: new Date() } });

  it('starts every agent on Bronze, receiving every category', async () => {
    const agent = await signIn(t, 'agent');
    const res = await request(t.http).get('/v1/agent/profile').set(agent.headers).expect(200);
    expect(res.body).toEqual({ tier: 'bronze', categoryKeys: null, takesPurchases: true });
    await request(t.http).get('/v1/agent/profile').set(customer.headers).expect(403);
  });

  it('lets the agent choose categories and purchase errands, but not their tier', async () => {
    const agent = await signIn(t, 'agent');
    const parcel = await createErrand(t, customer);
    const groceries = await createErrand(t, customer, { categoryKey: 'groceries' });
    const foodNoBuy = await createErrand(t, customer, { categoryKey: 'food', buy: false });
    expect(ids(await board(agent))).toEqual(expect.arrayContaining([parcel.id, groceries.id, foodNoBuy.id]));

    const updated = await request(t.http)
      .patch('/v1/agent/profile')
      .set(agent.headers)
      .send({ categoryKeys: ['parcel', 'food', 'parcel'], takesPurchases: false })
      .expect(200);
    expect(updated.body).toEqual({ tier: 'bronze', categoryKeys: ['parcel', 'food'], takesPurchases: false });
    const shown = ids(await board(agent));
    expect(shown).toContain(parcel.id);
    expect(shown).toContain(foodNoBuy.id);
    expect(shown).not.toContain(groceries.id);

    await request(t.http).patch('/v1/agent/profile').set(agent.headers).send({ categoryKeys: null }).expect(200);
    expect(ids(await board(agent))).not.toContain(groceries.id); // still no purchase errands

    const bad = await request(t.http)
      .patch('/v1/agent/profile')
      .set(agent.headers)
      .send({ categoryKeys: ['rockets'] })
      .expect(422);
    expect(bad.body.error).toMatchObject({ code: 'category_not_available', unknown: ['rockets'] });
    await request(t.http).patch('/v1/agent/profile').set(agent.headers).send({ categoryKeys: [] }).expect(400);
    await request(t.http).patch('/v1/agent/profile').set(agent.headers).send({ tier: 'platinum' }).expect(400);
  });

  it('pays a Silver agent at the Silver rate, with earnings available at once', async () => {
    const agent = await signIn(t, 'agent');
    await setTier(agent, 'silver');
    expect((await request(t.http).get('/v1/agent/profile').set(agent.headers).expect(200)).body.tier).toBe('silver');

    const revenue = () => t.app.get(LedgerService).balance(t.db, { type: 'platform_revenue' }, 'NG');
    const before = await revenue();
    const errand = await createErrand(t, customer); // fee 250,000; service fee 25,000
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'mark_delivered');
    const pin = (await request(t.http).get(`/v1/errands/${errand.id}/pin`).set(customer.headers).expect(200)).body.pin;
    await act(t, agent, errand.id, 'confirm_pin', { pin });

    // Silver commission is 12.5%: 31,250 on 250,000.
    expect((await revenue()) - before).toBe(25_000 + 31_250);
    expect(await balanceOf(t, agent)).toMatchObject({ tier: 'silver', availableKobo: 250_000 - 31_250, heldKobo: 0 });
    expect(await t.db.select().from(earningHolds).where(eq(earningHolds.userId, agent.userId))).toHaveLength(0);
  });
});
