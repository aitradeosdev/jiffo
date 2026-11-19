import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { APP_CONFIG, type AppConfig } from '../src/config/app-config';
import { CountriesService } from '../src/countries/countries.service';
import { agentSelfieChecks, deviceAttestations, otpChallenges } from '../src/db/schema';
import {
  act,
  agentWithMoney,
  attestation,
  createErrand,
  createTestApp,
  fund,
  passSelfie,
  randomPhone,
  signed,
  signIn,
  type TestApp,
} from './helpers';

/**
 * App attestation (docs/security-plan.md, MB3): Play Integrity and App Attest show a request comes from our
 * store app on a real phone, over a single-use code. Recorded by default; when Settings, Security enforce it,
 * sign-in, withdrawals, payout account changes and going online need it, and a doubtful phone takes a selfie.
 */
describe('app attestation', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** Settings, Security, as enforcing, with any other security settings given. */
  const enforce = (extra: Record<string, unknown> = {}) => {
    const countries = t.app.get(CountriesService);
    const real = countries.currentSettingsIfAny.bind(countries);
    vi.spyOn(countries, 'currentSettingsIfAny').mockImplementation(async (code) => {
      const saved = await real(code);
      return (
        saved && {
          ...saved,
          settings: { ...saved.settings, security: { ...saved.settings.security, attestation: 'enforce', ...extra } },
        }
      );
    });
  };
  const recorded = (installKey: string) =>
    t.db.select().from(deviceAttestations).where(eq(deviceAttestations.deviceKey, installKey));
  const codeFor = async (phone: string) => {
    await request(t.http).post('/v1/auth/otp/request').send({ phone }).expect(200);
    return t.messaging.lastCodeFor(phone)!;
  };
  const verify = (
    phone: string,
    code: string,
    installKey: string,
    headers: Record<string, string> = {},
    app = 'agent',
  ) =>
    request(t.http)
      .post('/v1/auth/otp/verify')
      .set(headers)
      .send({ phone, code, app, device: { key: installKey, platform: 'android' } });
  const refused = (res: request.Response, code: string) => {
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error.code).toBe(code);
  };

  it('records each check, and refuses or waits for nothing, until Settings say to enforce it', async () => {
    const agent = await signIn(t, 'agent');
    // Checked alongside, so a slow provider never holds up a mode that refuses nothing.
    await vi.waitFor(async () =>
      expect(await recorded(agent.installKey!)).toEqual([
        expect.objectContaining({
          purpose: 'sign_in',
          verdict: 'missing',
          app: 'agent',
          platform: 'android',
        }),
      ]),
    );
  });

  it('refuses sign-in without a check, a failed one, or one for another install, after the code', async () => {
    enforce();
    const tryWith = async (installKey: string, headers: Record<string, string> = {}, code?: string) => {
      const phone = randomPhone();
      return verify(phone, code ?? (await codeFor(phone)), installKey, headers);
    };
    const installKey = randomUUID();
    refused(await tryWith(installKey), 'attestation_failed');
    refused(await tryWith(installKey, await attestation(t, installKey, 'failed')), 'attestation_failed');
    // A code given to another install.
    refused(await tryWith(installKey, await attestation(t, randomUUID())), 'attestation_failed');
    // Nothing reaches the provider without a right sign-in code first: no check, nothing recorded.
    const phone = randomPhone();
    await codeFor(phone);
    const wrongCode = await verify(phone, '000000', installKey, await attestation(t, installKey));
    expect(wrongCode.status).toBe(400);
    const headers = await attestation(t, installKey);
    await tryWith(installKey, headers).then((r) => expect(r.status).toBe(200));
    // An attestation's code works once.
    refused(await tryWith(installKey, headers), 'attestation_failed');
    const rows = await recorded(installKey);
    expect(rows.map((r) => r.verdict).sort()).toEqual(['failed', 'failed', 'failed', 'missing', 'trusted']);
  });

  it("asks a doubtful agent's phone for a selfie before money moves, rather than refusing it", async () => {
    const agent = await agentWithMoney(t);
    enforce();
    const withdrawal = () => ({ amountKobo: 100_000, speed: 'scheduled', requestId: randomUUID() });
    const usedCodes = async () =>
      (
        (
          await t.db.execute(
            sql`select count(*)::int as n from device_challenges c join devices d on d.id = c.device_id where d.user_id = ${agent.userId} and c.used_at is not null`,
          )
        ).rows[0] as { n: number }
      ).n;
    const before = await usedCodes();
    // Asked for the PIN first, the app sends the same check again: it isn't used up by that.
    const headers = await attestation(t, agent.installKey!);
    refused(
      await signed(t, agent, { pin: null, attestHeaders: headers }).post('/v1/wallet/withdrawals').send(withdrawal()),
      'pin_missing',
    );
    expect(await usedCodes()).toBe(before);
    refused(await signed(t, agent).post('/v1/wallet/withdrawals').send(withdrawal()), 'attestation_failed');
    refused(
      await signed(t, agent, { attest: 'failed' }).post('/v1/wallet/withdrawals').send(withdrawal()),
      'attestation_failed',
    );
    // Refused before the phone's signing code is used.
    expect(await usedCodes()).toBe(before);

    // A doubtful phone: a selfie in the last few minutes first.
    await t.db
      .update(agentSelfieChecks)
      .set({ decidedAt: sql`${agentSelfieChecks.decidedAt} - interval '20 minutes'` })
      .where(eq(agentSelfieChecks.userId, agent.userId));
    const doubtful = await signed(t, agent, { attest: 'doubtful' }).post('/v1/wallet/withdrawals').send(withdrawal());
    refused(doubtful, 'selfie_needed');
    expect(doubtful.body.error.reason).toBe('device_check');
    await passSelfie(t, agent);
    await signed(t, agent, { attest: 'doubtful' }).post('/v1/wallet/withdrawals').send(withdrawal()).expect(201);
    // The check asked for the PIN before is still good, and goes straight through to the day's one free
    // withdrawal, which is taken.
    const trusted = await signed(t, agent, { attestHeaders: headers })
      .post('/v1/wallet/withdrawals')
      .send(withdrawal());
    expect(trusted.body.error.code).toBe('scheduled_withdrawal_exists');
  });

  it('checks going online, not staying online, and asks a doubtful phone for a selfie', async () => {
    const agent = await signIn(t, 'agent');
    enforce({ dailySelfie: false });
    const online = (headers: Record<string, string> = {}, on = true) =>
      request(t.http)
        .put('/v1/agent/presence')
        .set(agent.headers)
        .set(headers)
        .send({ online: on, lat: 6.448, lng: 3.47 });
    refused(await online(), 'attestation_failed');
    await online(await attestation(t, agent.installKey!)).expect(200);
    // The heartbeat while online carries none, and needs none.
    await online().expect(200);
    await online({}, false).expect(200);

    await t.db
      .update(agentSelfieChecks)
      .set({ decidedAt: sql`${agentSelfieChecks.decidedAt} - interval '20 minutes'` })
      .where(eq(agentSelfieChecks.userId, agent.userId));
    const doubtful = await online(await attestation(t, agent.installKey!, 'doubtful'));
    refused(doubtful, 'selfie_needed');
    expect(doubtful.body.error.reason).toBe('device_check');
    await passSelfie(t, agent);
    await online(await attestation(t, agent.installKey!, 'doubtful')).expect(200);
  });

  it("asks for the day's selfie before using up the check, and keeps an agent on an errand sharing", async () => {
    const agent = await signIn(t, 'agent', { noSelfie: true });
    const busy = await signIn(t, 'agent');
    const customer = await signIn(t, 'customer');
    await fund(t, customer);
    const errand = await createErrand(t, customer);
    await act(t, busy, errand.id, 'accept');
    enforce();
    const online = (headers: Record<string, string> = {}) =>
      request(t.http)
        .put('/v1/agent/presence')
        .set(agent.headers)
        .set(headers)
        .send({ online: true, lat: 6.448, lng: 3.47 });
    const headers = await attestation(t, agent.installKey!);
    refused(await online(headers), 'selfie_needed');
    await passSelfie(t, agent);
    await online(headers).expect(200);

    // On an errand, a failed check keeps them offline but sharing where they are, for that customer.
    const res = await request(t.http)
      .put('/v1/agent/presence')
      .set(busy.headers)
      .send({ online: true, lat: 6.448, lng: 3.47 })
      .expect(200);
    expect(res.body).toMatchObject({ online: false, sharingLocation: true });
  });

  it("marks a doubtful phone at an agent's sign-in, so money needs a selfie on it", async () => {
    enforce();
    const phone = randomPhone();
    const installKey = randomUUID();
    const res = await verify(phone, await codeFor(phone), installKey, await attestation(t, installKey, 'doubtful'));
    expect(res.status).toBe(200);
    const rows = await t.db.execute(
      sql`select selfie_needed from devices where device_key = ${installKey} and app = 'agent'`,
    );
    expect(rows.rows).toEqual([{ selfie_needed: true }]);
  });

  it('never takes the development stand-in in production', async () => {
    enforce();
    const config = t.app.get<AppConfig>(APP_CONFIG);
    const phone = randomPhone();
    const code = await codeFor(phone);
    const installKey = randomUUID();
    const headers = await attestation(t, installKey);
    const before = config.NODE_ENV;
    try {
      config.NODE_ENV = 'production';
      // Nothing is set up for Android here, so the check is unavailable, and refused.
      refused(await verify(phone, code, installKey, headers), 'attestation_failed');
    } finally {
      config.NODE_ENV = before;
    }
    expect((await recorded(installKey)).map((r) => r.verdict)).toEqual(['unavailable']);
    await t.db.delete(otpChallenges).where(eq(otpChallenges.phone, phone));
  });

  it("says iPhone checks aren't set up, rather than taking a key it can't check", async () => {
    const installKey = randomUUID();
    const { nonce } = (await request(t.http).post('/v1/attestation/challenge').send({ deviceKey: installKey })).body;
    const res = await request(t.http)
      .post('/v1/attestation/apple-key')
      .send({ deviceKey: installKey, app: 'agent', keyId: 'a'.repeat(44), attestation: 'b'.repeat(100), nonce });
    refused(res, 'attestation_unavailable');
  });
});
