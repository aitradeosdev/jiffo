import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentApplications, agentPresence, otpChallenges } from '../src/db/schema';
import {
  adminAs,
  agentWithMoney,
  approved,
  boardRequest,
  checkAgentId,
  completeApplication,
  createErrand,
  createTestApp,
  errandBody,
  fund,
  signed,
  signIn,
  uniqueDigits,
  type Person,
  type TestApp,
} from './helpers';

const HERE = { lat: 6.448, lng: 3.47 };

/**
 * Switching the ID checks off and on, per country, separately for customers and agents (Settings, Identity).
 * Off for customers: they add money and request errands without one. Off for agents: they apply without one,
 * every application waits for a person, and there are no selfie checks, which compare with the face kept from
 * it. Switched back on, agents approved without one go back to their application to check their ID.
 */
describe('ID check switches', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  /** Decides agent applications. */
  let ops: Awaited<ReturnType<typeof adminAs>>;
  let original: { settings: { identity: Record<string, unknown> } };

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    ops = await adminAs(t, 'verification');
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
  });
  afterAll(async () => {
    // Saved back as a new version: errands made here keep the version they were made under.
    await identity(original.settings.identity);
    await t.close();
  });

  /** Saves Nigeria's identity settings with these changes, asked by one owner and approved by another. */
  async function identity(changes: Record<string, unknown>) {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    Object.assign(settings.identity, changes);
    const saved = await approved(t, 'owner', (h) =>
      request(t.http)
        .post('/v1/admin/settings?country=NG')
        .set(h)
        .send({ basedOn: now.version, settings, note: 'ID check switch for a test' }),
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  }
  const application = (who: Person) => request(t.http).get('/v1/agent/application').set(who.headers);
  const online = (who: Person, on = true) =>
    request(t.http)
      .put('/v1/agent/presence')
      .set(who.headers)
      .send({ online: on, ...HERE });

  describe('customers', () => {
    it('add money and request errands without an ID check while it is off, and none can be started', async () => {
      await identity({ customerCheck: false });
      const customer = await signIn(t, 'customer', { unverified: true });
      const me = await request(t.http).get('/v1/me/identity').set(customer.headers).expect(200);
      expect(me.body).toMatchObject({ required: false, status: 'none' });
      const start = await request(t.http)
        .post('/v1/me/identity')
        .set(customer.headers)
        .send({ consent: true, idType: 'nin', idNumber: `${uniqueDigits(7)}4567` });
      expect(start.status).toBe(409);
      expect(start.body.error.code).toBe('identity_check_off');
      await fund(t, customer);
      await createErrand(t, customer);
    });

    it('asks for the ID check again once it is switched back on', async () => {
      await identity({ customerCheck: false });
      const customer = await signIn(t, 'customer', { unverified: true });
      await fund(t, customer);
      await identity({ customerCheck: true });
      expect((await request(t.http).get('/v1/me/identity').set(customer.headers).expect(200)).body.required).toBe(true);
      const errand = await request(t.http).post('/v1/errands').set(customer.headers).send(errandBody());
      expect(errand.status).toBe(403);
      expect(errand.body.error.code).toBe('identity_required');
    });
  });

  describe('agents', () => {
    /** An agent named Tunde Bakare who sends an application with every step but the ID check. */
    async function applyWithoutId() {
      const agent = await signIn(t, 'agent', { unapproved: true });
      await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName: 'Bakare' }).expect(200);
      await completeApplication(t, agent, undefined, { identity: false });
      return agent;
    }

    it('apply without an ID check while it is off, and every application waits for a person', async () => {
      await identity({ agentCheck: false });
      const agent = await applyWithoutId();
      const view = (await application(agent).expect(200)).body;
      expect(view).toMatchObject({ identityRequired: false, steps: expect.objectContaining({ identity: true }) });
      const start = await request(t.http)
        .post('/v1/agent/application/identity')
        .set(agent.headers)
        .send({ nin: `${uniqueDigits(7)}4567`, bvn: '22212345678', consent: true });
      expect(start.status).toBe(409);
      expect(start.body.error.code).toBe('identity_check_off');

      const sent = await request(t.http).post('/v1/agent/application/submit').set(agent.headers).expect(200);
      // With no ID record, nobody's age or name was checked: a person decides.
      expect(sent.body.status).toBe('review');
      expect(sent.body.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'age', outcome: 'review' }),
          // The payout account is checked against the name in the app instead.
          expect.objectContaining({ key: 'bank', outcome: 'passed' }),
          expect.objectContaining({ key: 'address', outcome: 'passed' }),
        ]),
      );
      expect(sent.body.checks.map((c: { key: string }) => c.key)).not.toContain('selfie');
      const decided = await request(t.http)
        .post(`/v1/admin/people/${agent.userId}/application`)
        .set(ops.headers)
        .send({ decision: 'approve', note: 'Met the agent and saw their ID' })
        .expect(200);
      expect(decided.body.status).toBe('approved');
    });

    it('work without selfie checks while it is off: going online, a new phone, a payout change', async () => {
      await identity({ agentCheck: false });
      const agent = await agentWithMoney(t);
      // A new phone: the earlier code's wait is over first.
      await t.db
        .update(otpChallenges)
        .set({ createdAt: sql`${otpChallenges.createdAt} - interval '1 hour'` })
        .where(eq(otpChallenges.phone, agent.phone));
      const fresh = await signIn(t, 'agent', { phone: agent.phone, noSelfie: true });
      expect((await request(t.http).get('/v1/agent/selfie').set(fresh.headers).expect(200)).body).toMatchObject({
        toGoOnline: null,
        onThisPhone: false,
      });
      expect((await online(fresh)).status).toBe(200);
      // A money action on the new phone asks for no selfie; the new phone's withdrawal hold still applies.
      const withdrawal = await signed(t, fresh)
        .post('/v1/wallet/withdrawals')
        .send({ amountKobo: 100_000, speed: 'scheduled', requestId: randomUUID() });
      expect(withdrawal.body.error?.code).not.toBe('selfie_needed');
      const started = await request(t.http).post('/v1/agent/selfie').set(fresh.headers).send({});
      expect(started.status).toBe(409);
      expect(started.body.error.code).toBe('selfie_off');
    });

    it('go back to their application when it is switched on, if they were approved without one', async () => {
      await identity({ agentCheck: false });
      const unchecked = await applyWithoutId();
      await request(t.http).post('/v1/agent/application/submit').set(unchecked.headers).expect(200);
      await request(t.http)
        .post(`/v1/admin/people/${unchecked.userId}/application`)
        .set(ops.headers)
        .send({ decision: 'approve', note: 'Saw their ID in person' })
        .expect(200);
      await signed(t, unchecked); // the phone is set up for money actions
      expect((await online(unchecked)).status).toBe(200);
      // One approved with an ID check stays approved.
      const checked = await signIn(t, 'agent');

      await identity({ agentCheck: true });
      const view = (await application(unchecked).expect(200)).body;
      expect(view).toMatchObject({ status: 'draft', identityRequired: true });
      expect(view.steps).toMatchObject({ identity: false, address: true, bank: true, prefs: true, learn: true });
      const [presence] = await t.db.select().from(agentPresence).where(eq(agentPresence.userId, unchecked.userId));
      expect(presence?.online).toBe(false);
      expect((await boardRequest(t, unchecked)).status).toBe(403);
      expect((await application(checked).expect(200)).body.status).toBe('approved');

      // Checking their ID and sending it again approves them, as any application whose checks all pass.
      await checkAgentId(t, unchecked);
      const sent = await request(t.http).post('/v1/agent/application/submit').set(unchecked.headers).expect(200);
      expect(sent.body.status, JSON.stringify(sent.body)).toBe('approved');
    });

    it("can't be approved by staff without an ID check while it is on", async () => {
      await identity({ agentCheck: true });
      const agent = await signIn(t, 'agent', { unapproved: true });
      await request(t.http)
        .patch('/v1/agent/application')
        .set(agent.headers)
        .send({ stateCode: 'LA', area: 'Lekki' })
        .expect(200);
      await t.db
        .update(agentApplications)
        .set({ status: 'review', submittedAt: new Date() })
        .where(eq(agentApplications.userId, agent.userId));
      const decided = await request(t.http)
        .post(`/v1/admin/people/${agent.userId}/application`)
        .set(ops.headers)
        .send({ decision: 'approve', note: 'Looks fine' });
      expect(decided.status, JSON.stringify(decided.body)).toBe(409);
      expect(decided.body.error.code).toBe('identity_needed');
    });
  });
});
