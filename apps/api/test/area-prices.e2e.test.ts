import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FEE_STEP_KOBO } from '@jiffo/shared';
import { errands } from '../src/db/schema';
import { adminAs, approved, createTestApp, errandBody, fund, signIn, type Person, type TestApp } from './helpers';

const box = (west: number, south: number, east: number, north: number) => ({
  type: 'Polygon' as const,
  coordinates: [
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
      [west, south],
    ],
  ],
});

// Kano, away from the Lagos area the other test files price errands in.
const KANO = box(8.4, 11.9, 8.65, 12.1);
const SABON_GARI = box(8.5, 11.99, 8.54, 12.03);
const STOPS = [
  { kind: 'pickup', label: 'Shop', address: 'Sabon Gari Market, Kano', lat: 12.0, lng: 8.51 },
  { kind: 'dropoff', label: 'Home', address: 'Sabon Gari, Kano', lat: 12.02, lng: 8.53 },
];

/**
 * Prices per state, city and area (Settings, Places): the base fee, the rate per km, the minimum fee and the
 * service fee can each be set for a state, a city or an area. What one leaves out comes from the level above, then
 * the country's settings. Each change needs a second admin's approval, and an errand keeps the prices it was sent
 * with.
 */
describe('area prices', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let customer: Person;
  let ids: { state: string; city: string; area: string };

  const admin = (method: 'get' | 'post' | 'patch', path: string, as = owner) =>
    request(t.http)[method](`/v1/admin${path}`).set(as.headers);
  const at = (stops: Array<{ lat: number; lng: number }>) => stops.map(({ lat, lng }) => ({ lat, lng }));
  const quote = () =>
    request(t.http)
      .post('/v1/errands/quote')
      .set(customer.headers)
      .send({ stops: at(STOPS) });
  /** The prices saved for one place now: their version, to change them from. */
  async function saved(scope: 'state' | 'city' | 'area', id: string) {
    const listed = (await admin('get', '/service-areas?country=NG').expect(200)).body;
    const state = listed.states.find((s: { code: string }) => s.code === 'KN');
    const place =
      scope === 'state'
        ? state
        : scope === 'city'
          ? state.cities.find((c: { id: string }) => c.id === id)
          : state.cities.flatMap((c: { areas: unknown[] }) => c.areas).find((a: { id: string }) => a.id === id);
    return place.prices as { version: number; data: Record<string, number> };
  }
  async function setPrices(scope: 'state' | 'city' | 'area', id: string, prices: Record<string, number>) {
    const { version } = await saved(scope, id);
    return approved(t, 'owner', (h) =>
      request(t.http)
        .post('/v1/admin/prices')
        .set(h)
        .send({ scope, id, basedOn: version, prices, note: 'Prices for a test' }),
    );
  }

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    // Another owner, so a price change waits for one of them to approve it.
    await adminAs(t, 'owner');
    customer = await signIn(t, 'customer');
    await fund(t, customer);
    const states = (await admin('get', '/states?country=NG').expect(200)).body as Array<{ id: string; code: string }>;
    const state = states.find((s) => s.code === 'KN')!.id;
    const city = (await admin('post', '/cities').send({ stateId: state, name: 'Kano', boundary: KANO }).expect(201))
      .body.id;
    const area = (
      await admin('post', '/areas').send({ cityId: city, name: 'Sabon Gari', boundary: SABON_GARI }).expect(201)
    ).body.id;
    await admin('patch', `/cities/${city}`).send({ enabled: true }).expect(200);
    await admin('patch', `/areas/${area}`).send({ enabled: true }).expect(200);
    ids = { state, city, area };
  });
  afterAll(() => t.close());

  it("are the country's until a state, city or area sets its own", async () => {
    const listed = (await admin('get', '/service-areas?country=NG').expect(200)).body;
    expect(listed.countryPrices).toEqual({
      baseFeeKobo: 50_000,
      ratePerKmKobo: 20_000,
      minFeeKobo: 100_000,
      serviceFeeBps: 1_000,
      serviceFeeMinKobo: 10_000,
      serviceFeeCapKobo: 100_000,
    });
    expect(await saved('area', ids.area)).toEqual({ version: 0, data: {} });
    const q = await quote();
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body).toMatchObject({ minFeeKobo: 100_000 });
  });

  it('wait for a second admin, then take each value from the nearest level that sets it', async () => {
    // One admin alone asks; nothing changes until another approves.
    const { version } = await saved('state', ids.state);
    const asked = await request(t.http)
      .post('/v1/admin/prices')
      .set(owner.headers)
      .send({ scope: 'state', id: ids.state, basedOn: version, prices: { ratePerKmKobo: 30_000 }, note: 'Kano rate' });
    expect(asked.status).toBe(202);
    expect((await saved('state', ids.state)).data).toEqual({});

    expect((await setPrices('state', ids.state, { ratePerKmKobo: 30_000, serviceFeeBps: 800 })).status).toBe(200);
    expect((await setPrices('city', ids.city, { baseFeeKobo: 70_000 })).status).toBe(200);
    expect((await setPrices('area', ids.area, { minFeeKobo: 150_000 })).status).toBe(200);
    const priced = (await quote().expect(200)).body;
    expect(priced.minFeeKobo).toBe(150_000);
    // 70,000 base + 30,000 a km, at least 150,000; the service fee at 8%.
    const expected = Math.max(70_000 + Math.round((30_000 * priced.distanceMeters) / 1000), 150_000);
    expect(priced.suggestedFeeKobo).toBe(Math.ceil(expected / FEE_STEP_KOBO) * FEE_STEP_KOBO);
    expect(priced.serviceFeeKobo).toBe(Math.min(Math.max(Math.round(priced.suggestedFeeKobo * 0.08), 10_000), 100_000));
  });

  it('are kept by an errand when they change after it was sent', async () => {
    const sent = (
      await request(t.http)
        .post('/v1/errands')
        .set(customer.headers)
        .send(errandBody({ stops: STOPS, feeKobo: 200_000 }))
        .expect(201)
    ).body;
    expect(sent.serviceFeeKobo).toBe(16_000);
    const [row] = await t.db.select().from(errands).where(eq(errands.id, sent.id));
    expect(row!.prices).toMatchObject({ minFeeKobo: 150_000, serviceFeeBps: 800 });

    expect((await setPrices('area', ids.area, { minFeeKobo: 150_000, serviceFeeBps: 2_000 })).status).toBe(200);
    // Raising the fee on the errand already sent: its own 8%, not the new 20%.
    const raised = await request(t.http)
      .post(`/v1/errands/${sent.id}/events`)
      .set(customer.headers)
      .send({ event: 'raise_fee', version: sent.version, data: { amountKobo: 300_000 } })
      .expect(200);
    expect(raised.body.serviceFeeKobo).toBe(24_000);
    // A new errand uses the new price.
    const next = (
      await request(t.http)
        .post('/v1/errands')
        .set(customer.headers)
        .send(errandBody({ stops: STOPS, feeKobo: 200_000 }))
        .expect(201)
    ).body;
    expect(next.serviceFeeKobo).toBe(40_000);
  });

  it('go back to the level above when cleared', async () => {
    expect((await setPrices('area', ids.area, {})).status).toBe(200);
    expect((await quote().expect(200)).body.minFeeKobo).toBe(100_000);
  });

  it('are refused when the result would not work, here or in a city or area below', async () => {
    const area = await setPrices('area', ids.area, { serviceFeeMinKobo: 50_000 });
    expect(area.status).toBe(200);
    // A state cap under the area's minimum would leave the area's service fee unworkable.
    const state = await setPrices('state', ids.state, {
      ratePerKmKobo: 30_000,
      serviceFeeBps: 800,
      serviceFeeCapKobo: 40_000,
    });
    expect(state.status).toBe(400);
    expect(state.body.error.code).toBe('invalid_prices');
    expect(state.body.error.message).toMatch(/Sabon Gari/);
  });

  it("can't be broken by a change to the country's settings they fall back to", async () => {
    // Sabon Gari sets only a service fee minimum (50,000, from the test above); the cap comes from the country.
    const now = (await request(t.http).get('/v1/admin/settings?country=NG').set(owner.headers).expect(200)).body;
    const settings = structuredClone(now.settings);
    settings.fees.serviceFeeCapKobo = 40_000;
    const saved = await approved(t, 'owner', (h) =>
      request(t.http)
        .post('/v1/admin/settings?country=NG')
        .set(h)
        .send({ basedOn: now.version, settings, note: 'A lower cap' }),
    );
    expect(saved.status).toBe(400);
    expect(JSON.stringify(saved.body.error.issues)).toMatch(/Sabon Gari/);
  });

  it("are checked one change at a time, so two approved together can't break a place between them", async () => {
    const area = await saved('area', ids.area);
    const state = await saved('state', ids.state);
    const [a, b] = await Promise.all([
      approved(t, 'owner', (h) =>
        request(t.http)
          .post('/v1/admin/prices')
          .set(h)
          .send({
            scope: 'area',
            id: ids.area,
            basedOn: area.version,
            prices: { serviceFeeMinKobo: 60_000 },
            note: 'A higher service fee minimum',
          }),
      ),
      approved(t, 'owner', (h) =>
        request(t.http)
          .post('/v1/admin/prices')
          .set(h)
          .send({
            scope: 'state',
            id: ids.state,
            basedOn: state.version,
            prices: { ...state.data, serviceFeeCapKobo: 55_000 },
            note: 'A lower service fee cap',
          }),
      ),
    ]);
    // Either can go first; whichever comes second sees the first, and is refused.
    expect([a.status, b.status].sort(), JSON.stringify([a.body, b.body])).toEqual([200, 400]);
    expect([a, b].find((r) => r.status === 400)!.body.error.code).toBe('invalid_prices');
    const listed = (await admin('get', '/service-areas?country=NG').expect(200)).body;
    const kano = listed.states.find((s: { code: string }) => s.code === 'KN');
    const min = kano.cities[0].areas[0].prices.data.serviceFeeMinKobo ?? 10_000;
    const cap = kano.prices.data.serviceFeeCapKobo ?? 100_000;
    expect(min).toBeLessThanOrEqual(cap);
  });

  it('are told to the apps: with a quote, and with each errand, which keeps its own', async () => {
    const q = (await quote().expect(200)).body;
    expect(q.prices).toEqual(
      expect.objectContaining({ minFeeKobo: expect.any(Number), serviceFeeBps: expect.any(Number) }),
    );
    const sent = (
      await request(t.http)
        .post('/v1/errands')
        .set(customer.headers)
        .send(errandBody({ stops: STOPS, feeKobo: 200_000 }))
        .expect(201)
    ).body;
    expect(sent.prices).toEqual(q.prices);
  });

  it('refuse a change made from prices that changed since they were read', async () => {
    const stale = await approved(t, 'owner', (h) =>
      request(t.http)
        .post('/v1/admin/prices')
        .set(h)
        .send({ scope: 'city', id: ids.city, basedOn: 0, prices: { baseFeeKobo: 60_000 }, note: 'Stale' }),
    );
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('prices_changed');
  });

  it('take only the price fields, and only from those who may change settings', async () => {
    const odd = await request(t.http)
      .post('/v1/admin/prices')
      .set(owner.headers)
      .send({ scope: 'area', id: ids.area, basedOn: 0, prices: { commissionBps: 1 }, note: 'Odd' });
    expect(odd.status).toBe(400);
    const ops = await adminAs(t, 'operations');
    await request(t.http)
      .post('/v1/admin/prices')
      .set(ops.headers)
      .send({ scope: 'area', id: ids.area, basedOn: 0, prices: {}, note: 'Ops' })
      .expect(403);
  });

  it('are quoted only where Jiffo works', async () => {
    const outside = await request(t.http)
      .post('/v1/errands/quote')
      .set(customer.headers)
      .send({ stops: at([{ lat: 9.0765, lng: 7.3986 }, STOPS[1]!]) });
    expect(outside.status).toBe(422);
    expect(outside.body.error).toMatchObject({ code: 'outside_service_area', stops: [0] });
  });
});
