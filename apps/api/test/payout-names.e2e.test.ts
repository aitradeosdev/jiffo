import { randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nameMatch } from '../src/common/names';
import { nameIndex } from '../src/db/fields';
import { agentApplications, payoutAccounts, payouts } from '../src/db/schema';
import {
  adminAs,
  agentWithMoney,
  completeApplication,
  createTestApp,
  signIn,
  uniqueDigits,
  type Person,
  type TestApp,
} from './helpers';

describe('payout account names', () => {
  it('match, nearly match or don’t, against the legal name', () => {
    const legal = 'TUNDE ADEWALE BAKARE';
    expect(nameMatch('Tunde Bakare', legal)).toBe('match');
    expect(nameMatch('BAKARE TUNDE ADEWALE', legal)).toBe('match');
    // An initial, or a slip of a letter: support looks.
    expect(nameMatch('T Bakare', legal)).toBe('near');
    expect(nameMatch('Tunde A. Bakare', legal)).toBe('near');
    expect(nameMatch('Tunde Bakaree', legal)).toBe('near');
    // Someone else's account, one word, or a word that isn't on the ID: refused as before.
    expect(nameMatch('Bakare', legal)).toBe('none');
    expect(nameMatch('Ngozi Bakare', legal)).toBe('none');
    expect(nameMatch('Tunde Bakare Okafor', legal)).toBe('none');
    expect(nameMatch('Tinde Bekare', legal)).toBe('none');
    // A relative sharing only the surname: each word of the ID is used once, so these don't pass.
    expect(nameMatch('B Bakare', legal)).toBe('none');
    expect(nameMatch('Bakare Bakari', legal)).toBe('none');
  });
});

