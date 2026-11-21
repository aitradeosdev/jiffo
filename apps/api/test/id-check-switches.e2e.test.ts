import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentApplicationService } from '../src/agents/application.service';
import { CountriesService } from '../src/countries/countries.service';
import { agentApplications, agentPresence, agentSelfieChecks, otpChallenges } from '../src/db/schema';
import {
  adminAs,
  agentWithMoney,
  approved,
  attestation,
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
  let original: { settings: { identity: Record<string, unknown>; topUps: Record<string, unknown> } };

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    ops = await adminAs(t, 'verification');
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    // Saved back as a new version: errands made here keep the version they were made under.
    await save('topUps', original.settings.topUps);
    await identity(original.settings.identity);
    await t.close();
  });

  /** Saves one part of Nigeria's settings with these changes, asked by one owner and approved by another. */
  async function save(section: 'identity' | 'topUps', changes: Record<string, unknown>) {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    Object.assign(settings[section], changes);
    const saved = await approved(t, 'owner', (h) =>
      request(t.http)
        .post('/v1/admin/settings?country=NG')
        .set(h)
        .send({ basedOn: now.version, settings, note: 'ID check switch for a test' }),
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  }
  const identity = (changes: Record<string, unknown>) => save('identity', changes);
  /** Registers a push token for the person, and returns what was sent to it. */
  async function pushes(who: Person) {
    const token = `id-switch-push-${who.userId}`;
    await request(t.http).put('/v1/devices/current/push-token').set(who.headers).send({ token }).expect(204);
    return () => t.push.sent.filter((p) => p.token === token).map((p) => p.title);
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

    it('get an own account number only with a verified ID while it is off: one-time numbers instead', async () => {
      await save('topUps', { oneTimeAccount: true, fixedAccount: true });
      await identity({ customerCheck: false });
      // The provider checks a BVN against the name sent, which only an ID check proves: without one, any
      // name could be tried against a stranger's BVN.
      const unchecked = await signIn(t, 'customer', { unverified: true });
      await request(t.http).patch('/v1/me').set(unchecked.headers).send({ lastName: 'Okafor' }).expect(200);
      const offer = (await request(t.http).get('/v1/wallet/top-up').set(unchecked.headers).expect(200)).body;
      expect(offer).toMatchObject({ oneTimeAccount: true, fixedAccount: { available: false } });
      const asked = await request(t.http)
        .post('/v1/wallet/fixed-account')
        .set(unchecked.headers)
        .send({ bvn: '22212345678' });
      expect(asked.status).toBe(409);
      expect(asked.body.error.code).toBe('fixed_account_needs_id');
      // One who checked their ID earlier keeps the option.
      const checked = await signIn(t, 'customer');
      expect((await request(t.http).get('/v1/wallet/top-up').set(checked.headers).expect(200)).body).toMatchObject({
        fixedAccount: { available: true },
      });
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
      // An ID check started earlier and never finished proved nothing: approving doesn't claim its ID.
      await t.db
        .update(agentApplications)
        .set({ pendingIdFingerprint: uniqueDigits(16) })
        .where(eq(agentApplications.userId, agent.userId));
      const decided = await request(t.http)
        .post(`/v1/admin/people/${agent.userId}/application`)
        .set(ops.headers)
        .send({ decision: 'approve', note: 'Met the agent and saw their ID' })
        .expect(200);
      expect(decided.body.status).toBe('approved');
      const [row] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, agent.userId));
      expect(row).toMatchObject({ idFingerprint: null, pendingIdFingerprint: null });
    });

    it('wait for their ID check if it is switched on while they send the application', async () => {
      await identity({ agentCheck: false });
      const agent = await applyWithoutId();
      const told = await pushes(agent);
      // The switch is saved after the app's checklist was read, before the application is claimed.
      const applications = t.app.get(AgentApplicationService);
      const claim = (applications as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>).updateDraft!;
      vi.spyOn(applications as never, 'updateDraft' as never).mockImplementationOnce((async (...a: unknown[]) => {
        await identity({ agentCheck: true });
        return claim.apply(applications, a);
      }) as never);
      await request(t.http).post('/v1/agent/application/submit').set(agent.headers).expect(200);
      const view = (await application(agent).expect(200)).body;
      expect(view).toMatchObject({ status: 'draft', identityRequired: true, steps: { identity: false } });
      expect(told()).toContain('Check your ID to finish your application');
    });

    it('go online on a phone the app check doubts while it is off, with no selfie asked for', async () => {
      await identity({ agentCheck: false });
      const agent = await signIn(t, 'agent');
      // The app check enforced, as the attestation tests do.
      const countries = t.app.get(CountriesService);
      const real = countries.currentSettingsIfAny.bind(countries);
      vi.spyOn(countries, 'currentSettingsIfAny').mockImplementation(async (code, db) => {
        const saved = await real(code, db);
        return (
          saved && {
            ...saved,
            settings: { ...saved.settings, security: { ...saved.settings.security, attestation: 'enforce' } },
          }
        );
      });
      await t.db
        .update(agentSelfieChecks)
        .set({ decidedAt: sql`${agentSelfieChecks.decidedAt} - interval '20 minutes'` })
        .where(eq(agentSelfieChecks.userId, agent.userId));
      const res = await request(t.http)
        .put('/v1/agent/presence')
        .set(agent.headers)
        .set(await attestation(t, agent.installKey!, 'doubtful'))
        .send({ online: true, ...HERE });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
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
      const told = await pushes(unchecked);
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
      await vi.waitFor(() => expect(told()).toContain('Check your ID to keep taking errands'));

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
      // As the error says, staff reopen it so the agent can check their ID, without declining them first.
      const reopened = await request(t.http)
        .post(`/v1/admin/people/${agent.userId}/application`)
        .set(ops.headers)
        .send({ decision: 'reopen', note: 'Joined before applications: needs an ID check' });
      expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
      expect(reopened.body.status).toBe('draft');
    });

    it('in review with no ID check are told to check it when it is switched on', async () => {
      await identity({ agentCheck: false });
      const agent = await applyWithoutId();
      await request(t.http).post('/v1/agent/application/submit').set(agent.headers).expect(200);
      const told = await pushes(agent);
      await identity({ agentCheck: true });
      expect((await application(agent).expect(200)).body.status).toBe('draft');
      await vi.waitFor(() => expect(told()).toEqual(['Check your ID to finish your application']));
    });
  });
});
