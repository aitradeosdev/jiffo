import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, signIn, type Person, type TestApp } from './helpers';

describe('places and quotes', () => {
  let t: TestApp;
  let customer: Person;

  beforeAll(async () => {
    t = await createTestApp();
    customer = await signIn(t, 'customer');
  });
  afterAll(() => t.close());

  it('searches places and returns their coordinates', async () => {
    const res = await request(t.http).get('/v1/places/autocomplete?q=lekki').set(customer.headers).expect(200);
    expect(res.body.map((p: { title: string }) => p.title)).toEqual(
      expect.arrayContaining(['Shoprite', 'Medplus Pharmacy', '12 Admiralty Way']),
    );
    const place = await request(t.http).get(`/v1/places/${res.body[0].placeId}`).set(customer.headers).expect(200);
    expect(place.body).toMatchObject({
      placeId: res.body[0].placeId,
      lat: expect.any(Number),
      lng: expect.any(Number),
      stateCode: 'LA',
    });
    expect(place.body.region).toBeUndefined();
    await request(t.http).get('/v1/places/nope').set(customer.headers).expect(404);
    await request(t.http).get('/v1/places/autocomplete?q=x').set(customer.headers).expect(400);
    await request(t.http).get('/v1/places/autocomplete?q=lekki').expect(401);
  });

  it('quotes a fee from the route, never below the minimum', async () => {
    const lekkiToVi = await request(t.http)
      .post('/v1/errands/quote')
      .set(customer.headers)
      .send({
        stops: [
          { lat: 6.4474, lng: 3.4723 },
          { lat: 6.4311, lng: 3.4158 },
        ],
      })
      .expect(200);
    // About 6.5 km straight, 8.5 km by the estimate: ₦500 + ₦200 × 8.5 ≈ ₦2,200.
    expect(lekkiToVi.body).toMatchObject({ minFeeKobo: 100_000, distanceMeters: expect.any(Number) });
    expect(lekkiToVi.body.distanceMeters).toBeGreaterThan(8_000);
    expect(lekkiToVi.body.suggestedFeeKobo % 10_000).toBe(0);
    expect(lekkiToVi.body.suggestedFeeKobo).toBeGreaterThan(200_000);
    expect(lekkiToVi.body.serviceFeeKobo).toBe(Math.round(lekkiToVi.body.suggestedFeeKobo / 10));

    const nextDoor = await request(t.http)
      .post('/v1/errands/quote')
      .set(customer.headers)
      .send({
        stops: [
          { lat: 6.4474, lng: 3.4723 },
          { lat: 6.4475, lng: 3.4724 },
        ],
      })
      .expect(200);
    expect(nextDoor.body.suggestedFeeKobo).toBe(100_000);
  });
});