/** Abuse cases for payout accounts (docs/security-plan.md, I4). */
describe('changing a payout account', () => {
  let t: TestApp;
  let finance: Awaited<ReturnType<typeof adminAs>>;
  beforeAll(async () => {
    t = await createTestApp();
    finance = await adminAs(t, 'finance');
  });
  afterAll(() => t.close());

  /** An approved agent whose ID record says TUNDE ADEWALE BAKARE, with money and an account that matches. */
  async function agent() {
    const who = await agentWithMoney(t, 500_000);
    await t.db
      .update(agentApplications)
      .set({
        legalName: 'TUNDE ADEWALE BAKARE',
        legalNameIndex: nameIndex('TUNDE ADEWALE BAKARE'),
        identityOutcome: 'passed',
      })
      .where(eq(agentApplications.userId, who.userId));
    const token = `push-${randomUUID()}`;
    await request(t.http).put('/v1/devices/current/push-token').set(who.headers).send({ token }).expect(204);
    return { who, token };
  }
  const save = (who: Person, bankName: string) => {
    const accountNumber = `0${uniqueDigits(9)}`;
    t.payments.accounts.set(`058:${accountNumber}`, bankName);
    return request(t.http).put('/v1/payout-account').set(who.headers).send({ bankCode: '058', accountNumber });
  };
  const inUse = async (who: Person) =>
    (
      await t.db
        .select()
        .from(payoutAccounts)
        .where(
          and(
            eq(payoutAccounts.userId, who.userId),
            isNull(payoutAccounts.replacedAt),
            eq(payoutAccounts.reviewStatus, 'approved'),
          ),
        )
    )[0]!;
  const pushesTo = (token: string) => t.push.sent.filter((p) => p.token === token);
  const toCheck = async () =>
    (await request(t.http).get('/v1/admin/money/payout-accounts?country=NG').set(finance.headers).expect(200)).body
      .accounts as Array<{ id: string; person: { id: string }; accountName: string; legalName: string }>;
  const decide = (id: string, decision: 'approve' | 'decline', as = finance) =>
    request(t.http)
      .post(`/v1/admin/money/payout-accounts/${id}/decision`)
      .set(as.headers)
      .send({ decision, note: 'Checked against the ID photo' });

  it('to one that nearly matches waits for support, and withdrawals keep going to the approved one', async () => {
    const { who, token } = await agent();
    const before = await inUse(who);
    const res = await save(who, 'T BAKARE').expect(200);
    expect(res.body).toMatchObject({ inReview: false, pending: { accountName: 'T BAKARE' } });
    expect(pushesTo(token).at(-1)).toMatchObject({ title: 'We are checking your new account' });
    expect((await inUse(who)).id).toBe(before.id);

    const withdrawal = await request(t.http)
      .post('/v1/wallet/withdrawals')
      .set(who.headers)
      .send({ amountKobo: 100_000, speed: 'scheduled', requestId: randomUUID() })
      .expect(201);
    const [payout] = await t.db.select().from(payouts).where(eq(payouts.id, withdrawal.body.id));
    expect(payout!.payoutAccountId).toBe(before.id);

    const waiting = (await toCheck()).find((a) => a.person.id === who.userId)!;
    expect(waiting).toMatchObject({ accountName: 'T BAKARE', legalName: 'TUNDE ADEWALE BAKARE' });
    // Only finance and owners decide.
    const ops = await adminAs(t, 'operations');
    expect((await decide(waiting.id, 'approve', ops)).status).toBe(403);
    await decide(waiting.id, 'approve').expect(200);
    expect((await inUse(who)).id).toBe(waiting.id);
    expect(pushesTo(token).at(-1)).toMatchObject({ title: 'New account approved' });
    expect((await decide(waiting.id, 'approve')).status).toBe(409);
  });

  it('declined, leaves the approved account in use', async () => {
    const { who, token } = await agent();
    const before = await inUse(who);
    await save(who, 'TUNDE BAKAREE').expect(200);
    const waiting = (await toCheck()).find((a) => a.person.id === who.userId)!;
    await decide(waiting.id, 'decline').expect(200);
    expect((await inUse(who)).id).toBe(before.id);
    expect((await toCheck()).some((a) => a.id === waiting.id)).toBe(false);
    expect(pushesTo(token).at(-1)).toMatchObject({ title: 'New account not approved' });
  });

  it('to one that matches takes over at once, and the agent is told', async () => {
    const { who, token } = await agent();
    const before = await inUse(who);
    await save(who, 'BAKARE TUNDE').expect(200);
    expect((await inUse(who)).id).not.toBe(before.id);
    expect(pushesTo(token).at(-1)).toMatchObject({ title: 'Payout account changed' });
  });

  it('saved during the application is decided with the application, once', async () => {
    const who = await signIn(t, 'agent', { unapproved: true });
    await request(t.http).patch('/v1/me').set(who.headers).send({ lastName: 'Bakare' }).expect(200);
    await completeApplication(t, who);
    // The fake provider's record is TUNDE BAKARE; the bank shortens the first name.
    await save(who, 'T BAKARE').expect(200);
    // Not in finance's list: the application is where it's decided.
    expect((await toCheck()).some((a) => a.person.id === who.userId)).toBe(false);
    await request(t.http).post('/v1/agent/application/submit').set(who.headers).expect(200);
    const ops = await adminAs(t, 'operations');
    const detail = (await request(t.http).get(`/v1/admin/people/${who.userId}`).set(ops.headers).expect(200)).body;
    const bank = detail.agent.application.checks.find((c: { key: string }) => c.key === 'bank');
    expect(bank).toMatchObject({ outcome: 'review', note: expect.stringContaining('Approving the application') });
    await request(t.http)
      .post(`/v1/admin/people/${who.userId}/application`)
      .set(ops.headers)
      .send({ decision: 'approve', note: 'The bank shortens the first name' })
      .expect(200);
    const account = await inUse(who);
    expect(account).toMatchObject({ accountName: 'T BAKARE', reviewStatus: 'approved' });
  });

  it('waiting, is marked so on the agent’s page in the panel', async () => {
    const { who } = await agent();
    // Only a waiting account: the approved one is gone.
    await t.db.update(payoutAccounts).set({ replacedAt: new Date() }).where(eq(payoutAccounts.userId, who.userId));
    await save(who, 'T BAKARE').expect(200);
    const detail = (await request(t.http).get(`/v1/admin/people/${who.userId}`).set(finance.headers).expect(200)).body;
    expect(detail.agent.payoutAccount).toMatchObject({ accountName: 'T BAKARE', inReview: true });
    const withdraw = await request(t.http)
      .post('/v1/wallet/withdrawals')
      .set(who.headers)
      .send({ amountKobo: 100_000, speed: 'scheduled', requestId: randomUUID() });
    expect(withdraw.body.error.code).toBe('payout_account_in_review');
  });

  it('to someone else’s is refused, as before', async () => {
    const { who } = await agent();
    const res = await save(who, 'NGOZI OKAFOR');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('account_name_mismatch');
  });
});
