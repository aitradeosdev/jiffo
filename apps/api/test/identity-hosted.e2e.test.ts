import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DojahIdentityAdapter, SmileIdIdentityAdapter } from '../src/adapters/identity-providers';
import { agentApplications, providerSettings } from '../src/db/schema';
import { ProvidersService } from '../src/providers/providers.service';
import { adminAs, createTestApp, signIn, uniqueNin, type Person, type TestApp } from './helpers';

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
    await panel('put', '/identity/smileid')
      .send({
        config: { partnerId: '1234', privacyPolicyUrl: 'https://jiffo.test/privacy', mode: 'sandbox' },
        secrets: { apiKey: 'smile-key' },
      })
      .expect(200);
    vi.spyOn(SmileIdIdentityAdapter.prototype, 'check').mockResolvedValue('Connected');
    await panel('post', '/identity/smileid/test').expect(200);
    await panel('post', '/identity/active').send({ provider: 'smileid' }).expect(200);

    const agent = await newAgent();
    const view = await request(t.http).get('/v1/agent/application').set(agent.headers).expect(200);
    expect(view.body).toMatchObject({ identityFlow: 'hosted', provider: 'Smile ID' });
    const link = vi
      .spyOn(SmileIdIdentityAdapter.prototype, 'startIdentity')
      .mockImplementation(async ({ reference }) => ({ reference, url: `https://links.smile.test/${reference}` }));
    const started = await request(t.http)
      .post('/v1/agent/application/identity')
      .set(agent.headers)
      .send({ consent: true })
      .expect(200);
    expect(started.body).toMatchObject({
      provider: 'smileid',
      url: expect.stringMatching(/^https:\/\/links\.smile\.test\/jid-/),
    });
    expect(link.mock.calls[0]![0]).not.toHaveProperty('nin');
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
    const sign = (key: string) => createHmac('sha256', key).update(`${timestamp}1234sid_request`).digest('base64');
    const deliver = (signature: string) =>
      request(t.http)
        .post('/v1/webhooks/identity/smileid')
        .set('content-type', 'application/json')
        .set('response-timestamp', timestamp)
        .set('response-signature', signature)
        .set('smileid-job-id', 'job_01')
        .send(body);
    await deliver(sign('someone-else')).expect(401);
    await deliver(sign('smile-key')).expect(200);
    expect(status).toHaveBeenCalledWith('job_01');
    // Settled at once, keeping only the result: no NIN, no payload.
    const [row] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, agent.userId));
    expect(row).toMatchObject({
      identityProvider: 'smileid',
      legalName: 'TUNDE BAKARE',
      dateOfBirth: '1995-04-12',
      identityOutcome: 'passed',
      pendingNinFingerprint: null,
    });
    expect(row!.ninFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(nin);
    const done = await request(t.http).post('/v1/agent/application/identity/finish').set(agent.headers).expect(200);
    expect(done.body).toMatchObject({ status: 'done', outcome: 'passed' });

    // A second account on the same NIN goes to support, with the NIN waiting so approval can't take it twice.
    const second = await newAgent();
    const again = await request(t.http)
      .post('/v1/agent/application/identity')
      .set(second.headers)
      .send({ consent: true })
      .expect(200);
    const secondRef = String(again.body.url).split('/').pop()!;
    status.mockResolvedValue({ status: 'clear', user_id: secondRef });
    const secondBody = body.replace(reference, secondRef);
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
      ninFingerprint: null,
      pendingNinFingerprint: row!.ninFingerprint,
    });
    expect(dup!.checks).toContainEqual(expect.objectContaining({ key: 'duplicate', outcome: 'review' }));

    // A result for a check started again since is no longer wanted.
    const fresh = await request(t.http)
      .post('/v1/agent/application/identity')
      .set(second.headers)
      .send({ consent: true })
      .expect(200);
    expect(String(fresh.body.url)).not.toContain(secondRef);
    status.mockResolvedValue({ status: 'block', user_id: secondRef });
    await request(t.http)
      .post('/v1/webhooks/identity/smileid')
      .set('content-type', 'application/json')
      .set('response-timestamp', timestamp)
      .set('response-signature', sign('smile-key'))
      .set('smileid-job-id', 'job_02')
      .send(secondBody)
      .expect(200);
    const [after] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, second.userId));
    expect(after!.identityOutcome).toBeNull();
    await panel('post', '/identity/active').send({ provider: null }).expect(200);
  });

  it("serves Dojah's widget page only for a link the API signed", async () => {
    await panel('put', '/identity/dojah')
      .send({
        config: { appId: 'app-1', publicKey: 'pk-1', widgetId: 'widget-1' },
        secrets: { secretKey: 'sk-1', webhookSecret: 'hook-1' },
      })
      .expect(200);
    vi.spyOn(DojahIdentityAdapter.prototype, 'check').mockResolvedValue('Connected');
    await panel('post', '/identity/dojah/test').expect(200);
    await panel('post', '/identity/active').send({ provider: 'dojah' }).expect(200);

    const agent = await newAgent();
    const started = await request(t.http)
      .post('/v1/agent/application/identity')
      .set(agent.headers)
      .send({ consent: true })
      .expect(200);
    const url = new URL(started.body.url);
    const page = await request(t.http)
      .get(url.pathname + url.search)
      .expect(200);
    expect(page.headers['content-type']).toMatch(/html/);
    expect(page.text).toContain('"widget_id":"widget-1"');
    expect(page.text).not.toContain('sk-1');
    url.searchParams.set('sig', '0'.repeat(32));
    await request(t.http)
      .get(url.pathname + url.search)
      .expect(404);
    await request(t.http)
      .get('/v1/identity/done')
      .expect(200)
      .expect(/jiffo-agent:\/\/identity-done/);
    await panel('post', '/identity/active').send({ provider: null }).expect(200);
  });
});
