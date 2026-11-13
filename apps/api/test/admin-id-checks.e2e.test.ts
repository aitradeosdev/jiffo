import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminAudit, adminSessions, customerVerifications } from '../src/db/schema';
import { adminAs, createTestApp, signIn, type Person, type TestApp } from './helpers';

/** An ID number new on every run, ending in the fake provider's code for the path wanted. */
const passport = (ending = '4567') => `A${String(Date.now()).slice(-4)}${ending}`;

describe("admin: customers' ID checks", () => {
  let t: TestApp;
  let ops: Awaited<ReturnType<typeof adminAs>>;
  let finance: Awaited<ReturnType<typeof adminAs>>;
  beforeAll(async () => {
    t = await createTestApp();
    ops = await adminAs(t, 'operations');
    finance = await adminAs(t, 'finance');
  });
  afterAll(async () => {
    await t.db.delete(adminSessions);
    await t.close();
  });

  async function customerChecked(idNumber: string) {
    const who = await signIn(t, 'customer', { unverified: true });
    await request(t.http).patch('/v1/me').set(who.headers).send({ lastName: 'Okafor' }).expect(200);
    await request(t.http)
      .post('/v1/me/identity')
      .set(who.headers)
      .send({ consent: true, idType: 'passport', idNumber })
      .expect(200);
    await request(t.http).post('/v1/me/identity/finish').set(who.headers).expect(200);
    return who;
  }
  const decide = (who: Person, body: object, as = ops) =>
    request(t.http).post(`/v1/admin/people/${who.userId}/identity`).set(as.headers).send(body);

  it('lists checks in review with what was flagged, and support verifies one', async () => {
    // 1111: the selfie didn't clearly match, so the team looks.
    const who = await customerChecked(passport('1111'));
    const list = await request(t.http).get('/v1/admin/id-checks?country=NG').set(ops.headers).expect(200);
    const row = list.body.checks.find((c: { id: string }) => c.id === who.userId);
    expect(row).toMatchObject({ status: 'review', idType: 'passport', idName: 'International passport' });
    expect(row.flagged).toEqual([
      expect.objectContaining({ key: 'selfie', outcome: 'review', label: 'Selfie matches the ID photo' }),
    ]);
    const counts = await request(t.http).get('/v1/admin/id-checks/counts?country=NG').set(ops.headers).expect(200);
    expect(counts.body.review).toBeGreaterThanOrEqual(1);
    const person = await request(t.http).get(`/v1/admin/people/${who.userId}`).set(ops.headers).expect(200);
    expect(person.body.customer.identity).toMatchObject({ status: 'review', legalName: 'ADA OKAFOR' });

    // Finance can look but not decide; a note is needed.
    await decide(who, { decision: 'verify', note: 'Selfie matches on a second look' }, finance).expect(403);
    await decide(who, { decision: 'verify', note: 'ok' }).expect(400);
    expect(
      (await decide(who, { decision: 'verify', note: 'Selfie matches on a second look' }).expect(200)).body,
    ).toMatchObject({
      status: 'verified',
    });
    await request(t.http).post('/v1/wallet/deposits').set(who.headers).send({ amountKobo: 500_000 }).expect(201);
    await decide(who, { decision: 'decline', note: 'Changed my mind' })
      .expect(409)
      .expect(/not_in_review/);
    const [entry] = await t.db.select().from(adminAudit).where(eq(adminAudit.targetId, who.userId));
    expect(entry).toMatchObject({ action: 'customer_identity.verify', targetType: 'person' });
  });

  it("won't verify a second account on an ID another customer holds; declines, and reopens", async () => {
    const id = passport();
    await customerChecked(id);
    const second = await customerChecked(id);
    expect((await request(t.http).get('/v1/me/identity').set(second.headers)).body.status).toBe('review');
    await decide(second, { decision: 'verify', note: 'Looks like the same person' })
      .expect(409)
      .expect(/id_held/);
    await decide(second, { decision: 'decline', note: 'This passport is on another account' }).expect(200);
    const declined = (await request(t.http).get('/v1/me/identity').set(second.headers)).body;
    expect(declined).toMatchObject({ status: 'declined', decisionNote: 'This passport is on another account' });
    await request(t.http)
      .post('/v1/me/identity')
      .set(second.headers)
      .send({ consent: true, idType: 'passport', idNumber: passport() })
      .expect(403)
      .expect(/identity_declined/);
    // Reopened, they can check again with another ID.
    await decide(second, { decision: 'reopen', note: 'They called; their own passport is new' }).expect(200);
    const [row] = await t.db
      .select()
      .from(customerVerifications)
      .where(eq(customerVerifications.userId, second.userId));
    expect(row!.status).toBe('failed');
    await request(t.http)
      .post('/v1/me/identity')
      .set(second.headers)
      .send({ consent: true, idType: 'nin', idNumber: `5${String(Date.now()).slice(-6)}4567` })
      .expect(200);
  });
});
