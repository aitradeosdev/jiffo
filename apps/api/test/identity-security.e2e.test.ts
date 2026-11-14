import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeIdentityAdapter } from '../src/adapters/identity';
import { IdentityProviderError } from '../src/adapters/identity-providers';
import { BUILDERS } from '../src/providers/builders';
import { agentApplications, customerVerifications, identityAttempts } from '../src/db/schema';
import { IdentityChecksService } from '../src/identity/identity-checks.service';
import { adminAs, createTestApp, signIn, uniqueNin, type Person, type TestApp } from './helpers';

/** Abuse cases for identity checks (docs/security-plan.md, I1, I2, findings 3, 10, 22). */
describe('identity checks', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  const customer = async () => {
    const who = await signIn(t, 'customer', { unverified: true });
    await request(t.http).patch('/v1/me').set(who.headers).send({ firstName: 'Ada', lastName: 'Obi' }).expect(200);
    return who;
  };
  const check = (who: Person, idNumber: string) =>
    request(t.http).post('/v1/me/identity').set(who.headers).send({ idType: 'nin', idNumber, consent: true });
  const finish = (who: Person) => request(t.http).post('/v1/me/identity/finish').set(who.headers).expect(200);
  const view = async (who: Person) => (await request(t.http).get('/v1/me/identity').set(who.headers).expect(200)).body;

  describe('the name on an ID', () => {
    it('is neither kept nor shown when the selfie fails, so a number can’t be looked up', async () => {
      const who = await customer();
      await check(who, uniqueNin('2222')).expect(200);
      expect((await finish(who)).body.status).toBe('failed');
      expect((await view(who)).legalName).toBeNull();
      const [row] = await t.db.select().from(customerVerifications).where(eq(customerVerifications.userId, who.userId));
      expect(row).toMatchObject({ status: 'failed', legalName: null, dateOfBirth: null });
    });

    it('is shown to the customer only once verified, not while support reviews it', async () => {
      const who = await customer();
      await check(who, uniqueNin('1111')).expect(200);
      expect((await finish(who)).body.status).toBe('review');
      expect((await view(who)).legalName).toBeNull();
      // Support still has it to decide with.
      const [row] = await t.db.select().from(customerVerifications).where(eq(customerVerifications.userId, who.userId));
      expect(row!.legalName).toBe('ADA OBI');

      const passed = await customer();
      await check(passed, uniqueNin()).expect(200);
      expect((await finish(passed)).body.status).toBe('verified');
      expect((await view(passed)).legalName).toBe('ADA OBI');
    });
  });

  describe('starting checks', () => {
    it('is limited each day, whatever the results, since each is a paid check', async () => {
      const who = await customer();
      for (let i = 0; i < 3; i += 1) {
        await check(who, uniqueNin('0000')).expect(200);
        await finish(who);
      }
      const fourth = await check(who, uniqueNin('0000'));
      expect(fourth.status).toBe(429);
      expect(fourth.body.error.code).toBe('identity_check_limit');
    });

    it('doesn’t count a start the provider couldn’t take', async () => {
      const who = await customer();
      const down = vi
        .spyOn(FakeIdentityAdapter.prototype, 'startIdentity')
        .mockRejectedValue(new IdentityProviderError('down'));
      try {
        for (let i = 0; i < 3; i += 1) expect((await check(who, uniqueNin('0000'))).status).toBe(503);
      } finally {
        down.mockRestore();
      }
      await check(who, uniqueNin('0000')).expect(200);
    });

    it('forgets attempts after two days', async () => {
      const who = await customer();
      await t.db
        .insert(identityAttempts)
        .values({ kind: 'start', userId: who.userId, createdAt: new Date(Date.now() - 3 * 86_400_000) });
      await t.app.get(IdentityChecksService).prune();
      const left = await t.db.select().from(identityAttempts).where(eq(identityAttempts.userId, who.userId));
      expect(left).toHaveLength(0);
    });

    it('lets only one of a burst through when one start is left', async () => {
      const who = await customer();
      await check(who, uniqueNin('0000')).expect(200);
      await check(who, uniqueNin('0000')).expect(200);
      const burst = await Promise.all(Array.from({ length: 10 }, () => check(who, uniqueNin('0000'))));
      expect(burst.filter((r) => r.status === 200)).toHaveLength(1);
      expect(burst.filter((r) => r.status !== 200).every((r) => r.status === 429)).toBe(true);
    });
  });

  describe('approving an agent', () => {
    it('never takes an ID from another account that proved it with its own checks', async () => {
      const ops = await adminAs(t, 'operations');
      const nin = uniqueNin();
      const agent = async () => {
        const who = await signIn(t, 'agent', { unapproved: true });
        await request(t.http).patch('/v1/me').set(who.headers).send({ lastName: 'Bakare' }).expect(200);
        return who;
      };
      const start = (who: Person, idNumber: string) =>
        request(t.http)
          .post('/v1/agent/application/identity')
          .set(who.headers)
          .send({ idType: 'nin', idNumber, bvn: '22212345678', consent: true })
          .expect(200);
      // The first proves the NIN is theirs; the second's selfie needs support, on the same NIN.
      const prover = await agent();
      await start(prover, nin);
      await request(t.http).post('/v1/agent/application/identity/finish').set(prover.headers).expect(200);
      const second = await agent();
      await start(second, nin);
      await request(t.http).post('/v1/agent/application/identity/finish').set(second.headers).expect(200);
      await t.db
        .update(agentApplications)
        .set({ status: 'review', submittedAt: new Date() })
        .where(eq(agentApplications.userId, second.userId));
      const decided = await request(t.http)
        .post(`/v1/admin/people/${second.userId}/application`)
        .set(ops.headers)
        .send({ decision: 'approve', note: 'Looks fine to me' });
      expect(decided.status).toBe(409);
      expect(decided.body.error.code).toBe('nin_held');
      const [kept] = await t.db.select().from(agentApplications).where(eq(agentApplications.userId, prover.userId));
      expect(kept!.idFingerprint).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('identity providers', () => {
    it('can’t be put in sandbox mode in production', () => {
      const ctx = { publicApiUrl: 'https://api.jiffo.test', sign: () => 'x', hostedLink: () => 'x', production: true };
      const values = { secretKey: 'sk', publicMerchantKey: 'pk', mode: 'sandbox' };
      expect(() => BUILDERS.identity.youverify!(values, ctx)).toThrow(/Sandbox mode is for testing/);
      expect(() => BUILDERS.identity.youverify!({ ...values, mode: 'live' }, ctx)).not.toThrow();
      expect(() => BUILDERS.identity.youverify!(values, { ...ctx, production: false })).not.toThrow();
    });
  });
});
