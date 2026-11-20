import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  it("works with no errand and no location, but not with someone else's errand", async () => {
    const lone = await signIn(t, 'customer');
    await press(lone, {}).expect(201);
    const { errand } = await onErrand();
    const res = await press(await signIn(t, 'customer'), { errandId: errand.id });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('errand_not_found');
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
