import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { agentApplications, customerVerifications, payoutAccounts } from '../src/db/schema';
import { FieldsBackfill } from '../src/db/fields-backfill';
import { nameIndex, openField, sealField } from '../src/db/fields';
import { adminAs, completeApplication, createTestApp, signIn, uniqueNin, type TestApp } from './helpers';

/** Personal details encrypted at rest (docs/security-plan.md, I6). */
describe('personal details', () => {
  let t: TestApp;
  let ops: Awaited<ReturnType<typeof adminAs>>;
  beforeAll(async () => {
    t = await createTestApp();
    ops = await adminAs(t, 'operations');
  });
  afterAll(() => t.close());

  const raw = async (table: string, key: string, id: string) =>
    (await t.db.execute(sql`select * from ${sql.identifier(table)} where ${sql.identifier(key)} = ${id}`)).rows[0] as
      Record<string, unknown> | undefined;

  async function agent() {
    const who = await signIn(t, 'agent', { unapproved: true });
    await request(t.http).patch('/v1/me').set(who.headers).send({ lastName: 'Bakare' }).expect(200);
    await completeApplication(t, who);
    return who;
  }

  it('are stored only as ciphertext, and read back as they were', async () => {
    const who = await agent();
    const stored = await raw('agent_applications', 'user_id', who.userId);
    const text = JSON.stringify(stored);
    for (const plain of ['TUNDE BAKARE', '1995-04-12', 'Fola Osibo', 'Ngozi', '+2348034471902', 'Sibling']) {
      expect(text).not.toContain(plain);
    }
    for (const column of ['legal_name', 'date_of_birth', 'address', 'emergency_name', 'emergency_phone']) {
      expect(String(stored![column])).toMatch(/^enc1:/);
    }
    const [read] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, who.userId));
    expect(read).toMatchObject({
      legalName: 'TUNDE BAKARE',
      dateOfBirth: '1995-04-12',
      address: '14 Fola Osibo Road, Lekki Phase 1',
      emergencyName: 'Ngozi Bakare',
      emergencyPhone: '+2348034471902',
    });

    const [account] = await t.db.select().from(payoutAccounts).where(eq(payoutAccounts.userId, who.userId));
    const storedAccount = await raw('payout_accounts', 'id', account!.id);
    expect(String(storedAccount!.account_number)).toMatch(/^enc1:/);
    expect(String(storedAccount!.account_name)).toMatch(/^enc1:/);
    expect(String(storedAccount!.account_number)).not.toContain(account!.accountNumber);
    expect(storedAccount!.account_last4).toBe(account!.accountNumber.slice(-4));
  });

  it('can’t be moved from one column or table to another', () => {
    const sealed = sealField('agent_applications.legal_name', 'TUNDE BAKARE');
    expect(openField('agent_applications.legal_name', sealed)).toBe('TUNDE BAKARE');
    expect(() => openField('agent_applications.address', sealed)).toThrow();
    expect(() => openField('customer_verifications.legal_name', sealed)).toThrow();
  });

  it('let support find someone by any whole word of their legal name', async () => {
    const who = await signIn(t, 'customer', { unverified: true });
    await request(t.http).patch('/v1/me').set(who.headers).send({ firstName: 'Ada', lastName: 'Obi' }).expect(200);
    await request(t.http)
      .post('/v1/me/identity')
      .set(who.headers)
      .send({ idType: 'nin', idNumber: uniqueNin('1111'), consent: true })
      .expect(200);
    await request(t.http).post('/v1/me/identity/finish').set(who.headers).expect(200);
    // The ID record's name differs from the one in the app, so only the index can find it.
    await t.db
      .update(customerVerifications)
      .set({ legalName: 'ADAEZE CHIOMA OKONKWO', legalNameIndex: nameIndex('ADAEZE CHIOMA OKONKWO') })
      .where(eq(customerVerifications.userId, who.userId));
    const find = async (q: string) =>
      (
        await request(t.http)
          .get(`/v1/admin/id-checks?country=NG&status=review&q=${encodeURIComponent(q)}`)
          .set(ops.headers)
          .expect(200)
      ).body.checks.map((c: { id: string }) => c.id);
    expect(await find('okonkwo')).toContain(who.userId);
    expect(await find('Chioma Okonkwo')).toContain(who.userId);
    expect(await find('Okonkwo Bello')).not.toContain(who.userId);
  });

  it('saved before encryption are encrypted at the next start, without undoing newer writes', async () => {
    const who = await agent();
    await t.db.execute(
      sql`update agent_applications set legal_name = 'TUNDE BAKARE', address = '9 Old Road', legal_name_index = null where user_id = ${who.userId}`,
    );
    const [account] = await t.db.select().from(payoutAccounts).where(eq(payoutAccounts.userId, who.userId));
    await t.db.execute(
      sql`update payout_accounts set account_number = '0123456789', account_last4 = null where id = ${account!.id}`,
    );
    // Before: still readable as it was.
    const [before] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, who.userId));
    expect(before!.address).toBe('9 Old Road');
    await t.app.get(FieldsBackfill).run();
    const stored = await raw('agent_applications', 'user_id', who.userId);
    expect(String(stored!.legal_name)).toMatch(/^enc1:/);
    expect(String(stored!.address)).toMatch(/^enc1:/);
    expect(stored!.legal_name_index).toHaveLength(2);
    const [after] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, who.userId));
    expect(after).toMatchObject({ legalName: 'TUNDE BAKARE', address: '9 Old Road' });
    const storedAccount = await raw('payout_accounts', 'id', account!.id);
    expect(String(storedAccount!.account_number)).toMatch(/^enc1:/);
    expect(storedAccount!.account_last4).toBe('6789');
  });
});
