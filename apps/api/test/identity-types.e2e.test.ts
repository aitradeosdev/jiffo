import { createHmac, hkdfSync } from 'node:crypto';
import { and, eq, gt } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SmileIdIdentityAdapter } from '../src/adapters/identity-providers';
import { agentApplications, customerVerifications, providerSettings, settingsVersions } from '../src/db/schema';
import { ProvidersService } from '../src/providers/providers.service';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config';
import { adminAs, createTestApp, errandBody, signIn, type Person, type TestApp } from './helpers';

/** An ID number that is new on every run, ending in the fake provider's code for the path wanted. */
const unique = (prefix: string, length: number, ending = '4567') =>
  `${prefix}${String(Date.now())
    .slice(-(length - prefix.length - 4))
    .padStart(length - prefix.length - 4, '0')}${ending}`;

describe('identity checks: ID types, and customers', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let original: { version: number; settings: { identity: Record<string, unknown> } };

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    original = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
  });
  afterAll(async () => {
    await t.db
      .delete(settingsVersions)
      .where(and(eq(settingsVersions.countryCode, 'NG'), gt(settingsVersions.version, original.version)));
    await t.db.delete(providerSettings);
    await t.app.get(ProvidersService).reload();
    await t.close();
  });

  /** Saves the identity settings with these changes, as admin does in the panel. */
  async function identitySettings(changes: Record<string, unknown>) {
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    Object.assign(settings.identity, changes);
    await request(t.http)
      .post('/v1/admin/settings?country=NG')
      .set(owner.headers)
      .send({ basedOn: now.version, settings, note: 'ID types for a test' })
      .expect(200);
  }

  const me = (who: Person) => request(t.http).get('/v1/me/identity').set(who.headers);
  const start = (who: Person, body: object) =>
    request(t.http)
      .post('/v1/me/identity')
      .set(who.headers)
      .send({ consent: true, ...body });
  const finish = (who: Person) => request(t.http).post('/v1/me/identity/finish').set(who.headers);
  async function customer() {
    const who = await signIn(t, 'customer', { unverified: true });
    await request(t.http).patch('/v1/me').set(who.headers).send({ lastName: 'Okafor' }).expect(200);
    return who;
  }

  it('keeps money and errands closed until a customer is verified, then opens them', async () => {
    const who = await customer();
    expect((await me(who).expect(200)).body).toMatchObject({
      status: 'none',
      flow: 'numbers',
      // A customer gives their NIN or BVN and takes a selfie; documents are for agents.
      idTypes: [
        { key: 'nin', name: 'NIN slip or card' },
        { key: 'bvn', name: 'BVN' },
      ],
    });
    await request(t.http)
      .post('/v1/wallet/deposits')
      .set(who.headers)
      .send({ amountKobo: 500_000 })
      .expect(403)
      .expect(/identity_required/);
    await request(t.http)
      .post('/v1/errands')
      .set(who.headers)
      .send(errandBody())
      .expect(403)
      .expect(/identity_required/);

    // A document isn't how customers verify, and a number that isn't a BVN's.
    await start(who, { idType: 'passport', idNumber: 'A12345678' })
      .expect(400)
      .expect(/invalid_id_type/);
    await start(who, { idType: 'bvn', idNumber: '12' })
      .expect(400)
      .expect(/invalid_id/);
    const bvn = unique('2', 11);
    await start(who, { idType: 'bvn', idNumber: bvn }).expect(200);
    expect((await finish(who).expect(200)).body).toEqual({ status: 'verified', outcome: 'passed' });
    const view = (await me(who).expect(200)).body;
    expect(view).toMatchObject({
      status: 'verified',
      idType: 'bvn',
      legalName: 'ADA OKAFOR',
      startedFlow: 'numbers',
    });
    expect(view.checks.map((c: { key: string }) => c.key)).toEqual(['bvn', 'selfie', 'age']);
    const [row] = await t.db.select().from(customerVerifications).where(eq(customerVerifications.userId, who.userId));
    expect(row!.idFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(bvn);
    await request(t.http).post('/v1/wallet/deposits').set(who.headers).send({ amountKobo: 500_000 }).expect(201);
    await start(who, { idType: 'nin', idNumber: '12345674567' })
      .expect(409)
      .expect(/already_verified/);

    // A second account on the same BVN goes to support; someone under 18 doesn't pass.
    const second = await customer();
    await start(second, { idType: 'bvn', idNumber: bvn }).expect(200);
    expect((await finish(second).expect(200)).body.status).toBe('review');
    expect((await me(second)).body.checks).toContainEqual(
      expect.objectContaining({ key: 'duplicate', outcome: 'review' }),
    );
    const young = await customer();
    await start(young, { idType: 'nin', idNumber: unique('5', 11, '1818') }).expect(200);
    expect((await finish(young).expect(200)).body.status).toBe('failed');
  });

  it('offers agents the IDs admin accepts, with their BVN checked alongside', async () => {
    await identitySettings({ agentIdTypes: ['nin', 'drivers_licence'], requireBvnForAgents: true });
    const agent = await signIn(t, 'agent', { unapproved: true });
    await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName: 'Bakare' }).expect(200);
    const view = (await request(t.http).get('/v1/agent/application').set(agent.headers).expect(200)).body;
    expect(view).toMatchObject({ withBvn: true, idTypes: [{ key: 'nin' }, { key: 'drivers_licence' }] });
    const begin = (body: object) =>
      request(t.http)
        .post('/v1/agent/application/identity')
        .set(agent.headers)
        .send({ consent: true, ...body });
    await begin({ idType: 'passport', idNumber: 'A12345678' })
      .expect(400)
      .expect(/invalid_id_type/);
    await begin({ idType: 'drivers_licence', idNumber: 'LAG12345AA12' })
      .expect(400)
      .expect(/invalid_bvn/);
    await begin({ idType: 'drivers_licence', idNumber: unique('LAG', 12), bvn: '22212345678' }).expect(200);
    const done = await request(t.http).post('/v1/agent/application/identity/finish').set(agent.headers).expect(200);
    expect(done.body.status).toBe('done');
    expect(done.body.checks.map((c: { key: string }) => c.key)).toEqual(['drivers_licence', 'bvn', 'selfie']);
    const [row] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, agent.userId));
    expect(row).toMatchObject({ identityIdType: 'drivers_licence', identityWithBvn: true, identityOutcome: 'passed' });
    // The app reads how the check was started, which stays even if admin changes the settings after.
    const after = (await request(t.http).get('/v1/agent/application').set(agent.headers).expect(200)).body;
    expect(after).toMatchObject({
      identityIdType: 'drivers_licence',
      identityWithBvn: true,
      identityStartedFlow: 'numbers',
    });

    // The BVN as the ID itself: checked once, not twice.
    const second = await signIn(t, 'agent', { unapproved: true });
    await request(t.http).patch('/v1/me').set(second.headers).send({ lastName: 'Bakare' }).expect(200);
    await identitySettings({ agentIdTypes: ['bvn'], requireBvnForAgents: true });
    await request(t.http)
      .post('/v1/agent/application/identity')
      .set(second.headers)
      .send({ consent: true, idType: 'bvn', idNumber: unique('2', 11) })
      .expect(200);
    const bvnOnly = await request(t.http).post('/v1/agent/application/identity/finish').set(second.headers).expect(200);
    expect(bvnOnly.body.checks.map((c: { key: string }) => c.key)).toEqual(['bvn', 'selfie']);
    await identitySettings({ agentIdTypes: ['nin', 'bvn'], requireBvnForAgents: true });
  });

  it('still knows NINs fingerprinted before other IDs, so a second account on one is caught', async () => {
    const config = t.app.get<AppConfig>(APP_CONFIG);
    const key = Buffer.from(
      hkdfSync('sha256', Buffer.from(config.PIN_KEY, 'hex'), Buffer.alloc(0), 'jiffo nin fingerprint', 32),
    );
    const nin = unique('7', 11);
    const earlier = await signIn(t, 'agent');
    await t.db
      .update(agentApplications)
      .set({ idFingerprint: createHmac('sha256', key).update(nin).digest('hex') })
      .where(eq(agentApplications.userId, earlier.userId));
    const agent = await signIn(t, 'agent', { unapproved: true });
    await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName: 'Bakare' }).expect(200);
    // An earlier version of the app: the NIN alone, no ID type.
    await request(t.http)
      .post('/v1/agent/application/identity')
      .set(agent.headers)
      .send({ consent: true, nin, bvn: '22212345678' })
      .expect(200);
    const done = await request(t.http).post('/v1/agent/application/identity/finish').set(agent.headers).expect(200);
    expect(done.body.checks).toContainEqual(expect.objectContaining({ key: 'duplicate', outcome: 'review' }));
  });

  it("with Smile ID, which can't check a BVN alongside, agents verify with their BVN; customers' results come home", async () => {
    const panel = (method: 'put' | 'post', path: string) =>
      request(t.http)[method](`/v1/admin/providers${path}`).set(owner.headers);
    await panel('put', '/identity/smileid')
      .send({
        config: { partnerId: '1234', privacyPolicyUrl: 'https://jiffo.test/privacy', mode: 'sandbox' },
        secrets: { apiKey: 'smile-key' },
      })
      .expect(200);
    vi.spyOn(SmileIdIdentityAdapter.prototype, 'check').mockResolvedValue('Connected');
    await panel('post', '/identity/smileid/test').expect(200);
    await panel('post', '/identity/active').send({ provider: 'smileid' }).expect(200);

    // Admin accepts only the NIN from agents, but requires their BVN: with Smile ID the BVN is the ID.
    await identitySettings({ agentIdTypes: ['nin'], requireBvnForAgents: true });
    const agent = await signIn(t, 'agent', { unapproved: true });
    await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName: 'Bakare' }).expect(200);
    const view = (await request(t.http).get('/v1/agent/application').set(agent.headers).expect(200)).body;
    expect(view).toMatchObject({ provider: 'Smile ID', identityFlow: 'hosted', idTypes: [{ key: 'bvn' }] });

    // A customer's check started on Smile ID's page, and its result sent to the webhook.
    const who = await customer();
    expect((await me(who)).body.idTypes.map((i: { key: string }) => i.key)).toEqual(['nin', 'bvn']);
    const link = vi
      .spyOn(SmileIdIdentityAdapter.prototype, 'startIdentity')
      .mockImplementation(async ({ reference }) => ({ reference, url: `https://links.smile.test/${reference}` }));
    const started = await start(who, { idType: 'nin' }).expect(200);
    expect(link.mock.calls.at(-1)![0].request).toEqual({ idType: 'nin', withBvn: false });
    const reference = String(started.body.url).split('/').pop()!;
    expect(reference).toMatch(/^cid-/);
    vi.spyOn(
      SmileIdIdentityAdapter.prototype as unknown as { jobStatus: () => Promise<object> },
      'jobStatus',
    ).mockResolvedValue({ status: 'clear', user_id: reference });
    const timestamp = new Date().toISOString();
    await request(t.http)
      .post('/v1/webhooks/identity/smileid')
      .set('content-type', 'application/json')
      .set('response-timestamp', timestamp)
      .set(
        'response-signature',
        createHmac('sha256', 'smile-key').update(`${timestamp}1234sid_request`).digest('base64'),
      )
      .set('smileid-job-id', 'job_9')
      .send(
        JSON.stringify({
          partner_params: { user_id: reference },
          id_fields: {
            full_name: 'Ada Okafor',
            date_of_birth: '1990-01-02',
            id_number: unique('6', 11),
          },
        }),
      )
      .expect(200);
    expect((await me(who)).body).toMatchObject({ status: 'verified', idType: 'nin', legalName: 'ADA OKAFOR' });

    // The agent's app of before sends no ID type: the only one on offer, the BVN, is meant.
    const agentStart = await request(t.http)
      .post('/v1/agent/application/identity')
      .set(agent.headers)
      .send({ consent: true })
      .expect(200);
    const agentRef = String(agentStart.body.url).split('/').pop()!;
    vi.spyOn(
      SmileIdIdentityAdapter.prototype as unknown as { jobStatus: () => Promise<object> },
      'jobStatus',
    ).mockResolvedValue({ status: 'clear', user_id: agentRef });
    const at = new Date().toISOString();
    await request(t.http)
      .post('/v1/webhooks/identity/smileid')
      .set('content-type', 'application/json')
      .set('response-timestamp', at)
      .set('response-signature', createHmac('sha256', 'smile-key').update(`${at}1234sid_request`).digest('base64'))
      .set('smileid-job-id', 'job_10')
      .send(
        JSON.stringify({
          partner_params: { user_id: agentRef },
          id_fields: { full_name: 'Tunde Bakare', date_of_birth: '1990-01-02', id_number: unique('2', 11) },
        }),
      )
      .expect(200);
    const [app] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, agent.userId));
    // A BVN the rule made the ID isn't flagged as an ID admin doesn't accept.
    expect(app).toMatchObject({ identityIdType: 'bvn', identityOutcome: 'passed' });
    expect(app!.checks.map((c) => c.key)).toEqual(['bvn', 'selfie']);
    await identitySettings({ agentIdTypes: ['nin', 'bvn'], requireBvnForAgents: true });
    // The page at the end sends a customer back to the customer app.
    await request(t.http)
      .get('/v1/identity/done?for=customer')
      .expect(200)
      .expect(/jiffo:\/\/identity-done/);
    await panel('post', '/identity/active').send({ provider: null }).expect(200);
  });
});
