import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disputeEvidence } from '../src/db/schema';
import { act, adminAs, createErrand, createTestApp, fund, photo, signIn, type Person, type TestApp } from './helpers';

interface Seen {
  id: number;
  body: string;
  kind: string;
  data: { warnings?: string[] };
}

/**
 * Chat warnings (docs/security-plan.md, C3): a message with a link, a phone number, a bank account number or
 * a push to pay outside the app carries a warning, set by the server, for both apps to show beside it.
 */
describe('chat warnings', () => {
  let t: TestApp;
  let customer: Person;
  let agent: Person;
  let errandId: string;
  beforeAll(async () => {
    t = await createTestApp();
    [customer, agent] = await Promise.all([signIn(t, 'customer'), signIn(t, 'agent')]);
    await fund(t, customer, 20_000_000);
    errandId = (await createErrand(t, customer)).id;
    await act(t, agent, errandId, 'accept');
  });
  afterAll(() => t.close());

  const send = async (who: Person, body: Record<string, unknown>) =>
    (
      await request(t.http)
        .post(`/v1/errands/${errandId}/messages`)
        .set(who.headers)
        .send({ clientId: randomUUID(), ...body })
        .expect(201)
    ).body as Seen;
  const list = async (who: Person) =>
    (await request(t.http).get(`/v1/errands/${errandId}/messages`).set(who.headers).expect(200)).body
      .messages as Seen[];

  it('marks a message asking to be paid outside the app, for the other side to see', async () => {
    const sent = await send(agent, { body: 'Cancel it and pay me directly, acct 0123456789 GTB' });
    expect(sent.data.warnings).toEqual(['account_number', 'pay_outside']);
    const seen = (await list(customer)).find((m) => m.id === sent.id)!;
    expect(seen.data.warnings).toEqual(['account_number', 'pay_outside']);
  });

  it('marks links and phone numbers, and leaves ordinary messages alone', async () => {
    expect((await send(customer, { body: 'Call me on 0803 123 4567' })).data.warnings).toEqual(['phone']);
    expect((await send(agent, { body: 'See www.cheap-phones.ng for the price' })).data.warnings).toEqual(['link']);
    const plain = await send(agent, { body: "I'm at the pickup, the total is 15000" });
    expect(plain.data.warnings).toBeUndefined();
  });

  it("can't be cleared or set by the app: only the server decides", async () => {
    const res = await request(t.http)
      .post(`/v1/errands/${errandId}/messages`)
      .set(agent.headers)
      .send({ clientId: randomUUID(), body: 'Pay me directly', data: { warnings: [] } });
    expect(res.status).toBe(400);
    expect((await send(agent, { body: 'Pay me directly' })).data.warnings).toEqual(['pay_outside']);
  });

  it('marks a photo by its caption', async () => {
    const key = await photo(t, customer, errandId, 'chat_photo');
    const sent = await send(customer, { photo: key, body: 'my opay is in the picture, send it there' });
    expect(sent.data).toMatchObject({ key, warnings: ['pay_outside'] });
  });

  it("shows the warnings to staff on the errand's page and keeps them in the evidence pack", async () => {
    const sent = await send(agent, { body: 'transfer to my account instead' });
    const support = await adminAs(t, 'support');
    const detail = (await request(t.http).get(`/v1/admin/errands/${errandId}`).set(support.headers).expect(200)).body;
    expect(detail.chat.find((m: { id: number }) => m.id === sent.id)).toMatchObject({ warnings: ['pay_outside'] });
    await act(t, agent, errandId, 'start');
    await act(t, customer, errandId, 'open_dispute', { reason: 'The agent asked me to pay outside the app' });
    const [pack] = await t.db.select().from(disputeEvidence).where(eq(disputeEvidence.errandId, errandId));
    const kept = (pack!.content as { messages: Seen[] }).messages.find((m) => m.id === sent.id);
    expect(kept?.data.warnings).toEqual(['pay_outside']);
  });
});
