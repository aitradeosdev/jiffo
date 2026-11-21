import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeMapsAdapter } from '../src/adapters/maps';
import { adminAudit, errands } from '../src/db/schema';
import { adminAs, createTestApp, errandBody, fund, signIn, type Person, type TestApp } from './helpers';

/** A closed ring from [lng, lat] corners, as GeoJSON wants it. */
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

// Ibadan, Oyo State, well away from the Lagos area every other test file uses.
const IBADAN = box(3.8, 7.3, 4.05, 7.5);
const BODIJA = box(3.9, 7.41, 3.94, 7.45);
const IN_BODIJA = [
  { kind: 'pickup', label: 'Shop', address: 'Bodija Market, Ibadan', lat: 7.43, lng: 3.915 },
  { kind: 'dropoff', label: 'Home', address: 'Awolowo Avenue, Bodija, Ibadan', lat: 7.425, lng: 3.92 },
];
// In Ibadan, but in no area drawn there.
const OUTSIDE_AREAS = { kind: 'dropoff', label: 'Home', address: 'Apata, Ibadan', lat: 7.35, lng: 3.85 };

/**
 * Where Jiffo works: country, state, city and area. Admin draws each city and area on a map and switches each on;
 * an errand is taken only when every stop is inside an area that is on, in a city, state and country that are on.
 * The server works out the pickup's area and state itself, rather than taking the app's word for them.
 */
