import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ATTEST_HEADERS } from '../src/attestation/attestation.types';
import { CountriesService } from '../src/countries/countries.service';
import { agentSelfieChecks, deviceAttestations, devices, errandStops } from '../src/db/schema';
import {
  act,
  adminAs,
  agentWithMoney,
  attestation,
  createErrand,
  createTestApp,
  fund,
  randomPhone,
  signed,
  signIn,
  type TestApp,
} from './helpers';

/**
 * Risk signals (docs/security-plan.md, MB4): the app tells the server what it finds on the phone (root or a
 * jailbreak, an emulator, hooking tools, a debugger), and whether a position is mocked. They are kept, shown
 * to staff, count as a doubtful phone, and a mocked position can't place an agent at a drop-off.
 */
describe('risk signals', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  const enforce = () => {
    const countries = t.app.get(CountriesService);
    const real = countries.currentSettingsIfAny.bind(countries);
    vi.spyOn(countries, 'currentSettingsIfAny').mockImplementation(async (code) => {
      const saved = await real(code);
      return (
        saved && {
          ...saved,
          settings: { ...saved.settings, security: { ...saved.settings.security, attestation: 'enforce' } },
        }
      );
    });
  };
  const withdrawal = () => ({ amountKobo: 100_000, speed: 'scheduled', requestId: randomUUID() });

  it('counts what the app finds on the phone as a doubtful phone, keeps it, and shows it to staff', async () => {
    const agent = await agentWithMoney(t);
    enforce();
    await t.db
      .update(agentSelfieChecks)
      .set({ decidedAt: sql`${agentSelfieChecks.decidedAt} - interval '20 minutes'` })
      .where(eq(agentSelfieChecks.userId, agent.userId));
    const headers = { ...(await attestation(t, agent.installKey!)), [ATTEST_HEADERS.risk]: 'rooted,hooking,nonsense' };
    const res = await signed(t, agent, { attestHeaders: headers }).post('/v1/wallet/withdrawals').send(withdrawal());
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'selfie_needed', reason: 'device_check' });

    const [row] = await t.db
      .select()
      .from(deviceAttestations)
      .where(and(eq(deviceAttestations.deviceKey, agent.installKey!), eq(deviceAttestations.purpose, 'withdrawal')));
    expect(row).toMatchObject({ verdict: 'doubtful', signals: ['rooted', 'hooking'] });

    const ops = await adminAs(t, 'operations');
    const person = (await request(t.http).get(`/v1/admin/people/${agent.userId}`).set(ops.headers).expect(200)).body;
    expect(person.devices).toContainEqual(
      expect.objectContaining({ app: 'agent', riskSignals: ['rooted', 'hooking'] }),
    );
  });

  it("won't place an agent at the drop-off from a mocked position", async () => {
    const agent = await signIn(t, 'agent');
    const customer = await signIn(t, 'customer');
    await fund(t, customer);
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    const [stop] = await t.db
      .select({ lat: errandStops.lat, lng: errandStops.lng })
      .from(errandStops)
      .where(and(eq(errandStops.errandId, errand.id), eq(errandStops.kind, 'dropoff')));
    const report = (mocked: boolean) =>
      request(t.http)
        .put('/v1/agent/presence')
        .set(agent.headers)
        .send({ lat: stop!.lat, lng: stop!.lng, mocked })
        .expect(200);
    const deliver = () =>
      request(t.http)
        .post(`/v1/errands/${errand.id}/events`)
        .set(agent.headers)
        .send({ event: 'mark_delivered', data: {} });
    await report(true);
    const refused = await deliver();
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.error.code).toBe('mock_location');
    await report(false);
    expect((await deliver()).status).toBe(200);
  });

  it("keeps each account's signals to itself on a phone two accounts use", async () => {
    const first = await signIn(t, 'agent');
    // A second account signs in on the same install.
    const phone = randomPhone();
    await request(t.http).post('/v1/auth/otp/request').send({ phone }).expect(200);
    await request(t.http)
      .post('/v1/auth/otp/verify')
      .set(ATTEST_HEADERS.risk, 'emulator')
      .send({
        phone,
        code: t.messaging.lastCodeFor(phone),
        app: 'agent',
        device: { key: first.installKey, platform: 'android' },
      })
      .expect(200);
    const rows = await t.db
      .select({ userId: devices.userId, riskSignals: devices.riskSignals })
      .from(devices)
      .where(eq(devices.deviceKey, first.installKey!));
    expect(rows.find((r) => r.userId === first.userId)?.riskSignals).toEqual([]);
    expect(rows.find((r) => r.userId !== first.userId)?.riskSignals).toEqual(['emulator']);
  });

  it("doesn't show a mocked position to the customer, or search the board around it", async () => {
    const agent = await signIn(t, 'agent');
    const customer = await signIn(t, 'customer');
    await fund(t, customer);
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    await request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, lat: 6.448, lng: 3.47, mocked: true })
      .expect(200);
    const view = (await request(t.http).get(`/v1/errands/${errand.id}`).set(customer.headers).expect(200)).body;
    expect(view.agentLocation ?? null).toBeNull();
    const board = await request(t.http).get('/v1/errands/board?lat=6.4480&lng=3.4700&radiusKm=5').set(agent.headers);
    expect(board.status).toBe(422);
    expect(board.body.error.code).toBe('mock_location');
  });
});
