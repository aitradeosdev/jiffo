import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { MAPS, type MapsAdapter } from '../src/adapters/maps';
import { adminAs, createTestApp, type TestApp } from './helpers';

/**
 * Settings, Places: the panel's map goes to the state picked, and to a new city once its name is typed, so it can be
 * drawn there. The maps provider in use finds them by name, with the box to show; the panel never calls it itself.
 */
describe('finding a state or city on the map', () => {
  let t: TestApp;
  let support: Awaited<ReturnType<typeof adminAs>>;

  beforeAll(async () => {
    t = await createTestApp();
    support = await adminAs(t, 'support');
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(() => t.close());

  const locate = (query: Record<string, string>, as = support) =>
    request(t.http).get('/v1/admin/places/locate').query(query).set(as.headers);

  it('finds it through the maps provider, in the country asked about', async () => {
    const maps = t.app.get<MapsAdapter>(MAPS);
    const asked = vi.spyOn(maps, 'locate').mockResolvedValue({
      name: 'Kano',
      lat: 12,
      lng: 8.52,
      bounds: { west: 7.6, south: 10.3, east: 9.4, north: 12.7 },
    });
    const found = await locate({ country: 'ng', kind: 'state', q: '  Kano State ' }).expect(200);
    expect(found.body).toEqual({
      name: 'Kano',
      lat: 12,
      lng: 8.52,
      bounds: { west: 7.6, south: 10.3, east: 9.4, north: 12.7 },
    });
    expect(asked).toHaveBeenCalledWith({ query: 'Kano State', countryCode: 'NG', kind: 'state' });
  });

  it('works with the development stand-in, which knows a few Lagos places', async () => {
    const found = await locate({ country: 'NG', kind: 'city', q: 'Ikeja, Lagos State' }).expect(200);
    expect(found.body).toMatchObject({ lat: expect.any(Number), lng: expect.any(Number), bounds: null });
  });

  it('answers not found when the provider finds nothing', async () => {
    const missing = await locate({ country: 'NG', kind: 'city', q: 'Atlantis' }).expect(404);
    expect(missing.body.error.code).toBe('place_not_found');
  });

  it('takes only a short name and a known kind', async () => {
    const maps = t.app.get<MapsAdapter>(MAPS);
    const asked = vi.spyOn(maps, 'locate');
    await locate({ country: 'NG', kind: 'city', q: 'I' }).expect(400);
    await locate({ country: 'NG', kind: 'city', q: 'x'.repeat(121) }).expect(400);
    await locate({ country: 'NG', kind: 'street', q: 'Ikeja' }).expect(400);
    await locate({ country: 'NGA', kind: 'city', q: 'Ikeja' }).expect(400);
    await locate({ kind: 'city', q: 'Ikeja' }).expect(400);
    expect(asked).not.toHaveBeenCalled();
  });

  it('is for signed-in admins only', async () => {
    await request(t.http).get('/v1/admin/places/locate?country=NG&kind=city&q=Ikeja').expect(401);
  });
});