describe('service areas', () => {
  let t: TestApp;
  let owner: Awaited<ReturnType<typeof adminAs>>;
  let customer: Person;
  let oyo: { id: string };

  const admin = (method: 'get' | 'post' | 'patch', path: string, as = owner) =>
    request(t.http)[method](`/v1/admin${path}`).set(as.headers);
  const send = (stops: unknown[], extra: Record<string, unknown> = {}) =>
    request(t.http)
      .post('/v1/errands')
      .set(customer.headers)
      .send(errandBody({ stops, ...extra }));

  beforeAll(async () => {
    t = await createTestApp();
    owner = await adminAs(t, 'owner');
    customer = await signIn(t, 'customer');
    await fund(t, customer);
    const states = (await admin('get', '/states?country=NG').expect(200)).body as Array<{ id: string; code: string }>;
    oyo = states.find((s) => s.code === 'OY')!;
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await t.close();
  });

  let ibadan: { id: string };
  let bodija: { id: string };

  it('are drawn by admin as cities in a state and areas in a city, each starting off, and audited', async () => {
    ibadan = (await admin('post', '/cities').send({ stateId: oyo.id, name: 'Ibadan', boundary: IBADAN }).expect(201))
      .body;
    expect(ibadan).toMatchObject({ name: 'Ibadan', enabled: false });
    bodija = (await admin('post', '/areas').send({ cityId: ibadan.id, name: 'Bodija', boundary: BODIJA }).expect(201))
      .body;
    expect(bodija).toMatchObject({ name: 'Bodija', enabled: false });

    const listed = (await admin('get', '/service-areas?country=NG').expect(200)).body;
    const state = listed.states.find((s: { code: string }) => s.code === 'OY');
    expect(state.cities).toEqual([
      expect.objectContaining({
        id: ibadan.id,
        name: 'Ibadan',
        enabled: false,
        boundary: expect.objectContaining({ type: 'MultiPolygon' }),
        areas: [expect.objectContaining({ id: bodija.id, name: 'Bodija', enabled: false })],
      }),
    ]);
    const audited = await t.db.select().from(adminAudit).where(eq(adminAudit.targetId, bodija.id));
    expect(audited.map((a) => a.action)).toEqual(['area.create']);
  });

  it('take errands only once the area, its city and its state are all on', async () => {
    const refused = await send(IN_BODIJA);
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({ code: 'outside_service_area', stops: [0, 1] });

    await admin('patch', `/areas/${bodija.id}`).send({ enabled: true }).expect(200);
    expect((await send(IN_BODIJA)).body.error.code).toBe('outside_service_area');
    await admin('patch', `/cities/${ibadan.id}`).send({ enabled: true }).expect(200);
    await admin('patch', `/states/${oyo.id}`).send({ enabled: false }).expect(200);
    expect((await send(IN_BODIJA)).body.error.code).toBe('outside_service_area');
    await admin('patch', `/states/${oyo.id}`).send({ enabled: true }).expect(200);

    // The app said Lagos: the server goes by where the pickup is.
    const sent = await send(IN_BODIJA, { stateCode: 'LA' });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.stateCode).toBe('OY');
    const [row] = await t.db.select().from(errands).where(eq(errands.id, sent.body.id));
    expect(row!.areaId).toBe(bodija.id);
  });

  it('refuse an errand with any stop outside the areas, naming which', async () => {
    const res = await send([IN_BODIJA[0], OUTSIDE_AREAS]);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'outside_service_area', stops: [1] });
  });

  it('stop taking new errands when switched off, leaving those already sent', async () => {
    const before = (await send(IN_BODIJA).expect(201)).body;
    await admin('patch', `/areas/${bodija.id}`).send({ enabled: false }).expect(200);
    expect((await send(IN_BODIJA)).body.error.code).toBe('outside_service_area');
    const still = await request(t.http).get(`/v1/errands/${before.id}`).set(customer.headers).expect(200);
    expect(still.body.status).toBe('requested');
    await admin('patch', `/areas/${bodija.id}`).send({ enabled: true }).expect(200);
  });

  it('refuse boundaries that cross themselves, areas outside their city, and areas or cities that overlap', async () => {
    const crossing = {
      type: 'Polygon',
      coordinates: [
        [
          [3.9, 7.4],
          [3.95, 7.45],
          [3.95, 7.4],
          [3.9, 7.45],
          [3.9, 7.4],
        ],
      ],
    };
    const code = async (res: request.Test) => (await res).body.error?.code;
    expect(await code(admin('post', '/areas').send({ cityId: ibadan.id, name: 'Knot', boundary: crossing }))).toBe(
      'invalid_boundary',
    );
    expect(
      await code(
        admin('post', '/areas').send({ cityId: ibadan.id, name: 'Oyo town', boundary: box(3.9, 7.8, 3.95, 7.85) }),
      ),
    ).toBe('area_outside_city');
    expect(
      await code(
        admin('post', '/areas').send({ cityId: ibadan.id, name: 'UI', boundary: box(3.92, 7.43, 3.96, 7.47) }),
      ),
    ).toBe('areas_overlap');
    expect(
      await code(
        admin('post', '/cities').send({ stateId: oyo.id, name: 'Ibadan North', boundary: box(3.9, 7.4, 4.1, 7.6) }),
      ),
    ).toBe('cities_overlap');
    // A city can't be redrawn to leave one of its areas outside.
    expect(await code(admin('patch', `/cities/${ibadan.id}`).send({ boundary: box(3.8, 7.3, 3.85, 7.35) }))).toBe(
      'area_outside_city',
    );
    // Areas next to each other are fine.
    await admin('post', '/areas')
      .send({ cityId: ibadan.id, name: 'Agodi', boundary: box(3.94, 7.41, 3.98, 7.45) })
      .expect(201);
  });

  it('are changed only by those who may change settings', async () => {
    const ops = await adminAs(t, 'operations');
    await admin('get', '/service-areas?country=NG', ops).expect(200);
    await admin('post', '/areas', ops).send({ cityId: ibadan.id, name: 'Mokola', boundary: BODIJA }).expect(403);
    await admin('patch', `/areas/${bodija.id}`, ops).send({ enabled: false }).expect(403);
  });

  it("tell the app a picked place's state only where Jiffo works there", async () => {
    const pick = (placeId: string) => request(t.http).get(`/v1/places/${placeId}`).set(customer.headers).expect(200);
    // The fake maps provider's Lagos places: inside the area every test run has there.
    expect((await pick('fake-shoprite-lekki')).body.stateCode).toBe('LA');
    const at = (lat: number, lng: number) =>
      vi.spyOn(FakeMapsAdapter.prototype, 'place').mockResolvedValueOnce({
        placeId: 'p-1',
        name: 'Somewhere',
        address: 'Ibadan',
        lat,
        lng,
        // What the provider says is never taken for where Jiffo works.
        region: 'Oyo',
      });
    at(IN_BODIJA[0]!.lat, IN_BODIJA[0]!.lng);
    expect((await pick('p-1')).body).toMatchObject({ stateCode: 'OY', areaId: bodija.id });
    at(OUTSIDE_AREAS.lat, OUTSIDE_AREAS.lng);
    expect((await pick('p-1')).body).toMatchObject({ stateCode: null, areaId: null });
  });
});
