import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { CallsUnavailable } from '../src/adapters/calls';
import { errandCalls, errands } from '../src/db/schema';
import { act, createErrand, createTestApp, fund, signIn, type Person, type TestApp } from './helpers';

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
    const { errand } = await accepted();
    const stranger = await signIn(t, 'agent');
    expect((await call(stranger, errand.id)).status).toBe(404);
    const other = await signIn(t, 'customer');
    expect((await call(other, errand.id)).status).toBe(404);
    await t.db.update(errands).set({ status: 'completed' }).where(eq(errands.id, errand.id));
    expect((await call(customer, errand.id)).body.error.code).toBe('call_not_available');
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
});
