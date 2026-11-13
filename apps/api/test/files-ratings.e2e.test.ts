import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act, createErrand, createTestApp, fund, photo, signIn, type Person, type TestApp } from './helpers';

describe('photos and ratings', () => {
  let t: TestApp;
  let customer: Person;
  let agent: Person;

  beforeAll(async () => {
    t = await createTestApp();
    [customer, agent] = await Promise.all([signIn(t, 'customer'), signIn(t, 'agent')]);
    await fund(t, customer, 20_000_000);
  });
  afterAll(() => t.close());

  const view = async (person: Person, id: string) =>
    (await request(t.http).get(`/v1/errands/${id}`).set(person.headers).expect(200)).body;
  const fetchLink = (link: string) => {
    const url = new URL(link);
    return request(t.http).get(url.pathname + url.search);
  };
  const deliver = async (id: string) => {
    await act(t, agent, id, 'start');
    await act(t, agent, id, 'mark_delivered');
    const pin = (await request(t.http).get(`/v1/errands/${id}/pin`).set(customer.headers).expect(200)).body.pin;
    await act(t, agent, id, 'confirm_pin', { pin });
  };

  it('lets only the right person upload each kind of photo', async () => {
    const errand = await createErrand(t, customer);
    const upload = (person: Person, purpose: string) =>
      request(t.http)
        .post('/v1/uploads')
        .set(person.headers)
        .send({ errandId: errand.id, purpose, contentType: 'image/jpeg', size: 8 });
    expect((await upload(agent, 'receipt').expect(404)).body.error.code).toBe('errand_not_found'); // not their errand yet
    // Nothing to photograph before an agent accepts.
    expect((await upload(customer, 'chat_photo').expect(409)).body.error.code).toBe('uploads_closed');
    await act(t, agent, errand.id, 'accept');
    expect((await upload(customer, 'receipt').expect(403)).body.error.code).toBe('upload_not_allowed');
    await upload(customer, 'chat_photo').expect(201);
    await upload(agent, 'receipt').expect(201);
    const bad = await request(t.http)
      .post('/v1/uploads')
      .set(agent.headers)
      .send({ errandId: errand.id, purpose: 'receipt', contentType: 'application/pdf', size: 8 })
      .expect(422);
    expect(bad.body.error.code).toBe('unsupported_file');
    const huge = await request(t.http)
      .post('/v1/uploads')
      .set(agent.headers)
      .send({ errandId: errand.id, purpose: 'receipt', contentType: 'image/jpeg', size: 50 * 1024 * 1024 })
      .expect(422);
    expect(huge.body.error.code).toBe('photo_too_large');

    // The size is signed into the link: a different size is refused, as S3 would.
    const ticket = (await upload(agent, 'item_photo').expect(201)).body;
    const url = new URL(ticket.upload.url);
    await request(t.http)
      .put(url.pathname + url.search)
      .set('content-type', 'image/jpeg')
      .send(Buffer.alloc(20))
      .expect(403);

    await act(t, customer, errand.id, 'cancel');
    expect((await upload(customer, 'chat_photo').expect(409)).body.error.code).toBe('uploads_closed');
  });

  it('answers strangers and wrong states before looking at photos', async () => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    const stranger = await signIn(t, 'agent');
    expect((await act(t, stranger, errand.id, 'send_dropoff_photo', { photo: 'x' }, 404)).error.code).toBe(
      'errand_not_found',
    );
    expect((await act(t, agent, errand.id, 'send_dropoff_photo', { photo: 'x' }, 409)).error.code).toBe(
      'errand_invalid_state',
    );
  });

  it('accepts only photos the agent really uploaded for this errand', async () => {
    const errand = await createErrand(t, customer, { categoryKey: 'groceries' });
    const other = await createErrand(t, customer, { categoryKey: 'groceries' });
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, other.id, 'accept');
    await act(t, agent, errand.id, 'start');

    // Reserved but never uploaded.
    const reserved = await request(t.http)
      .post('/v1/uploads')
      .set(agent.headers)
      .send({ errandId: errand.id, purpose: 'receipt', contentType: 'image/jpeg', size: 8 })
      .expect(201);
    const send = (photos: string[], status: number) =>
      act(t, agent, errand.id, 'send_item_amount', { amountKobo: 500_000, photos }, status);
    expect((await send([reserved.body.key], 422)).error.code).toBe('photo_not_uploaded');
    expect((await send([await photo(t, agent, other.id, 'receipt')], 422)).error.code).toBe('photo_not_uploaded');
    expect((await send(['errands/made-up.jpg'], 422)).error.code).toBe('photo_not_uploaded');

    const receipt = await photo(t, agent, errand.id, 'receipt');
    const items = await photo(t, agent, errand.id, 'item_photo');
    await send([receipt, items], 200);

    // The customer sees both through short-lived links; a stranger can't get the errand at all.
    const seen = await view(customer, errand.id);
    expect(seen.photos.items).toHaveLength(2);
    const file = await fetchLink(seen.photos.items[0]).expect(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    const tampered = seen.photos.items[0].replace(/sig=[0-9a-f]+/, 'sig=' + '0'.repeat(64));
    await fetchLink(tampered).expect(403);
  });

  it('shows the drop-off photo to approve', async () => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'mark_delivered');
    await act(t, agent, errand.id, 'send_dropoff_photo', { photo: await photo(t, agent, errand.id, 'dropoff_photo') });
    const seen = await view(customer, errand.id);
    expect(seen.status).toBe('photo_pending');
    await fetchLink(seen.photos.dropoff).expect(200);
  });

  it('sends photos in chat', async () => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    const key = await photo(t, customer, errand.id, 'chat_photo');
    const sent = await request(t.http)
      .post(`/v1/errands/${errand.id}/messages`)
      .set(customer.headers)
      .send({ photo: key, clientId: 'p1' })
      .expect(201);
    expect(sent.body).toMatchObject({ kind: 'photo', body: '', photoUrl: expect.stringContaining('/v1/dev-files/') });
    const thread = await request(t.http).get(`/v1/errands/${errand.id}/messages`).set(agent.headers).expect(200);
    const message = thread.body.messages.find((m: { kind: string }) => m.kind === 'photo');
    await fetchLink(message.photoUrl).expect(200);
    // Someone else's photo can't be sent.
    const theirs = await photo(t, agent, errand.id, 'receipt');
    await request(t.http)
      .post(`/v1/errands/${errand.id}/messages`)
      .set(customer.headers)
      .send({ photo: theirs, clientId: 'p2' })
      .expect(422);
    await request(t.http)
      .post(`/v1/errands/${errand.id}/messages`)
      .set(customer.headers)
      .send({ clientId: 'p3' })
      .expect(400);
  });

  it('takes one rating each way after completion', async () => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    const rate = (person: Person, body: Record<string, unknown>) =>
      request(t.http).post(`/v1/errands/${errand.id}/rating`).set(person.headers).send(body);
    expect((await rate(customer, { stars: 5 }).expect(409)).body.error.code).toBe('rating_not_available');
    await deliver(errand.id);

    expect(await view(customer, errand.id)).toMatchObject({ ratedByMe: false, tipped: false });
    await request(t.http)
      .post(`/v1/errands/${errand.id}/tip`)
      .set(customer.headers)
      .send({ amountKobo: 20_000 })
      .expect(201);
    expect((await view(customer, errand.id)).tipped).toBe(true);
    expect((await rate(customer, { stars: 5, comment: '  Fast and careful  ' }).expect(201)).body).toEqual({
      stars: 5,
      comment: 'Fast and careful',
    });
    expect((await rate(customer, { stars: 4 }).expect(409)).body.error.code).toBe('already_rated');
    expect((await view(customer, errand.id)).ratedByMe).toBe(true);
    expect((await view(agent, errand.id)).ratedByMe).toBe(false);
    await rate(agent, { stars: 4 }).expect(201);
    await rate(agent, { stars: 6 }).expect(400);
    const stranger = await signIn(t, 'customer');
    await rate(stranger, { stars: 1 }).expect(404);

    // Each side's account shows the rating the other side gave, in that app's role.
    const stats = async (person: Person) =>
      (await request(t.http).get('/v1/me/stats').set(person.headers).expect(200)).body;
    expect(await stats(agent)).toMatchObject({ ratingAvg: 5, ratingCount: 1 });
    expect(await stats(customer)).toMatchObject({ ratingAvg: 4, ratingCount: 1 });
    expect((await stats(customer)).errandsCompleted).toBeGreaterThanOrEqual(1);
    expect(await stats(stranger)).toEqual({ ratingAvg: null, ratingCount: 0, errandsCompleted: 0, disputes: 0 });
  });
});
