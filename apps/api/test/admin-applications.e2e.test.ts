import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAudit } from '../src/db/schema';
import { adminAs, completeApplication, createTestApp, signIn, uniqueNin, type Person, type TestApp } from './helpers';

describe('admin: agent applications', () => {
  let t: TestApp;
  let ops: Awaited<ReturnType<typeof adminAs>>;
  let support: Awaited<ReturnType<typeof adminAs>>;

  beforeAll(async () => {
    t = await createTestApp();
    ops = await adminAs(t, 'operations');
    support = await adminAs(t, 'support');
  });
  afterAll(() => t.close());

  /** An agent whose selfie the provider couldn't match, so the application waits for support. */
  async function inReview() {
    const agent = await signIn(t, 'agent', { unapproved: true });
    await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName: 'Bakare' }).expect(200);
    const nin = await completeApplication(t, agent, uniqueNin('1111'));
    const sent = await request(t.http).post('/v1/agent/application/submit').set(agent.headers).expect(200);
    expect(sent.body.status).toBe('review');
    return { agent, nin };
  }
  const decide = (agent: Person, body: Record<string, unknown>, as = ops) =>
    request(t.http).post(`/v1/admin/people/${agent.userId}/application`).set(as.headers).send(body);
  const board = (agent: Person) =>
    request(t.http).get('/v1/errands/board?lat=6.4480&lng=3.4700&radiusKm=5').set(agent.headers);

  it('lists applications waiting for review with what was flagged, oldest first', async () => {
    const first = await inReview();
    const second = await inReview();
    const res = await request(t.http)
      .get('/v1/admin/applications?country=NG&status=review&limit=100')
      .set(support.headers)
      .expect(200);
    const ids = res.body.applications.map((a: { id: string }) => a.id);
    expect(ids.indexOf(first.agent.userId)).toBeLessThan(ids.indexOf(second.agent.userId));
    const row = res.body.applications.find((a: { id: string }) => a.id === first.agent.userId);
    expect(row).toMatchObject({ status: 'review', legalName: 'TUNDE BAKARE', stateName: 'Lagos', area: 'Lekki' });
    expect(row.flagged).toEqual([
      expect.objectContaining({ key: 'selfie', outcome: 'review', label: 'Selfie matches the NIN photo' }),
    ]);
    // Found by phone too.
    const found = await request(t.http)
      .get(`/v1/admin/applications?country=NG&status=review&q=${encodeURIComponent(first.agent.phone)}`)
      .set(support.headers)
      .expect(200);
    expect(found.body.applications.map((a: { id: string }) => a.id)).toEqual([first.agent.userId]);
    const counts = await request(t.http).get('/v1/admin/applications/counts?country=NG').set(support.headers);
    expect(counts.body.review).toBeGreaterThanOrEqual(2);
    const overview = await request(t.http).get('/v1/admin/overview?country=NG').set(support.headers).expect(200);
    expect(overview.body.attention.applications).toBeGreaterThanOrEqual(2);
  });

  it('shows the results on the agent page, never the NIN or BVN', async () => {
    const { agent, nin } = await inReview();
    const res = await request(t.http).get(`/v1/admin/people/${agent.userId}`).set(support.headers).expect(200);
    expect(res.body.agent.application).toMatchObject({
      status: 'review',
      legalName: 'TUNDE BAKARE',
      dateOfBirth: '1995-04-12',
      address: '14 Fola Osibo Road, Lekki Phase 1',
      emergency: { name: 'Ngozi Bakare', phone: '+2348034471902', relationship: 'Sibling' },
    });
    expect(res.body.agent.application.checks).toContainEqual(
      expect.objectContaining({ key: 'selfie', outcome: 'review' }),
    );
    expect(JSON.stringify(res.body)).not.toContain(nin);
    expect(JSON.stringify(res.body)).not.toContain('22212345678');
  });

  it('lets operations approve, with a reason in the audit log, and the agent can then work', async () => {
    const { agent } = await inReview();
    await board(agent).expect(403);
    // Support can look but not decide, and a decision needs a reason.
    expect((await decide(agent, { decision: 'approve', note: 'Selfie matches' }, support)).status).toBe(403);
    expect((await decide(agent, { decision: 'approve', note: '' })).status).toBe(400);
    const res = await decide(agent, { decision: 'approve', note: 'Compared the selfie result by hand' }).expect(200);
    expect(res.body.status).toBe('approved');
    await board(agent).expect(200);
    const [entry] = await t.db.select().from(adminAudit).where(eq(adminAudit.targetId, agent.userId));
    expect(entry).toMatchObject({ action: 'application.approve', adminId: ops.id });
    expect(entry!.data).toMatchObject({ note: 'Compared the selfie result by hand', flagged: ['selfie'] });
    // Decided once only.
    expect((await decide(agent, { decision: 'reject', note: 'Changed my mind' })).body.error.code).toBe(
      'not_in_review',
    );
  });

  it('declines with a note the agent sees, and keeps them off the board', async () => {
    const { agent } = await inReview();
    await decide(agent, { decision: 'reject', note: 'The selfie is of a different person' }).expect(200);
    const view = await request(t.http).get('/v1/agent/application').set(agent.headers).expect(200);
    expect(view.body).toMatchObject({ status: 'rejected', decisionNote: 'The selfie is of a different person' });
    await board(agent).expect(403);
    const page = await request(t.http).get(`/v1/admin/people/${agent.userId}`).set(support.headers).expect(200);
    expect(page.body.agent.application).toMatchObject({
      status: 'rejected',
      decidedBy: 'Test operations',
      decisionNote: 'The selfie is of a different person',
    });
  });

  it("refuses a decision on an application that isn't in review", async () => {
    const agent = await signIn(t, 'agent', { unapproved: true });
    await request(t.http).get('/v1/agent/application').set(agent.headers).expect(200);
    expect((await decide(agent, { decision: 'approve', note: 'Looks fine to me' })).body.error.code).toBe(
      'not_in_review',
    );
    const customer = await signIn(t, 'customer');
    expect((await decide(customer, { decision: 'approve', note: 'Looks fine to me' })).status).toBe(404);
  });
});
