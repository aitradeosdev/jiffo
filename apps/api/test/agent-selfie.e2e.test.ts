import { createHmac, generateKeyPairSync, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeIdentityAdapter } from '../src/adapters/identity';
import { SmileIdIdentityAdapter } from '../src/adapters/identity-providers';
import { CountriesService } from '../src/countries/countries.service';
import {
  agentApplications,
  agentPresence,
  agentSelfieChecks,
  alerts,
  devices,
  errands,
  otpChallenges,
  providerSettings,
  sessions,
  users,
} from '../src/db/schema';
import { ProvidersService } from '../src/providers/providers.service';
import {
  act,
  adminAs,
  agentWithMoney,
  createErrand,
  createTestApp,
  fund,
  signed,
  signIn,
  switchProvider,
  uniqueDigits,
  type Person,
  type TestApp,
} from './helpers';

const HERE = { lat: 6.448, lng: 3.47 };

/**
 * Agents' selfie checks (docs/security-plan.md, A4, I2, I8, P8, X4): the person working is the agent who was
 * verified. A selfie against the face the identity provider kept, before going online each day, at random
 * when the settings ask, on a new phone before money moves, and just before the payout account changes.
 * Three failures in a row suspend the account for staff to look.
 */
describe('agent selfie checks', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  const refused = (res: request.Response, code: string, reason?: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error.code).toBe(code);
    if (reason) expect(res.body.error.reason).toBe(reason);
  };
  const online = (who: Person, on = true) =>
    request(t.http)
      .put('/v1/agent/presence')
      .set(who.headers)
      .send({ online: on, ...HERE });
  /** Takes a selfie as the agent app does, with the provider's verdict the fake gives (passed unless told). */
  async function selfie(who: Person, body: object = {}) {
    const started = await request(t.http).post('/v1/agent/selfie').set(who.headers).send(body).expect(200);
    expect(started.body.session.enrolledId).toMatch(/^jid-/);
    return (await request(t.http).post(`/v1/agent/selfie/${started.body.id}/finish`).set(who.headers).expect(200)).body;
  }
  const failures = async (who: Person) =>
    (await t.db.select({ n: users.selfieFailures }).from(users).where(eq(users.id, who.userId)))[0]!.n;
  const ageSelfies = (who: Person, interval: string) =>
    t.db
      .update(agentSelfieChecks)
      .set({ decidedAt: sql`${agentSelfieChecks.decidedAt} - ${sql.raw(`interval '${interval}'`)}` })
      .where(eq(agentSelfieChecks.userId, who.userId));
  const withdrawal = () => ({ amountKobo: 100_000, speed: 'scheduled', requestId: randomUUID() });

  it("won't go online until today's selfie passes, and keeps an agent online past midnight", async () => {
    const agent = await signIn(t, 'agent', { noSelfie: true });
    refused(await online(agent), 'selfie_needed', 'daily');
    expect((await request(t.http).get('/v1/agent/selfie').set(agent.headers).expect(200)).body).toMatchObject({
      toGoOnline: 'daily',
      onThisPhone: false,
    });
    expect(await selfie(agent)).toEqual({ status: 'passed' });
    await online(agent).expect(200);
    // The app's heartbeat says online again: no selfie for staying online.
    await online(agent).expect(200);

    // The next day: still online, and asked again only when going online again.
    await ageSelfies(agent, '2 days');
    await online(agent).expect(200);
    await online(agent, false).expect(200);
    refused(await online(agent), 'selfie_needed', 'daily');
  });

  it('keeps sharing the position for a running errand while the selfie is still to take', async () => {
    const agent = await signIn(t, 'agent');
    const customer = await signIn(t, 'customer');
    await fund(t, customer);
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await ageSelfies(agent, '2 days');
    const res = await online(agent).expect(200);
    expect(res.body).toEqual({ online: false, sharingLocation: true, selfieNeeded: 'daily' });
    const [presence] = await t.db.select().from(agentPresence).where(eq(agentPresence.userId, agent.userId));
    expect(presence).toMatchObject({ online: false, lat: HERE.lat, lng: HERE.lng });
  });

  it("counts the day in the country's time zone", async () => {
    const agent = await signIn(t, 'agent', { noSelfie: true });
    await selfie(agent);
    const lagosMidnight = sql`(date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos')`;
    await t.db
      .update(agentSelfieChecks)
      .set({ decidedAt: sql`${lagosMidnight} - interval '1 minute'` })
      .where(eq(agentSelfieChecks.userId, agent.userId));
    refused(await online(agent), 'selfie_needed', 'daily');
    await t.db
      .update(agentSelfieChecks)
      .set({ decidedAt: sql`${lagosMidnight} + interval '1 minute'` })
      .where(eq(agentSelfieChecks.userId, agent.userId));
    await online(agent).expect(200);
  });

  it('asks at random when the settings say, until one passes, and not straight after one did', async () => {
    const countries = t.app.get(CountriesService);
    const real = countries.currentSettingsIfAny.bind(countries);
    vi.spyOn(countries, 'currentSettingsIfAny').mockImplementation(async (code) => {
      const saved = await real(code);
      return (
        saved && {
          ...saved,
          // The day's selfie is off, so a selfie an hour old can't be yesterday's when the test runs just
          // after midnight in Lagos.
          settings: {
            ...saved.settings,
            security: { ...saved.settings.security, randomSelfiePercent: 100, dailySelfie: false },
          },
        }
      );
    });
    const agent = await signIn(t, 'agent');
    await ageSelfies(agent, '1 hour');
    refused(await online(agent), 'selfie_needed', 'random');
    // Trying again doesn't roll again: the check is kept until a selfie passes.
    expect((await request(t.http).get('/v1/agent/selfie').set(agent.headers).expect(200)).body.toGoOnline).toBe(
      'random',
    );
    expect(await selfie(agent)).toEqual({ status: 'passed' });
    await online(agent).expect(200);
  });

  it('asks for a selfie on a new phone before money moves, without using up the confirmation', async () => {
    const agent = await agentWithMoney(t);
    await t.db
      .update(otpChallenges)
      .set({ createdAt: sql`${otpChallenges.createdAt} - interval '1 hour'` })
      .where(eq(otpChallenges.phone, agent.phone));
    const newPhone = await signIn(t, 'agent', { phone: agent.phone, noSelfie: true });
    const usedCodes = async () =>
      (
        (
          await t.db.execute(
            sql`select count(*)::int as n from device_challenges c join devices d on d.id = c.device_id where d.user_id = ${agent.userId} and c.used_at is not null`,
          )
        ).rows[0] as { n: number }
      ).n;
    const before = await usedCodes();
    refused(await signed(t, newPhone).post('/v1/wallet/withdrawals').send(withdrawal()), 'selfie_needed', 'new_device');
    // Even the PIN can't be changed on it first.
    refused(await signed(t, newPhone).put('/v1/me/pin').send({ pin: '4826', currentPin: '2580' }), 'selfie_needed');
    expect(await usedCodes()).toBe(before);
    expect((await request(t.http).get('/v1/agent/selfie').set(newPhone.headers).expect(200)).body.onThisPhone).toBe(
      true,
    );
    const started = await request(t.http).post('/v1/agent/selfie').set(newPhone.headers).send({}).expect(200);
    expect(started.body.reason).toBe('new_device');
    await request(t.http).post(`/v1/agent/selfie/${started.body.id}/finish`).set(newPhone.headers).expect(200);
    // Past the selfie, the new phone's withdrawal hold is what stops it now.
    const held = await signed(t, newPhone).post('/v1/wallet/withdrawals').send(withdrawal());
    expect(held.status).toBe(409);
    expect(held.body.error.code).toBe('withdrawals_held');
  });

  it("treats a phone whose key was replaced as a new phone, and leaves the customer app's phones alone", async () => {
    const agent = await signIn(t, 'agent');
    const replacement = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    await request(t.http)
      .put('/v1/devices/current/key')
      .set(agent.headers)
      .send({ publicKey: replacement.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') })
      .expect(204);
    refused(
      await signed(t, agent, { key: replacement.privateKey })
        .put('/v1/me/pin')
        .send({ pin: '4826', currentPin: '2580' }),
      'selfie_needed',
      'new_device',
    );

    await t.db
      .update(otpChallenges)
      .set({ createdAt: sql`${otpChallenges.createdAt} - interval '1 hour'` })
      .where(eq(otpChallenges.phone, agent.phone));
    const asCustomer = await signIn(t, 'customer', { phone: agent.phone, firstName: null });
    const rows = await t.db
      .select({ needed: devices.selfieNeeded })
      .from(devices)
      .where(and(eq(devices.userId, asCustomer.userId), eq(devices.app, 'customer')));
    expect(rows.map((r) => r.needed)).toEqual([false]);
    expect((await request(t.http).get('/v1/agent/selfie').set(asCustomer.headers)).status).toBe(403);
    expect((await request(t.http).post('/v1/agent/selfie').set(asCustomer.headers).send({})).status).toBe(403);
  });

  it('suspends the account after three failures in a row, signs it out and tells staff', async () => {
    const agent = await signIn(t, 'agent', { noSelfie: true });
    // The same account in the customer app, with a request still waiting for an agent.
    await t.db
      .update(otpChallenges)
      .set({ createdAt: sql`${otpChallenges.createdAt} - interval '1 hour'` })
      .where(eq(otpChallenges.phone, agent.phone));
    const asCustomer = await signIn(t, 'customer', { phone: agent.phone });
    await fund(t, asCustomer);
    const waiting = await createErrand(t, asCustomer);
    const verdicts = vi.spyOn(FakeIdentityAdapter.prototype, 'selfieResult');
    verdicts.mockResolvedValue({ status: 'done', outcome: 'failed', note: 'The face did not match' });
    expect(await selfie(agent)).toMatchObject({ status: 'failed', triesLeft: 2 });
    expect(await selfie(agent)).toMatchObject({ status: 'failed', triesLeft: 1 });
    expect(await selfie(agent)).toEqual({ status: 'suspended' });
    const [user] = await t.db.select().from(users).where(eq(users.id, agent.userId));
    expect(user).toMatchObject({ status: 'suspended', selfieFailures: 3 });
    const live = await t.db.select().from(sessions).where(eq(sessions.userId, agent.userId));
    expect(live.every((s) => s.revokedReason === 'selfie_failed' || s.revokedAt)).toBe(true);
    expect((await request(t.http).get('/v1/me').set(agent.headers)).status).toBe(401);
    const [alert] = await t.db
      .select()
      .from(alerts)
      .where(and(eq(alerts.kind, 'selfie_failed'), eq(alerts.dedupeKey, agent.userId)));
    expect(alert?.message).toMatch(/suspended/);
    const [presence] = await t.db.select().from(agentPresence).where(eq(agentPresence.userId, agent.userId));
    expect(presence?.online ?? false).toBe(false);
    // Its request still waiting for an agent is closed, as a suspension from the panel does.
    const [closed] = await t.db.select().from(errands).where(eq(errands.id, waiting.id));
    expect(closed!.status).toBe('cancelled');

    // Staff look and reactivate it: the count starts again, so one more failure doesn't suspend it at once.
    const ops = await adminAs(t, 'operations');
    await request(t.http)
      .post(`/v1/admin/people/${agent.userId}/reactivate`)
      .set(ops.headers)
      .send({ note: 'Checked on a video call: it was them' })
      .expect(200);
    expect(await failures(agent)).toBe(0);
  });

  it("doesn't count an unclear selfie, and a pass clears the count", async () => {
    const agent = await signIn(t, 'agent', { noSelfie: true });
    const verdicts = vi.spyOn(FakeIdentityAdapter.prototype, 'selfieResult');
    verdicts.mockResolvedValueOnce({ status: 'done', outcome: 'retry', note: 'Too dark' });
    expect(await selfie(agent)).toMatchObject({ status: 'unclear' });
    expect(await failures(agent)).toBe(0);
    verdicts.mockResolvedValueOnce({ status: 'done', outcome: 'failed' });
    await selfie(agent);
    expect(await failures(agent)).toBe(1);
    expect(await selfie(agent)).toEqual({ status: 'passed' });
    expect(await failures(agent)).toBe(0);
  });

  it("decides each check once, and only its own agent's", async () => {
    const agent = await signIn(t, 'agent', { noSelfie: true });
    const other = await signIn(t, 'agent');
    const verdicts = vi.spyOn(FakeIdentityAdapter.prototype, 'selfieResult');
    verdicts.mockResolvedValue({ status: 'done', outcome: 'failed' });
    const started = await request(t.http).post('/v1/agent/selfie').set(agent.headers).send({}).expect(200);
    await request(t.http).post(`/v1/agent/selfie/${started.body.id}/finish`).set(other.headers).expect(404);
    const finish = () =>
      request(t.http).post(`/v1/agent/selfie/${started.body.id}/finish`).set(agent.headers).expect(200);
    const both = await Promise.all([finish(), finish()]);
    expect(both.map((r) => r.body.status)).toEqual(['failed', 'failed']);
    expect(await finish().then((r) => r.body.status)).toBe('failed');
    expect(await failures(agent)).toBe(1);
  });

  it('needs a selfie just before the payout account changes, but not to add the first', async () => {
    const agent = await agentWithMoney(t);
    const accountNumber = `0${uniqueDigits(9)}`;
    t.payments.accounts.set(`058:${accountNumber}`, 'TUNDE BAKARE');
    await ageSelfies(agent, '20 minutes');
    const change = () => signed(t, agent).put('/v1/payout-account').send({ bankCode: '058', accountNumber });
    const usedCodes = async () =>
      (
        (
          await t.db.execute(
            sql`select count(*)::int as n from device_challenges c join devices d on d.id = c.device_id where d.user_id = ${agent.userId} and c.used_at is not null`,
          )
        ).rows[0] as { n: number }
      ).n;
    const before = await usedCodes();
    refused(await change(), 'selfie_needed', 'payout_change');
    // Asked before the confirmation is used up, so the app sends the same one again after the selfie.
    expect(await usedCodes()).toBe(before);
    expect((await request(t.http).get('/v1/agent/selfie').set(agent.headers).expect(200)).body.fresh).toBe(false);
    const started = await request(t.http)
      .post('/v1/agent/selfie')
      .set(agent.headers)
      .send({ for: 'payout_change' })
      .expect(200);
    expect(started.body.reason).toBe('payout_change');
    await request(t.http).post(`/v1/agent/selfie/${started.body.id}/finish`).set(agent.headers).expect(200);
    await change().expect(200);
  });

  it("can't start without an identity check, or with a provider that keeps no face", async () => {
    const applicant = await signIn(t, 'agent', { unapproved: true });
    expect((await request(t.http).post('/v1/agent/selfie').set(applicant.headers).send({})).body.error.code).toBe(
      'selfie_unavailable',
    );
    // An identity check still running, or with our team, may have no face kept yet.
    for (const identityOutcome of [null, 'review'] as const) {
      const waiting = await signIn(t, 'agent', { unapproved: true });
      await t.db.insert(agentApplications).values({
        userId: waiting.userId,
        countryCode: 'NG',
        status: identityOutcome ? 'review' : 'checking',
        identityProvider: 'fake',
        identityReference: `jid-${randomUUID()}`,
        identityOutcome,
      });
      expect((await request(t.http).post('/v1/agent/selfie').set(waiting.headers).send({})).body.error.code).toBe(
        'selfie_unavailable',
      );
    }
    const agent = await signIn(t, 'agent');
    await t.db
      .update(agentApplications)
      .set({ identityProvider: 'dojah' })
      .where(eq(agentApplications.userId, agent.userId));
    expect((await request(t.http).post('/v1/agent/selfie').set(agent.headers).send({})).body.error.code).toBe(
      'selfie_unavailable',
    );
  });

  describe('with Smile ID', () => {
    const owner = () => adminAs(t, 'owner');
    afterAll(async () => {
      await switchProvider(t, 'identity', null);
      await t.db.delete(providerSettings);
      await t.app.get(ProvidersService).reload();
    });

    async function smileIdOn() {
      const admin = await owner();
      await request(t.http)
        .put('/v1/admin/providers/identity/smileid')
        .set(admin.headers)
        .send({
          config: { partnerId: '1234', privacyPolicyUrl: 'https://jiffo.test/privacy', mode: 'sandbox' },
          secrets: { apiKey: 'smile-key' },
        })
        .expect(200);
      vi.spyOn(SmileIdIdentityAdapter.prototype, 'check').mockResolvedValue('Connected');
      await request(t.http).post('/v1/admin/providers/identity/smileid/test').set(admin.headers).expect(200);
      await switchProvider(t, 'identity', 'smileid');
    }
    /** An agent whose identity was checked with Smile ID: its reference is the enrolled user id. */
    async function smileAgent() {
      const agent = await signIn(t, 'agent', { noSelfie: true });
      const enrolledId = `jid-${randomUUID()}`;
      await t.db
        .update(agentApplications)
        .set({ identityProvider: 'smileid', identityReference: enrolledId })
        .where(eq(agentApplications.userId, agent.userId));
      return { agent, enrolledId };
    }
    const token = () =>
      vi
        .spyOn(SmileIdIdentityAdapter.prototype as unknown as { token: () => Promise<string> }, 'token')
        .mockResolvedValue('jwt-scoped');
    const jobStatus = (job: object) =>
      vi
        .spyOn(
          SmileIdIdentityAdapter.prototype as unknown as { jobStatus: (id: string) => Promise<object> },
          'jobStatus',
        )
        .mockResolvedValue(job);
    let n = 0;
    /** Smile ID's callback for a job, signed with our key just now. */
    /** With a null reference, the job carried none of ours. */
    const callback = (reference: string | null, jobId: string, product = 'smart_selfie_authentication') => {
      const timestamp = new Date(Date.now() + n++ * 1000).toISOString();
      return request(t.http)
        .post('/v1/webhooks/identity/smileid')
        .set('content-type', 'application/json')
        .set('response-timestamp', timestamp)
        .set(
          'response-signature',
          createHmac('sha256', 'smile-key').update(`${timestamp}1234sid_request`).digest('base64'),
        )
        .set('smileid-job-id', jobId)
        .send(
          JSON.stringify({
            product,
            status: 'clear',
            partner_params: { ...(reference ? { reference } : {}), job_type: 2 },
          }),
        );
    };

    it('gives the app a scoped token, and takes the verdict only from their signed callback', async () => {
      await smileIdOn();
      token();
      const { agent, enrolledId } = await smileAgent();
      const started = await request(t.http).post('/v1/agent/selfie').set(agent.headers).send({}).expect(200);
      expect(started.body).toMatchObject({
        provider: 'smileid',
        reason: 'daily',
        session: { enrolledId, token: 'jwt-scoped', partnerId: '1234', sandbox: true },
      });
      const reference = started.body.session.reference as string;
      expect(reference).toMatch(/^sel-/);
      const finish = () =>
        request(t.http).post(`/v1/agent/selfie/${started.body.id}/finish`).set(agent.headers).expect(200);
      // Nothing yet: the app's word that the SDK finished isn't a verdict.
      expect((await finish()).body.status).toBe('pending');
      refused(await online(agent), 'selfie_needed');

      jobStatus({ status: 'clear', user_id: enrolledId, created_at: new Date().toISOString() });
      await callback(reference, 'job_01').expect(200);
      expect((await finish()).body.status).toBe('passed');
      await online(agent).expect(200);
    });

    it('matches a job that came without our reference to the agent it was for, and their latest check', async () => {
      await smileIdOn();
      token();
      const { agent, enrolledId } = await smileAgent();
      const start = async () =>
        (await request(t.http).post('/v1/agent/selfie').set(agent.headers).send({}).expect(200)).body as {
          id: string;
        };
      const status = async (id: string) =>
        (await t.db.select().from(agentSelfieChecks).where(eq(agentSelfieChecks.id, id)))[0]!.status;
      const earlier = await start();
      const latest = await start();
      // A job for no agent of ours settles nothing.
      jobStatus({ status: 'clear', user_id: 'jid-nobody', created_at: new Date().toISOString() });
      await callback(null, 'job_06').expect(200);
      expect([await status(earlier.id), await status(latest.id)]).toEqual(['pending', 'pending']);

      jobStatus({ status: 'clear', user_id: enrolledId, created_at: new Date().toISOString() });
      await callback(null, 'job_07').expect(200);
      expect([await status(earlier.id), await status(latest.id)]).toEqual(['pending', 'passed']);
      // Another kind of SmartSelfie job, with none of our reference, fails the agent's check all the same.
      await callback(null, 'job_08', 'smart_selfie_compare').expect(200);
      expect(await status(earlier.id)).toBe('failed');
    });

    it('finishes from the status API a job that was still running when its callback came', async () => {
      await smileIdOn();
      token();
      const { agent, enrolledId } = await smileAgent();
      const started = await request(t.http).post('/v1/agent/selfie').set(agent.headers).send({}).expect(200);
      const running = jobStatus({ status: 'processing', user_id: enrolledId, created_at: new Date().toISOString() });
      await callback(started.body.session.reference, 'job_05').expect(200);
      const finish = () =>
        request(t.http).post(`/v1/agent/selfie/${started.body.id}/finish`).set(agent.headers).expect(200);
      expect((await finish()).body.status).toBe('pending');
      running.mockResolvedValue({ status: 'clear', user_id: enrolledId, created_at: new Date().toISOString() });
      expect((await finish()).body.status).toBe('passed');
      expect(running).toHaveBeenLastCalledWith('job_05');
    });

    it("fails a job for another person, an older job, another product, and won't use one job twice", async () => {
      await smileIdOn();
      token();
      const { agent, enrolledId } = await smileAgent();
      const start = async () =>
        (await request(t.http).post('/v1/agent/selfie').set(agent.headers).send({}).expect(200)).body as {
          id: string;
          session: { reference: string };
        };
      const status = async (id: string) =>
        (await t.db.select().from(agentSelfieChecks).where(eq(agentSelfieChecks.id, id)))[0]!;

      // Another person's face, under this check.
      const someone = await start();
      jobStatus({ status: 'clear', user_id: 'jid-someone-else', created_at: new Date().toISOString() });
      await callback(someone.session.reference, 'job_02').expect(200);
      expect(await status(someone.id)).toMatchObject({ status: 'failed', note: /another person/ });

      // A pass from before the check started.
      const older = await start();
      jobStatus({ status: 'clear', user_id: enrolledId, created_at: new Date(Date.now() - 3_600_000).toISOString() });
      await callback(older.session.reference, 'job_03').expect(200);
      expect(await status(older.id)).toMatchObject({ status: 'failed', note: /before this check/ });

      // A compare of two photos the app chose says nothing about the kept face: suspended at the third.
      const compare = await start();
      jobStatus({ status: 'clear', user_id: enrolledId, created_at: new Date().toISOString() });
      await callback(compare.session.reference, 'job_04', 'smart_selfie_compare').expect(200);
      expect(await status(compare.id)).toMatchObject({ status: 'failed' });
      const [user] = await t.db.select().from(users).where(eq(users.id, agent.userId));
      expect(user!.status).toBe('suspended');

      // A job that decided one check can't decide another.
      const second = await smileAgent();
      await t.db
        .update(agentApplications)
        .set({ identityReference: enrolledId })
        .where(eq(agentApplications.userId, second.agent.userId));
      const theirs = (await request(t.http).post('/v1/agent/selfie').set(second.agent.headers).send({}).expect(200))
        .body as { id: string; session: { reference: string } };
      await callback(theirs.session.reference, 'job_04').expect(200);
      expect(await status(theirs.id)).toMatchObject({ status: 'pending' });
    });
  });
});
