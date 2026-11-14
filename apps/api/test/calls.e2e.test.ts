import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CallsUnavailable } from '../src/adapters/calls';
import { ChatService } from '../src/chat/chat.service';
import { errandCalls, errands, providerSettings } from '../src/db/schema';
import { AfricasTalkingCallsAdapter } from '../src/adapters/calls';
import { ProvidersService } from '../src/providers/providers.service';
import { act, adminAs, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

describe('masked calls', () => {
  let t: TestApp;
  let customer: Person;

  beforeAll(async () => {
    t = await createTestApp();
    customer = await signIn(t, 'customer');
    await fund(t, customer, 5_000_000);
  });
  afterAll(() => t.close());

  /** An errand an agent has accepted. */
  async function accepted() {
    const agent = await signIn(t, 'agent');
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    return { agent, errand };
  }
  const call = (person: Person, errandId: string) =>
    request(t.http).post(`/v1/errands/${errandId}/call`).set(person.headers);

  it("rings the caller's phone and connects them, leaving a note in the chat", async () => {
    const { agent, errand } = await accepted();
    const res = await call(customer, errand.id).expect(200);
    expect(res.body).toEqual({ callId: expect.any(String), status: 'ringing' });
    expect(t.calls.calls.at(-1)).toEqual({ reference: res.body.callId, from: customer.phone, to: agent.phone });
    const chat = await request(t.http).get(`/v1/errands/${errand.id}/messages`).set(agent.headers).expect(200);
    expect(chat.body.messages.at(-1)).toMatchObject({ kind: 'system', body: 'Ada called Tunde' });
    // The agent can call back.
    await call(agent, errand.id).expect(200);
    expect(t.calls.calls.at(-1)).toMatchObject({ from: agent.phone, to: customer.phone });
  });

  it('answers a second tap with the first call rather than ringing twice, and limits calls per hour', async () => {
    const { errand } = await accepted();
    await call(customer, errand.id).expect(200);
    const again = await call(customer, errand.id);
    expect(again.status).toBe(429);
    expect(again.body.error).toMatchObject({ code: 'call_just_placed', retryAfterSeconds: expect.any(Number) });
    // Nine more, spread over the last hour, make ten.
    const [first] = await t.db.select().from(errandCalls).where(eq(errandCalls.errandId, errand.id));
    await t.db.insert(errandCalls).values(
      Array.from({ length: 9 }, (_, i) => ({
        ...first!,
        id: undefined,
        createdAt: new Date(Date.now() - (i + 2) * 60_000),
      })),
    );
    await t.db
      .update(errandCalls)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(errandCalls.id, first!.id));
    expect((await call(customer, errand.id)).body.error.code).toBe('too_many_calls');
  });

  it('only connects the two people on the errand, while an agent is on it', async () => {
    const waiting = await createErrand(t, customer);
    expect((await call(customer, waiting.id)).body.error.code).toBe('call_not_available');
    const { agent, errand } = await accepted();
    const stranger = await signIn(t, 'agent');
    expect((await call(stranger, errand.id)).status).toBe(404);
    const other = await signIn(t, 'customer');
    expect((await call(other, errand.id)).status).toBe(404);
    // Finished the real way, so its money is settled.
    await act(t, agent, errand.id, 'start');
    await act(t, agent, errand.id, 'mark_delivered');
    const pin = (await request(t.http).get(`/v1/errands/${errand.id}/pin`).set(customer.headers).expect(200)).body.pin;
    await act(t, agent, errand.id, 'confirm_pin', { pin });
    expect((await call(customer, errand.id)).body.error.code).toBe('call_not_available');
  });

  it('answers that the phone is ringing even if the chat note fails afterwards', async () => {
    const { errand } = await accepted();
    const chat = t.app.get(ChatService);
    const spy = vi.spyOn(chat, 'system').mockRejectedValueOnce(new Error('chat is down'));
    const res = await call(customer, errand.id);
    spy.mockRestore();
    expect(res.status).toBe(200);
    const [row] = await t.db.select().from(errandCalls).where(eq(errandCalls.errandId, errand.id));
    expect(row).toMatchObject({ id: res.body.callId, providerRef: expect.stringMatching(/^fake_call_/) });
  });

  it("says when calls aren't available, and keeps nothing", async () => {
    const { errand } = await accepted();
    const spy = vi.spyOn(t.calls, 'bridge').mockRejectedValueOnce(new CallsUnavailable());
    const res = await call(customer, errand.id);
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('calls_unavailable');
    expect(await t.db.select().from(errandCalls).where(eq(errandCalls.errandId, errand.id))).toEqual([]);
    // Not counted as a call: trying again rings at once.
    await call(customer, errand.id).expect(200);
  });

  describe("with Africa's Talking switched on", () => {
    const owner = () => adminAs(t, 'owner');
    afterAll(async () => {
      await t.db.delete(providerSettings);
      await t.app.get(ProvidersService).reload();
    });

    it('connects the answered call to the other person, and only through the secret address', async () => {
      const admin = await owner();
      const panel = (method: 'put' | 'post', path: string) =>
        request(t.http)[method](`/v1/admin/providers${path}`).set(admin.headers);
      await panel('put', '/calls/africastalking')
        .send({ config: { username: 'jiffo', phoneNumber: '+2342017001000' }, secrets: { apiKey: 'at-key' } })
        .expect(200);
      vi.spyOn(AfricasTalkingCallsAdapter.prototype, 'check').mockResolvedValue('Connected');
      await panel('post', '/calls/africastalking/test').expect(200);
      await panel('post', '/calls/active').send({ provider: 'africastalking' }).expect(200);
      const listed = await request(t.http).get('/v1/admin/providers').set(admin.headers).expect(200);
      const url: string = listed.body.categories
        .find((c: { category: string }) => c.category === 'calls')
        .providers.find((p: { key: string }) => p.key === 'africastalking').webhookUrl;
      const path = new URL(url).pathname;
      expect(path).toMatch(/^\/v1\/webhooks\/calls\/africastalking\/[0-9a-f]{32}$/);

      const { agent, errand } = await accepted();
      const bridge = vi
        .spyOn(AfricasTalkingCallsAdapter.prototype, 'bridge')
        .mockResolvedValue({ providerRef: 'ATVId_42' });
      await call(customer, errand.id).expect(200);
      expect(bridge).toHaveBeenCalledWith(expect.objectContaining({ from: customer.phone, to: agent.phone }));

      const answer = (body: Record<string, string>, at = path) => request(t.http).post(at).type('form').send(body);
      const res = await answer({ isActive: '1', sessionId: 'ATVId_42', direction: 'Outbound' }).expect(200);
      expect(res.headers['content-type']).toMatch(/xml/);
      expect(res.text).toContain(`<Dial phoneNumbers="${agent.phone}" callerId="+2342017001000" record="false"/>`);
      expect((await answer({ isActive: '1', sessionId: 'someone-else' })).text).toContain('<Say>');
      expect((await answer({ isActive: '0', sessionId: 'ATVId_42' })).text).toBe('');
      await answer({ isActive: '1', sessionId: 'ATVId_42' }, path.replace(/[0-9a-f]{32}$/, '0'.repeat(32))).expect(404);

      // The agent changed before the caller answered: the one who left isn't rung.
      const other = await signIn(t, 'agent');
      await t.db.update(errands).set({ agentId: other.userId }).where(eq(errands.id, errand.id));
      expect((await answer({ isActive: '1', sessionId: 'ATVId_42' })).text).toContain('<Say>');
      await t.db.update(errands).set({ agentId: agent.userId }).where(eq(errands.id, errand.id));

      // A new address, should the old one leak: the old one stops working.
      await panel('post', '/calls/africastalking/callback').expect(200);
      await answer({ isActive: '1', sessionId: 'ATVId_42' }).expect(404);
      const renewed = await request(t.http).get('/v1/admin/providers').set(admin.headers).expect(200);
      const next: string = renewed.body.categories
        .find((c: { category: string }) => c.category === 'calls')
        .providers.find((p: { key: string }) => p.key === 'africastalking').webhookUrl;
      expect((await answer({ isActive: '1', sessionId: 'ATVId_42' }, new URL(next).pathname)).text).toContain('<Dial');
    });
  });
});
