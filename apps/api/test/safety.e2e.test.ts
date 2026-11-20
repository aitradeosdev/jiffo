import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AlertsService } from '../src/alerts/alerts.service';
import { adminAudit, alerts, safetyEvents } from '../src/db/schema';
import { act, adminAs, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

interface Emergency {
  id: string;
  status: 'open' | 'handled';
  app: 'customer' | 'agent';
  person: { id: string };
  errand: { id: string } | null;
  lat: number | null;
  lng: number | null;
  positions: Array<{ lat: number; lng: number; at: string }>;
  note: string | null;
}

/**
 * The emergency button (docs/security-plan.md, E9): the app dials the country's emergency number and tells
 * Jiffo where the person is, which goes to the Safety queue for the safety team.
 */
describe('emergencies', () => {
  let t: TestApp;
  let safety: Awaited<ReturnType<typeof adminAs>>;
  beforeAll(async () => {
    t = await createTestApp();
    safety = await adminAs(t, 'safety');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  const press = (who: Person, body: Record<string, unknown>) =>
    request(t.http).post('/v1/safety/emergencies').set(who.headers).send(body);
  const queue = async (status = 'open', who = safety) =>
    (await request(t.http).get(`/v1/admin/safety?country=NG&status=${status}`).set(who.headers).expect(200)).body
      .emergencies as Emergency[];
  const onErrand = async () => {
    const customer = await signIn(t, 'customer');
    const agent = await signIn(t, 'agent');
    await fund(t, customer);
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    return { customer, agent, errand };
  };

  it('tells the apps the number to dial', async () => {
    const config = (await request(t.http).get('/v1/config/NG').expect(200)).body;
    expect(config.settings.safety).toEqual({ emergencyNumber: '112' });
  });

  it('puts a press, with where the person is and their errand, in the Safety queue, and raises an alert', async () => {
    const { agent, errand } = await onErrand();
    const res = await press(agent, { errandId: errand.id, lat: 6.45, lng: 3.47, accuracy: 12 }).expect(201);
    expect(res.body).toEqual({ id: expect.any(String), emergencyNumber: '112' });
    const [found] = (await queue()).filter((e) => e.id === res.body.id);
    expect(found).toMatchObject({
      status: 'open',
      app: 'agent',
      person: { id: agent.userId },
      errand: { id: errand.id },
      lat: 6.45,
      lng: 3.47,
    });
    const raised = await t.db
      .select()
      .from(alerts)
      .where(and(eq(alerts.kind, 'emergency'), eq(alerts.dedupeKey, res.body.id)));
    expect(raised).toHaveLength(1);
  });

  it('keeps one event for presses close together, and follows where the person goes', async () => {
    const customer = await signIn(t, 'customer');
    const first = await press(customer, {}).expect(201);
    const again = await press(customer, { lat: 6.5, lng: 3.4 }).expect(201);
    expect(again.body.id).toBe(first.body.id);
    await request(t.http)
      .post(`/v1/safety/emergencies/${first.body.id}/positions`)
      .set(customer.headers)
      .send({ lat: 6.51, lng: 3.41, accuracy: 9 })
      .expect(204);
    const [found] = (await queue()).filter((e) => e.id === first.body.id);
    expect(found!.positions.map((p) => [p.lat, p.lng])).toEqual([
      [6.5, 3.4],
      [6.51, 3.41],
    ]);
    // Nobody else adds to it.
    const other = await signIn(t, 'customer');
    await request(t.http)
      .post(`/v1/safety/emergencies/${first.body.id}/positions`)
      .set(other.headers)
      .send({ lat: 1, lng: 1 })
      .expect(404);
  });

  it("is never refused: no errand, no location, or an errand that isn't theirs (kept without it)", async () => {
    const lone = await signIn(t, 'customer');
    await press(lone, {}).expect(201);
    const { errand } = await onErrand();
    const stranger = await signIn(t, 'customer');
    const res = await press(stranger, { errandId: errand.id }).expect(201);
    const [found] = (await queue()).filter((e) => e.id === res.body.id);
    expect(found).toMatchObject({ person: { id: stranger.userId }, errand: null });
  });

  it('keeps a double tap as one emergency, and adds the errand a later press names', async () => {
    const { customer, errand } = await onErrand();
    const [a, b] = await Promise.all([press(customer, {}), press(customer, {})]);
    expect(a.body.id).toBe(b.body.id);
    const later = await press(customer, { errandId: errand.id }).expect(201);
    expect(later.body.id).toBe(a.body.id);
    const mine = (await queue()).filter((e) => e.person.id === customer.userId);
    expect(mine).toEqual([
      expect.objectContaining({
        errand: { id: errand.id, status: expect.any(String), description: expect.any(String) },
      }),
    ]);
    const raised = await t.db.execute(sql`select 1 from alerts where kind = 'emergency' and dedupe_key = ${a.body.id}`);
    expect(raised.rows).toHaveLength(1);
  });

  it('follows the person for half an hour from their latest press', async () => {
    const customer = await signIn(t, 'customer');
    const { body } = await press(customer, {}).expect(201);
    const ago = (minutes: number) => sql`now() - make_interval(mins => ${minutes})`;
    await t.db
      .update(safetyEvents)
      .set({ createdAt: ago(28), lastPressedAt: ago(28) })
      .where(eq(safetyEvents.id, body.id));
    expect((await press(customer, {}).expect(201)).body.id).toBe(body.id);
    // Forty-five minutes after the first press, but just after the second.
    await t.db
      .update(safetyEvents)
      .set({ createdAt: ago(45) })
      .where(eq(safetyEvents.id, body.id));
    await request(t.http)
      .post(`/v1/safety/emergencies/${body.id}/positions`)
      .set(customer.headers)
      .send({ lat: 6.5, lng: 3.4 })
      .expect(204);
  });

  it("keeps emergencies' alerts out of the money pages", async () => {
    const customer = await signIn(t, 'customer');
    const { body } = await press(customer, {}).expect(201);
    const finance = await adminAs(t, 'finance');
    const listed = (await request(t.http).get('/v1/admin/alerts?country=NG').set(finance.headers).expect(200)).body;
    const all = JSON.stringify(listed);
    expect(all).not.toContain(body.id);
    const [alert] = (
      await t.db.execute<{ id: string }>(
        sql`select id from alerts where kind = 'emergency' and dedupe_key = ${body.id}`,
      )
    ).rows;
    const resolve = await request(t.http)
      .post(`/v1/admin/alerts/${alert!.id}/resolve`)
      .set(finance.headers)
      .send({ note: 'Clearing the list' });
    expect(resolve.status).toBe(409);
  });

  it("is handled even when its alert can't be settled", async () => {
    const customer = await signIn(t, 'customer');
    const { body } = await press(customer, {}).expect(201);
    vi.spyOn(t.app.get(AlertsService), 'settle').mockRejectedValueOnce(new Error('database away'));
    await request(t.http)
      .post(`/v1/admin/safety/${body.id}/handle`)
      .set(safety.headers)
      .send({ note: 'Called back, all safe' })
      .expect(200);
  });

  it('is handled by the safety team, with a reason in the audit log, once', async () => {
    const customer = await signIn(t, 'customer');
    const { body } = await press(customer, { lat: 6.45, lng: 3.47 }).expect(201);
    const support = await adminAs(t, 'support');
    expect((await queue('open', support)).some((e) => e.id === body.id)).toBe(true);
    const handle = (who: { headers: Record<string, string> }, note = 'Called the customer back, all safe') =>
      request(t.http).post(`/v1/admin/safety/${body.id}/handle`).set(who.headers).send({ note });
    expect((await handle(support)).status).toBe(403);
    await handle(safety).expect(200);
    expect((await handle(safety)).body.error.code).toBe('already_handled');
    const [found] = (await queue('handled')).filter((e) => e.id === body.id);
    expect(found).toMatchObject({ status: 'handled', note: 'Called the customer back, all safe' });
    const audit = await t.db
      .select()
      .from(adminAudit)
      .where(and(eq(adminAudit.action, 'safety.handle'), eq(adminAudit.targetId, body.id)));
    expect(audit).toHaveLength(1);
    // The alert is settled with it.
    const open = await t.db.execute(
      sql`select 1 from alerts where kind = 'emergency' and dedupe_key = ${body.id} and resolved_at is null`,
    );
    expect(open.rows).toEqual([]);
    expect((await t.db.select().from(safetyEvents).where(eq(safetyEvents.id, body.id)))[0]?.handledBy).toBe(safety.id);
  });
});
