import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentApplications, states } from '../src/db/schema';
import { createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

describe('agent application', () => {
  let t: TestApp;
  let customer: Person;
  let seq = 0;

  beforeAll(async () => {
    t = await createTestApp();
    customer = await signIn(t, 'customer');
    await fund(t, customer, 5_000_000);
  });
  afterAll(() => t.close());

  /** A new agent who hasn't applied, with a full name, as on their NIN. */
  async function newAgent(lastName = 'Bakare') {
    const agent = await signIn(t, 'agent', { unapproved: true });
    await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName }).expect(200);
    return agent;
  }
  /** A NIN nobody else in the run has, ending in the given digits. */
  const nin = (ending = '4567') => `${String(70000 + ++seq).padStart(7, '0')}${ending}`;
  const app = (agent: Person) => request(t.http).get('/v1/agent/application').set(agent.headers).expect(200);
  const call = (agent: Person, method: 'post' | 'put' | 'patch', path: string, body: Record<string, unknown> = {}) =>
    request(t.http)[method](`/v1/agent/application${path}`).set(agent.headers).send(body);

  /** Everything except submitting. */
  async function complete(agent: Person, ninNumber = nin()) {
    await call(agent, 'patch', '', { stateCode: 'LA', area: 'Lekki' }).expect(200);
    const started = await call(agent, 'post', '/identity', {
      nin: ninNumber,
      bvn: '22212345678',
      consent: true,
    }).expect(200);
    expect(started.body).toMatchObject({ provider: 'fake', sdkToken: expect.any(String) });
    await call(agent, 'post', '/identity/finish').expect(200);
    await call(agent, 'put', '/address', {
      address: '14 Fola Osibo Road, Lekki Phase 1',
      emergency: { name: 'Ngozi Bakare', phone: '+2348034471902', relationship: 'Sibling' },
    }).expect(200);
    const accountNumber = `0${String(100000000 + seq).slice(-9)}`;
    t.payments.accounts.set(`058:${accountNumber}`, 'TUNDE BAKARE');
    await request(t.http)
      .put('/v1/payout-account')
      .set(agent.headers)
      .send({ bankCode: '058', accountNumber })
      .expect(200);
    await request(t.http).patch('/v1/agent/profile').set(agent.headers).send({ takesPurchases: true }).expect(200);
    await call(agent, 'post', '/terms', { accepted: true }).expect(200);
    return ninNumber;
  }

  it('keeps agents off the board until they are approved', async () => {
    const agent = await newAgent();
    const errand = await createErrand(t, customer);
    const board = await request(t.http).get('/v1/errands/board?lat=6.4480&lng=3.4700&radiusKm=5').set(agent.headers);
    expect(board.status).toBe(403);
    expect(board.body.error.code).toBe('application_pending');
    await request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, lat: 6.44, lng: 3.47 })
      .expect(403);
    // Going offline always works.
    await request(t.http).put('/v1/agent/presence').set(agent.headers).send({ online: false }).expect(200);
    const accept = await request(t.http)
      .post(`/v1/errands/${errand.id}/events`)
      .set(agent.headers)
      .send({ event: 'accept' });
    expect(accept.status).toBe(403);
    expect((await app(agent)).body).toMatchObject({
      status: 'draft',
      steps: { basics: false, identity: false, address: false, bank: false, prefs: false, learn: false },
    });
  });

  it('approves an agent whose checks all pass, keeping results and never the numbers', async () => {
    const agent = await newAgent();
    expect(
      (await call(agent, 'post', '/identity', { nin: '123', bvn: '22212345678', consent: true })).body.error.code,
    ).toBe('invalid_nin');
    const ninNumber = await complete(agent);
    expect((await app(agent)).body.steps).toEqual({
      basics: true,
      identity: true,
      address: true,
      bank: true,
      prefs: true,
      learn: true,
    });
    const res = await call(agent, 'post', '/submit').expect(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.legalName).toBe('TUNDE BAKARE');
    expect(res.body.checks.map((c: { key: string; outcome: string }) => `${c.key}:${c.outcome}`)).toEqual([
      'nin:passed',
      'bvn:passed',
      'selfie:passed',
      'age:passed',
      'name:passed',
      'address:passed',
      'bank:passed',
    ]);
    // Neither number is kept anywhere on the row.
    const [row] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, agent.userId));
    expect(JSON.stringify(row)).not.toContain(ninNumber);
    expect(JSON.stringify(row)).not.toContain('22212345678');
    expect(row!.ninFingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Now they can work, and the application is closed for edits.
    await request(t.http).get('/v1/errands/board?lat=6.4480&lng=3.4700&radiusKm=5').set(agent.headers).expect(200);
    expect((await call(agent, 'patch', '', { area: 'Ikoyi' })).status).toBe(409);
  });

  it('refuses a NIN another agent already uses', async () => {
    const first = await newAgent();
    const shared = nin();
    await call(first, 'patch', '', { stateCode: 'LA', area: 'Lekki' }).expect(200);
    await call(first, 'post', '/identity', { nin: shared, bvn: '22212345678', consent: true }).expect(200);
    const second = await newAgent();
    const res = await call(second, 'post', '/identity', { nin: shared, bvn: '22212345679', consent: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('nin_in_use');
  });

  it('sends unclear results to support instead of turning anyone away', async () => {
    for (const [ending, key, outcome] of [
      ['1111', 'selfie', 'review'],
      ['1818', 'age', 'failed'],
    ] as const) {
      const agent = await newAgent();
      await complete(agent, nin(ending));
      const res = await call(agent, 'post', '/submit').expect(200);
      expect(res.body.status).toBe('review');
      expect(res.body.checks.find((c: { key: string }) => c.key === key)).toMatchObject({ outcome });
      await request(t.http).get('/v1/errands/board?lat=6.4480&lng=3.4700&radiusKm=5').set(agent.headers).expect(403);
    }
    // An address the provider can't confirm goes to review too.
    const agent = await newAgent();
    await complete(agent);
    await call(agent, 'put', '/address', {
      address: 'Unknown street somewhere in Lekki',
      emergency: { name: 'Ngozi Bakare', phone: '+2348034471902' },
    }).expect(200);
    expect((await call(agent, 'post', '/submit').expect(200)).body.status).toBe('review');
  });

  it('submits only a finished application, and not from a state on a waitlist', async () => {
    const agent = await newAgent();
    await call(agent, 'patch', '', { stateCode: 'LA', area: 'Lekki' }).expect(200);
    const early = await call(agent, 'post', '/submit');
    expect(early.status).toBe(422);
    expect(early.body.error.missing).toEqual(['identity', 'address', 'bank', 'prefs', 'learn']);
    expect((await call(agent, 'patch', '', { stateCode: 'XX' })).body.error.code).toBe('unknown_state');

    const waiting = await newAgent();
    await complete(waiting);
    await t.db
      .update(states)
      .set({ agentSignups: 'waitlist' })
      .where(and(eq(states.countryCode, 'NG'), eq(states.code, 'OY')));
    await call(waiting, 'patch', '', { stateCode: 'OY' }).expect(200);
    expect((await app(waiting)).body).toMatchObject({ waitlisted: true, stateName: 'Oyo' });
    expect((await call(waiting, 'post', '/submit')).body.error.code).toBe('waitlisted');
    await t.db
      .update(states)
      .set({ agentSignups: 'open' })
      .where(and(eq(states.countryCode, 'NG'), eq(states.code, 'OY')));
  });
});
