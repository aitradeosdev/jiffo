import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CountriesService } from '../src/countries/countries.service';
import { adminAs, createTestApp, fund, signIn, type TestApp } from './helpers';

type Admin = Awaited<ReturnType<typeof adminAs>>;
interface StaffAlert {
  id: string;
  kind: string;
  message: string;
  data: { adminId?: string; count?: number };
  resolvedAt: string | null;
}

/**
 * Alerts about staff (docs/security-plan.md, D8): unusual ID reveals, adjustments to an account linked to
 * a staff member, and money actions out of hours. Owners see them; finance's alerts don't include them.
 */
describe('alerts about staff', () => {
  let t: TestApp;
  let owner: Admin;
  let finance: Admin;
  beforeAll(async () => {
    t = await createTestApp();
    [owner, finance] = await Promise.all([adminAs(t, 'owner'), adminAs(t, 'finance')]);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** Settings, Security as a test needs them, over what is saved. */
  const security = (over: Record<string, unknown>) => {
    const countries = t.app.get(CountriesService);
    const real = countries.currentSettingsIfAny.bind(countries);
    vi.spyOn(countries, 'currentSettingsIfAny').mockImplementation(async (code) => {
      const saved = await real(code);
      return saved && { ...saved, settings: { ...saved.settings, security: { ...saved.settings.security, ...over } } };
    });
  };
  /** Working hours that leave out the hour it is now in Lagos, so whatever happens now is out of hours. */
  const outOfHoursNow = () => {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', hour: '2-digit', hourCycle: 'h23' }).format(),
    );
    return hour < 12 ? { staffHoursStart: 13, staffHoursEnd: 20 } : { staffHoursStart: 1, staffHoursEnd: 11 };
  };
  const allDay = { staffHoursStart: 0, staffHoursEnd: 24 };
  const staffAlerts = async (who: Admin = owner) =>
    (await request(t.http).get('/v1/admin/staff-alerts?country=NG').set(who.headers).expect(200)).body
      .alerts as StaffAlert[];
  const about = async (admin: Admin, kind: string) =>
    (await staffAlerts()).filter((a) => a.kind === kind && a.data.adminId === admin.id);
  /** An adjustment one admin asks for and another approves, as finance makes them. */
  const adjust = async (who: Admin, personId: string) => {
    const asked = await request(t.http).post('/v1/admin/money/adjustments').set(who.headers).send({
      requestId: randomUUID(),
      note: 'Goodwill for a late delivery',
      personId,
      account: 'customer_wallet',
      direction: 'credit',
      amountKobo: 10_000,
    });
    expect(asked.status).toBe(202);
    await request(t.http)
      .post(`/v1/admin/approvals/${asked.body.approval.id}/approve`)
      .set(owner.headers)
      .send({})
      .expect(200);
  };
  const reveal = async (who: Admin) => {
    const person = await signIn(t, 'customer');
    return request(t.http)
      .post(`/v1/admin/people/${person.userId}/reveal`)
      .set(who.headers)
      .send({ note: 'Checking the ID against the selfie' });
  };

  it('raises one for a staff member revealing many people in a day, and at the limit', async () => {
    security({ ...allDay, idRevealAlertAt: 2, dailyIdReveals: 3 });
    const verification = await adminAs(t, 'verification');
    await reveal(verification).then((r) => expect(r.status).toBe(200));
    expect(await about(verification, 'unusual_id_reveals')).toEqual([]);
    await reveal(verification).then((r) => expect(r.status).toBe(200));
    const [raised] = await about(verification, 'unusual_id_reveals');
    expect(raised).toMatchObject({ data: { count: 2 }, resolvedAt: null });
    await reveal(verification).then((r) => expect(r.status).toBe(200));
    // Refused at the limit: still one alert, saying so.
    await reveal(verification).then((r) => expect(r.status).toBe(429));
    const after = await about(verification, 'unusual_id_reveals');
    expect(after).toHaveLength(1);
    expect(after[0]!.message).toMatch(/limit/);
  });

  it('raises one for an ID reveal out of hours', async () => {
    security({ ...outOfHoursNow(), idRevealAlertAt: 50 });
    const verification = await adminAs(t, 'verification');
    await reveal(verification).then((r) => expect(r.status).toBe(200));
    expect(await about(verification, 'unusual_id_reveals')).toHaveLength(1);
  });

  it('raises one for an adjustment to an app account linked to a staff member', async () => {
    security(allDay);
    const customer = await signIn(t, 'customer');
    await fund(t, customer, 100_000);
    // Someone on the team uses Jiffo with this phone.
    const teammate = await adminAs(t, 'support', { phone: customer.phone });
    await adjust(finance, customer.userId);
    const raised = (await staffAlerts()).filter((a) => a.kind === 'staff_account_adjustment');
    expect(raised.some((a) => a.message.includes(teammate.name))).toBe(true);
    // An ordinary customer's adjustment raises none.
    const other = await signIn(t, 'customer');
    const before = (await staffAlerts()).filter((a) => a.kind === 'staff_account_adjustment').length;
    await adjust(finance, other.userId);
    expect((await staffAlerts()).filter((a) => a.kind === 'staff_account_adjustment').length).toBe(before);
  });

  it('raises one for money actions out of hours, one a day for each staff member, counting them', async () => {
    security(outOfHoursNow());
    const asker = await adminAs(t, 'finance');
    const a = await signIn(t, 'customer');
    const b = await signIn(t, 'customer');
    await adjust(asker, a.userId);
    await adjust(asker, b.userId);
    const [raised] = await about(asker, 'out_of_hours_money');
    expect(raised!.data.count).toBeGreaterThanOrEqual(2);
    expect((await about(asker, 'out_of_hours_money')).length).toBe(1);
  });

  it('raises none for money actions in working hours', async () => {
    security(allDay);
    const asker = await adminAs(t, 'finance');
    await adjust(asker, (await signIn(t, 'customer')).userId);
    expect(await about(asker, 'out_of_hours_money')).toEqual([]);
  });

  it('keeps them for owners: not in finance alerts, and nobody closes one about themselves', async () => {
    security({ ...allDay, idRevealAlertAt: 1 });
    const verification = await adminAs(t, 'verification');
    await reveal(verification).then((r) => expect(r.status).toBe(200));
    const [raised] = await about(verification, 'unusual_id_reveals');
    const money = (await request(t.http).get('/v1/admin/alerts?country=NG').set(finance.headers).expect(200)).body;
    expect(JSON.stringify(money)).not.toContain(raised!.id);
    await request(t.http).get('/v1/admin/staff-alerts?country=NG').set(finance.headers).expect(403);
    expect(
      (
        await request(t.http)
          .post(`/v1/admin/alerts/${raised!.id}/resolve`)
          .set(finance.headers)
          .send({ note: 'Clearing the list' })
      ).status,
    ).toBe(409);
    await request(t.http)
      .post(`/v1/admin/staff-alerts/${raised!.id}/resolve`)
      .set(owner.headers)
      .send({ note: 'Asked them: a batch of agent applications' })
      .expect(200);
    expect((await about(verification, 'unusual_id_reveals'))[0]?.resolvedAt).toEqual(expect.any(String));
  });

  it("doesn't let an owner close one about themselves", async () => {
    security({ ...allDay, idRevealAlertAt: 1 });
    const own = await adminAs(t, 'owner');
    await reveal(own).then((r) => expect(r.status).toBe(200));
    const [raised] = await about(own, 'unusual_id_reveals');
    const res = await request(t.http)
      .post(`/v1/admin/staff-alerts/${raised!.id}/resolve`)
      .set(own.headers)
      .send({ note: 'It was me, all fine' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('own_alert');
  });
});
