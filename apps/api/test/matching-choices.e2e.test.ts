import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { act, createErrand, createTestApp, fund, LAGOS_STOPS, signIn, type Person, type TestApp } from './helpers';

const PICKUP = { lat: LAGOS_STOPS[0]!.lat, lng: LAGOS_STOPS[0]!.lng };

/**
 * What agents and customers choose about matching (docs/matching.md, M1): how far an agent will travel, and
 * "Don't match me again", which either side can choose on an errand they shared.
 */
describe('matching choices', () => {
  let t: TestApp;
  let customer: Person;

  beforeAll(async () => {
    t = await createTestApp();
    customer = await signIn(t, 'customer');
    await fund(t, customer, 50_000_000);
  });
  afterAll(() => t.close());

  const online = (agent: Person, at = PICKUP) =>
    request(t.http)
      .put('/v1/agent/presence')
      .set(agent.headers)
      .send({ online: true, ...at })
      .expect(200);
  const accept = (agent: Person, id: string) =>
    request(t.http).post(`/v1/errands/${id}/events`).set(agent.headers).send({ event: 'accept' });
  const onBoard = async (agent: Person, id: string, at = PICKUP) => {
    const res = await request(t.http)
      .get(`/v1/errands/board?lat=${at.lat}&lng=${at.lng}&radiusKm=50`)
      .set(agent.headers)
      .expect(200);
    return (res.body.errands as Array<{ id: string }>).some((e) => e.id === id);
  };
  const preferences = (agent: Person, body: Record<string, unknown>) =>
    request(t.http).patch('/v1/agent/profile').set(agent.headers).send(body);
  const noMatch = (who: Person, id: string) => request(t.http).put(`/v1/errands/${id}/no-match`).set(who.headers);
  const matchAgain = (who: Person, id: string) => request(t.http).delete(`/v1/errands/${id}/no-match`).set(who.headers);
  const view = async (who: Person, id: string) =>
    (await request(t.http).get(`/v1/errands/${id}`).set(who.headers).expect(200)).body as { noMatch?: boolean };

  describe("the agent's work radius", () => {
    it('keeps the board and accepting to how far the agent said they would travel', async () => {
      const agent = await signIn(t, 'agent');
      // About 4.4 km east of the pickup.
      const east = { lat: PICKUP.lat, lng: PICKUP.lng + 0.04 };
      await online(agent, east);
      const errand = await createErrand(t, customer);
      expect(await onBoard(agent, errand.id, east)).toBe(true);

      expect((await preferences(agent, { workRadiusKm: 3 }).expect(200)).body.workRadiusKm).toBe(3);
      expect(await onBoard(agent, errand.id, east)).toBe(false);
      // The board says how far it reaches for this agent.
      const shown = await request(t.http)
        .get(`/v1/errands/board?lat=${east.lat}&lng=${east.lng}&radiusKm=50`)
        .set(agent.headers)
        .expect(200);
      expect(shown.body.reachKm).toBe(3);
      expect((await accept(agent, errand.id)).body.error.code).toBe('too_far');

      await preferences(agent, { workRadiusKm: 5 }).expect(200);
      expect((await accept(agent, errand.id)).status).toBe(200);
    });

    it('is 1 to 50 whole kilometres, or none for as far as Jiffo allows', async () => {
      const agent = await signIn(t, 'agent');
      // A new agent goes as far as Jiffo allows.
      expect((await request(t.http).get('/v1/agent/profile').set(agent.headers).expect(200)).body.workRadiusKm).toBe(
        null,
      );
      for (const bad of [0, 51, 2.5, '5']) await preferences(agent, { workRadiusKm: bad }).expect(400);
      await preferences(agent, { workRadiusKm: 8 }).expect(200);
      expect((await preferences(agent, { workRadiusKm: null }).expect(200)).body.workRadiusKm).toBeNull();
    });
  });

  describe("Don't match me again", () => {
    it('lets a customer choose not to be matched with an agent again, and change their mind', async () => {
      const agent = await signIn(t, 'agent');
      const other = await signIn(t, 'agent');
      for (const a of [agent, other]) await online(a);
      const first = await createErrand(t, customer);
      await act(t, agent, first.id, 'accept');

      expect((await noMatch(customer, first.id).expect(200)).body).toEqual({ noMatch: true });
      expect((await view(customer, first.id)).noMatch).toBe(true);
      // The agent isn't told.
      expect((await view(agent, first.id)).noMatch).toBe(false);

      const next = await createErrand(t, customer);
      expect(await onBoard(agent, next.id)).toBe(false);
      expect((await accept(agent, next.id)).body.error.code).toBe('unavailable');
      expect(await onBoard(other, next.id)).toBe(true);

      expect((await matchAgain(customer, first.id).expect(200)).body).toEqual({ noMatch: false });
      expect(await onBoard(agent, next.id)).toBe(true);
      expect((await accept(agent, next.id)).status).toBe(200);
    });

    it('lets an agent choose not to be matched with a customer again', async () => {
      const agent = await signIn(t, 'agent');
      await online(agent);
      const first = await createErrand(t, customer);
      await act(t, agent, first.id, 'accept');
      await noMatch(agent, first.id).expect(200);
      expect((await view(agent, first.id)).noMatch).toBe(true);
      expect((await view(customer, first.id)).noMatch).toBe(false);

      const next = await createErrand(t, customer);
      expect(await onBoard(agent, next.id)).toBe(false);
      expect((await accept(agent, next.id)).body.error.code).toBe('unavailable');
    });

    it('is only for the two people on the errand, once both are on it', async () => {
      const errand = await createErrand(t, customer);
      // No agent yet: nobody to keep apart from.
      expect((await noMatch(customer, errand.id)).body.error.code).toBe('no_agent');
      const agent = await signIn(t, 'agent');
      await act(t, agent, errand.id, 'accept');
      const stranger = await signIn(t, 'agent');
      await noMatch(stranger, errand.id).expect(404);
      await matchAgain(stranger, errand.id).expect(404);
      // Choosing it twice is the same choice.
      await noMatch(customer, errand.id).expect(200);
      await noMatch(customer, errand.id).expect(200);
    });
  });
});
