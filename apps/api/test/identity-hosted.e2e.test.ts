import { createHmac } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SmileIdIdentityAdapter } from '../src/adapters/identity-providers';
import { agentApplications, customerVerifications, providerSettings } from '../src/db/schema';
import { ProvidersService } from '../src/providers/providers.service';
import {
  adminAs,
  completeApplication,
  createTestApp,
  signIn,
  uniqueNin,
  type Person,
  type TestApp,
  switchProvider,
} from './helpers';

describe("identity checks on the provider's own page", () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  const panel = (method: 'put' | 'post', path: string) =>
    request(t.http)[method](`/v1/admin/providers${path}`).set(owner.headers);

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
  });
  afterAll(async () => {
    await t.db.delete(providerSettings);
    await t.app.get(ProvidersService).reload();
    await t.close();
  });

  /** Smile ID's settings saved and tested in the panel, and switched on. */
  async function smileIdOn() {
    await panel('put', '/identity/smileid')
      .send({
        config: { partnerId: '1234', privacyPolicyUrl: 'https://jiffo.test/privacy', mode: 'sandbox' },
        secrets: { apiKey: 'smile-key' },
      })
      .expect(200);
    vi.spyOn(SmileIdIdentityAdapter.prototype, 'check').mockResolvedValue('Connected');
    await panel('post', '/identity/smileid/test').expect(200);
    await switchProvider(t, 'identity', 'smileid');
  }

  async function newAgent(): Promise<Person> {
    const agent = await signIn(t, 'agent', { unapproved: true });
    await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName: 'Bakare' }).expect(200);
    await request(t.http)
      .patch('/v1/agent/application')
      .set(agent.headers)
      .send({ stateCode: 'LA', area: 'Lekki' })
      .expect(200);
    return agent;
  }

  it('starts Smile ID without the numbers, and finishes from its signed result', async () => {
    await smileIdOn();

    const agent = await newAgent();
    const view = await request(t.http).get('/v1/agent/application').set(agent.headers).expect(200);
    expect(view.body).toMatchObject({ identityFlow: 'hosted', provider: 'Smile ID' });
    const link = vi
      .spyOn(SmileIdIdentityAdapter.prototype, 'startIdentity')
      .mockImplementation(async ({ reference }) => ({ reference, url: `https://links.smile.test/${reference}` }));
    const started = await request(t.http)
      .post('/v1/agent/application/identity')
      .set(agent.headers)
      .send({ consent: true, idType: 'bvn' })
      .expect(200);
    expect(started.body).toMatchObject({
      provider: 'smileid',
      url: expect.stringMatching(/^https:\/\/links\.smile\.test\/jid-/),
    });
    // Smile ID can't check a BVN alongside another ID, so with the BVN rule on the BVN is the ID.
    expect(link.mock.calls[0]![0]).toMatchObject({ request: { idType: 'bvn', withBvn: true } });
    expect(link.mock.calls[0]![0]).not.toHaveProperty('idNumber', expect.anything());
    const reference = String(started.body.url).split('/').pop()!;

    // Nothing back yet.
    expect((await request(t.http).post('/v1/agent/application/identity/finish').set(agent.headers)).body.status).toBe(
      'pending',
    );

    // Smile ID's status API confirms the verdict for this check's job.
    const status = vi
      .spyOn(SmileIdIdentityAdapter.prototype as unknown as { jobStatus: (id: string) => Promise<object> }, 'jobStatus')
      .mockResolvedValue({ status: 'clear', user_id: reference });
    const nin = uniqueNin();
    const body = JSON.stringify({
      status: 'clear',
      partner_params: { user_id: reference },
      id_fields: { first_name: 'Tunde', last_name: 'Bakare', date_of_birth: '1995-04-12', id_number: nin },
    });
    const timestamp = new Date().toISOString();
    const sign = (key: string, at = timestamp) =>
      createHmac('sha256', key).update(`${at}1234sid_request`).digest('base64');
    const deliver = (signature: string, payload = body) =>
      request(t.http)
        .post('/v1/webhooks/identity/smileid')
        .set('content-type', 'application/json')
        .set('response-timestamp', timestamp)
        .set('response-signature', signature)
        .set('smileid-job-id', 'job_01')
        .send(payload);
    await deliver(sign('someone-else')).expect(401);
    await deliver(sign('smile-key')).expect(200);
    // Smile ID resending the same callback is fine; the same signature on any other body is a replay.
    await deliver(sign('smile-key')).expect(200);
    await deliver(sign('smile-key'), body.replace('Tunde', 'Someone')).expect(401);
    expect(status).toHaveBeenCalledWith('job_01');
    // Settled at once, keeping only the result: no NIN, no payload.
    const [row] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, agent.userId));
    expect(row).toMatchObject({
      identityProvider: 'smileid',
      legalName: 'TUNDE BAKARE',
      dateOfBirth: '1995-04-12',
      identityOutcome: 'passed',
      pendingIdFingerprint: null,
    });
    expect(row!.idFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(nin);
    const done = await request(t.http).post('/v1/agent/application/identity/finish').set(agent.headers).expect(200);
    expect(done.body).toMatchObject({ status: 'done', outcome: 'passed' });
    // Smile ID's page sends the agent to this page, which opens the agent app.
    await request(t.http)
      .get('/v1/identity/done')
      .expect(200)
      .expect(/jiffo-agent:\/\/identity-done/);

    // A second account on the same NIN goes to support, with the NIN waiting so approval can't take it twice.
    const second = await newAgent();
    const again = await request(t.http)
      .post('/v1/agent/application/identity')
      .set(second.headers)
      .send({ consent: true, idType: 'bvn' })
      .expect(200);
    const secondRef = String(again.body.url).split('/').pop()!;
    status.mockResolvedValue({ status: 'clear', user_id: secondRef });
    const secondBody = body.replace(reference, secondRef);
    // Signed at the same moment as the first, so with the same signature: another job, so both are genuine.
    await request(t.http)
      .post('/v1/webhooks/identity/smileid')
      .set('content-type', 'application/json')
      .set('response-timestamp', timestamp)
      .set('response-signature', sign('smile-key'))
      .set('smileid-job-id', 'job_02')
      .send(secondBody)
      .expect(200);
    const [dup] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, second.userId));
    expect(dup).toMatchObject({
      identityOutcome: 'review',
      idFingerprint: null,
      pendingIdFingerprint: row!.idFingerprint,
    });
    expect(dup!.checks).toContainEqual(expect.objectContaining({ key: 'duplicate', outcome: 'review' }));

    // A result for a check started again since is no longer wanted.
    const fresh = await request(t.http)
      .post('/v1/agent/application/identity')
      .set(second.headers)
      .send({ consent: true, idType: 'bvn' })
      .expect(200);
    expect(String(fresh.body.url)).not.toContain(secondRef);
    status.mockResolvedValue({ status: 'block', user_id: secondRef });
    const latest = new Date(Date.now() + 2000).toISOString();
    await request(t.http)
      .post('/v1/webhooks/identity/smileid')
      .set('content-type', 'application/json')
      .set('response-timestamp', latest)
      .set('response-signature', sign('smile-key', latest))
      .set('smileid-job-id', 'job_02')
      .send(secondBody)
      .expect(200);
    const [after] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, second.userId));
    expect(after!.identityOutcome).toBeNull();
    await switchProvider(t, 'identity', null);
  });

  it("leaves addresses to our team with Smile ID, which doesn't check them", async () => {
    // The ID checked earlier with the development stand-in; then Smile ID is switched on before sending.
    const agent = await signIn(t, 'agent', { unapproved: true });
    await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName: 'Bakare' }).expect(200);
    await completeApplication(t, agent);
    await smileIdOn();
    const sent = await request(t.http).post('/v1/agent/application/submit').set(agent.headers).expect(200);
    expect(sent.body.status).toBe('review');
    expect(sent.body.checks).toContainEqual(expect.objectContaining({ key: 'address', outcome: 'review' }));
    const [row] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, agent.userId));
    expect(row).toMatchObject({ addressProvider: 'smileid', addressOutcome: 'review' });
    await switchProvider(t, 'identity', null);
  });

  it('ignores settings saved for an identity provider Jiffo no longer has, and finishes what was left running', async () => {
    // Saved and switched on by an owner before Dojah was taken out of Jiffo.
    await t.db.insert(providerSettings).values({
      category: 'identity',
      provider: 'dojah',
      active: true,
      config: { appId: 'app-1' },
      secretHints: { secretKey: '••••ab12' },
    });
    const providers = t.app.get(ProvidersService);
    await providers.reload();
    // It counts as not set up: the environment's choice is used, and the panel neither lists it nor shows it on.
    expect(providers.current('identity').name).toBe('fake');
    const listed = await request(t.http).get('/v1/admin/providers').set(owner.headers).expect(200);
    const identity = listed.body.categories.find((c: { category: string }) => c.category === 'identity');
    expect(identity).toMatchObject({ active: null, fallback: 'fake' });
    expect(identity.providers.map((p: { key: string }) => p.key)).toEqual(['smileid']);

    // An identity check left running with it ends as failed, so the agent checks again with the provider in use.
    const agent = await newAgent();
    await t.db
      .update(agentApplications)
      .set({ identityProvider: 'dojah', identityReference: 'jid-retired-1', identityIdType: 'nin' })
      .where(eq(agentApplications.userId, agent.userId));
    await request(t.http).post('/v1/agent/application/identity/finish').set(agent.headers).expect(200);
    const [ended] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, agent.userId));
    expect(ended!.identityOutcome).toBe('failed');
    // Its results are refused the way an unsigned call is: nothing tells a stranger what is set up.
    await request(t.http)
      .post('/v1/webhooks/identity/dojah')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ reference_id: 'jid-retired-1', verification_status: 'Completed' }))
      .expect(401);
    const again = await request(t.http)
      .post('/v1/agent/application/identity')
      .set(agent.headers)
      .send({ consent: true, idType: 'nin', idNumber: uniqueNin(), bvn: '22212345678' })
      .expect(200);
    expect(again.body.provider).toBe('fake');

    // A customer's check left running with Youverify ends as failed, so the app offers a new one.
    const customer = await signIn(t, 'customer', { unverified: true });
    await t.db.insert(customerVerifications).values({
      userId: customer.userId,
      status: 'checking',
      provider: 'youverify',
      reference: `cid-${uniqueNin()}`,
      idType: 'nin',
      updatedAt: new Date(Date.now() - 3_600_000),
    });
    const seen = await request(t.http).get('/v1/me/identity').set(customer.headers).expect(200);
    expect(seen.body.status).toBe('failed');

    // Switching in the panel still works; the old row stays ignored (the migration deletes such rows).
    await switchProvider(t, 'identity', null);
    expect(providers.current('identity').name).toBe('fake');
    await t.db
      .delete(providerSettings)
      .where(and(eq(providerSettings.category, 'identity'), eq(providerSettings.provider, 'dojah')));
  });
});
