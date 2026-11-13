import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentProfiles, categories, earningHolds } from '../src/db/schema';
import { and } from 'drizzle-orm';
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
  const ids = (res: { body: { errands: Array<{ id: string }> } }) => res.body.errands.map((e) => e.id);
  const setTier = (agent: Person, tier: 'bronze' | 'silver' | 'gold' | 'platinum') =>
    t.db
      .insert(agentProfiles)
      .values({ userId: agent.userId, tier, tierSetAt: new Date() })
      .onConflictDoUpdate({ target: agentProfiles.userId, set: { tier, tierSetAt: new Date() } });

  it('starts every agent on Bronze, receiving every category', async () => {
    const agent = await signIn(t, 'agent');
    const res = await request(t.http).get('/v1/agent/profile').set(agent.headers).expect(200);
    expect(res.body).toEqual({ tier: 'bronze', categoryKeys: null, takesPurchases: true });
    // Reading the profile writes nothing.
    expect(await t.db.select().from(agentProfiles).where(eq(agentProfiles.userId, agent.userId))).toHaveLength(0);
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
    const filtered = await board(agent);
    const shown = ids(filtered);
    expect(shown).toContain(parcel.id);
    expect(shown).toContain(foodNoBuy.id);
    expect(shown).not.toContain(groceries.id);
    // The board says how many nearby errands the preferences leave out.
    expect(filtered.body.hiddenByPreferences).toBeGreaterThanOrEqual(1);
    // Each errand shows what this agent keeps after commission: Bronze pays 15% of ₦2,500.
    expect(filtered.body.errands.find((e: { id: string }) => e.id === parcel.id).agentEarnsKobo).toBe(212_500);

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

  it('falls back to every category when all the chosen ones are switched off', async () => {
    const agent = await signIn(t, 'agent');
    await request(t.http)
      .patch('/v1/agent/profile')
      .set(agent.headers)
      .send({ categoryKeys: ['laundry'] })
      .expect(200);
    const parcel = await createErrand(t, customer);
    expect(ids(await board(agent))).not.toContain(parcel.id);
    const laundry = and(eq(categories.countryCode, 'NG'), eq(categories.key, 'laundry'));
    await t.db.update(categories).set({ active: false }).where(laundry);
    try {
      expect(
        (await request(t.http).get('/v1/agent/profile').set(agent.headers).expect(200)).body.categoryKeys,
      ).toBeNull();
      expect(ids(await board(agent))).toContain(parcel.id);
    } finally {
      await t.db.update(categories).set({ active: true }).where(laundry);
    }
  });

  it('refuses a tier that does not exist, even from direct SQL', async () => {
    const agent = await signIn(t, 'agent');
    await expect(
      t.db.insert(agentProfiles).values({ userId: agent.userId, tier: 'Silver' as 'silver' }),
    ).rejects.toThrow(/agent_profiles_tier_ck/);
  });

  it('keeps the tier the agent had when they accepted, whatever admin changes later', async () => {
    const agent = await signIn(t, 'agent');
    await setTier(agent, 'silver');
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await setTier(agent, 'bronze');
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'mark_delivered');
    const pin = (await request(t.http).get(`/v1/errands/${errand.id}/pin`).set(customer.headers).expect(200)).body.pin;
    await act(t, agent, errand.id, 'confirm_pin', { pin });
    // Silver terms: 12.5% commission and no hold, though the agent is Bronze now.
    expect(await balanceOf(t, agent)).toMatchObject({ tier: 'bronze', availableKobo: 250_000 - 31_250, heldKobo: 0 });
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
