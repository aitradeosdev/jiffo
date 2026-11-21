import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { CountriesService } from '../src/countries/countries.service';
import { adminAudit, deposits, devices, otpChallenges, payoutAccounts, riskFlags } from '../src/db/schema';
import { RiskFlagsService } from '../src/risk/risk-flags.service';
import {
  act,
  adminAs,
  createErrand,
  createTestApp,
  fund,
  LAGOS_STOPS,
  passSelfie,
  signed,
  signIn,
  uniqueDigits,
  type Person,
  type TestApp,
} from './helpers';

interface Flag {
  id: string;
  queue: 'risk' | 'verification';
  kind: string;
  status: 'open' | 'cleared' | 'confirmed';
  people: Array<{ id: string }>;
  errands: Array<{ id: string }>;
  errandCount: number;
  details: Record<string, unknown>;
  decisionNote: string | null;
}

/**
 * Fraud flags (docs/security-plan.md, E5, E6, I3, F3): errands and accounts that look like fraud are flagged
 * for a person to look at, never refused by the flag alone. Errands go to the Risk queue, accounts sharing a
 * phone or a bank account to the verification queue, and flagged errands leave the tier counts.
 */
describe('fraud flags and the Risk queue', () => {
  let t: TestApp;
  let ops: Awaited<ReturnType<typeof adminAs>>;
  let verifier: Awaited<ReturnType<typeof adminAs>>;
  beforeAll(async () => {
    t = await createTestApp();
    ops = await adminAs(t, 'operations');
    verifier = await adminAs(t, 'verification');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  /** The checks run beside the request, so it isn't slowed: this waits for them. */
  const settled = () => t.app.get(RiskFlagsService).settled();
  const flagsFor = async (
    filter: { person?: string; errand?: string },
    queue: 'risk' | 'verification' = 'risk',
    status = 'open',
  ) => {
    await settled();
    const query = new URLSearchParams({ country: 'NG', queue, status, limit: '100' });
    if (filter.person) query.set('person', filter.person);
    if (filter.errand) query.set('errand', filter.errand);
    return (await request(t.http).get(`/v1/admin/flags?${query}`).set(ops.headers).expect(200)).body.flags as Flag[];
  };
  const kinds = (flags: Flag[]) => flags.map((f) => f.kind).sort();
  const decide = (who: { headers: Record<string, string> }, id: string, decision: string, note = 'Looked at it') =>
    request(t.http).post(`/v1/admin/flags/${id}/decision`).set(who.headers).send({ decision, note });
  /** Settings, Risk, with these values changed. */
  const withRisk = (risk: Record<string, unknown>) => {
    const countries = t.app.get(CountriesService);
    const real = countries.currentSettingsIfAny.bind(countries);
    vi.spyOn(countries, 'currentSettingsIfAny').mockImplementation(async (code) => {
      const saved = await real(code);
      return saved && { ...saved, settings: { ...saved.settings, risk: { ...saved.settings.risk, ...risk } } };
    });
  };
  const complete = async (customer: Person, agent: Person, errandId: string) => {
    await act(t, agent, errandId, 'accept');
    await act(t, agent, errandId, 'start');
    await act(t, agent, errandId, 'mark_delivered');
    const pin = (await request(t.http).get(`/v1/errands/${errandId}/pin`).set(customer.headers).expect(200)).body.pin;
    await act(t, agent, errandId, 'confirm_pin', { pin });
  };
  /** An agent called Tunde Bakare with that bank account saved for withdrawals. */
  const agentWithAccount = async (accountNumber: string) => {
    const agent = await signIn(t, 'agent', { firstName: 'Tunde' });
    await request(t.http).patch('/v1/me').set(agent.headers).send({ lastName: 'Bakare' }).expect(200);
    t.payments.accounts.set(`058:${accountNumber}`, 'TUNDE BAKARE');
    await signed(t, agent).put('/v1/payout-account').send({ bankCode: '058', accountNumber }).expect(200);
    return agent;
  };

  it('flags errands to carry cash, to send money to an account, or that end where they start, and lets them run', async () => {
    const customer = await signIn(t, 'customer');
    await fund(t, customer, 5_000_000);
    const cash = await createErrand(t, customer, { description: 'Withdraw 20k cash from the ATM and bring it to me' });
    const send = await createErrand(t, customer, {
      description: 'Collect the money from my uncle and send it to my account 0123456789',
    });
    const home = LAGOS_STOPS[0]!;
    const same = await createErrand(t, customer, {
      stops: [home, { ...home, kind: 'dropoff', label: 'Back home', lat: home.lat + 0.0003 }],
    });
    const plain = await createErrand(t, customer);
    // For a person to look at, not refused: each errand goes out as usual.
    expect([cash, send, same, plain].map((e) => e.status)).toEqual([
      'requested',
      'requested',
      'requested',
      'requested',
    ]);

    expect(kinds(await flagsFor({ errand: cash.id }))).toEqual(['cash_errand']);
    expect(kinds(await flagsFor({ errand: send.id }))).toEqual(['send_money']);
    expect(kinds(await flagsFor({ errand: same.id }))).toEqual(['same_place']);
    expect(await flagsFor({ errand: plain.id })).toEqual([]);
    const [flag] = await flagsFor({ errand: cash.id });
    expect(flag!.people.map((p) => p.id)).toEqual([customer.userId]);
    expect(flag!.details).toMatchObject({ words: expect.arrayContaining(['cash']) });
    // The errand's page in the panel shows it too.
    const page = (await request(t.http).get(`/v1/admin/errands/${cash.id}`).set(ops.headers).expect(200)).body;
    expect(page.flags).toEqual([expect.objectContaining({ id: flag!.id, kind: 'cash_errand', status: 'open' })]);
  });

  it("flags a phone two accounts share when one is an agent's, and their errands together", async () => {
    const phoneId = randomUUID();
    const customer = await signIn(t, 'customer', { phoneId });
    const agent = await signIn(t, 'agent', { phoneId });
    const [shared] = await flagsFor({ person: agent.userId }, 'verification');
    expect(shared).toMatchObject({ kind: 'shared_phone', details: { by: ['phone'] } });
    expect(shared!.people.map((p) => p.id).sort()).toEqual([customer.userId, agent.userId].sort());

    // Until staff clear it, matching keeps the two apart (docs/matching.md, M1).
    await fund(t, customer);
    const errand = await createErrand(t, customer);
    expect((await act(t, agent, errand.id, 'accept', {}, 409)).error.code).toBe('unavailable');
    await t.db.update(riskFlags).set({ status: 'cleared' }).where(eq(riskFlags.id, shared!.id));
    await act(t, agent, errand.id, 'accept');
    expect(kinds(await flagsFor({ errand: errand.id }))).toEqual(['pair_shared_phone']);
  });

  it('flags one phone signed in to two agent accounts, once, but not two customers on one phone', async () => {
    const installKey = randomUUID();
    const first = await signIn(t, 'agent', { installKey });
    const second = await signIn(t, 'agent', { installKey });
    const [flag] = await flagsFor({ person: second.userId }, 'verification');
    expect(flag).toMatchObject({ kind: 'shared_phone', details: { by: ['install'] } });
    expect(flag!.people.map((p) => p.id).sort()).toEqual([first.userId, second.userId].sort());
    // Signing in again changes nothing; once cleared, it isn't raised again for the same two accounts.
    const again = async () => {
      // Past the wait before another code can be sent to the number.
      await t.db.delete(otpChallenges).where(eq(otpChallenges.phone, first.phone));
      await signIn(t, 'agent', { installKey, phone: first.phone });
    };
    await again();
    expect(await flagsFor({ person: second.userId }, 'verification')).toHaveLength(1);
    await decide(verifier, flag!.id, 'clear', 'Brothers sharing a phone, checked by call').expect(200);
    await again();
    expect(await flagsFor({ person: second.userId }, 'verification')).toEqual([]);

    const phoneId = randomUUID();
    const one = await signIn(t, 'customer', { installKey: phoneId, phoneId });
    await signIn(t, 'customer', { installKey: phoneId, phoneId });
    expect(await flagsFor({ person: one.userId }, 'verification')).toEqual([]);
  });

  it('flags one bank account saved by two agents', async () => {
    const accountNumber = `0${uniqueDigits(9)}`;
    const one = await agentWithAccount(accountNumber);
    const two = await agentWithAccount(accountNumber);
    const [flag] = await flagsFor({ person: two.userId }, 'verification');
    expect(flag).toMatchObject({ kind: 'shared_payout_account' });
    expect(flag!.people.map((p) => p.id).sort()).toEqual([one.userId, two.userId].sort());
    // Kept as a keyed fingerprint: the account number itself is nowhere in the flag.
    expect(JSON.stringify(flag)).not.toContain(accountNumber);
  });

  it("flags an errand whose customer topped up from a bank account in the agent's name", async () => {
    const agent = await agentWithAccount(`0${uniqueDigits(9)}`);
    const customer = await signIn(t, 'customer');
    const depositId = await fund(t, customer);
    await t.db
      .update(deposits)
      .set({ senderName: 'BAKARE TUNDE', senderMismatch: true })
      .where(eq(deposits.id, depositId));
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    const [flag] = await flagsFor({ errand: errand.id });
    expect(flag).toMatchObject({ kind: 'pair_shared_bank' });
    expect(flag!.people.map((p) => p.id).sort()).toEqual([customer.userId, agent.userId].sort());

    // Another agent, whose name the customer's bank didn't show, isn't flagged with them.
    const other = await signIn(t, 'agent');
    const next = await createErrand(t, customer);
    await act(t, other, next.id, 'accept');
    expect(await flagsFor({ errand: next.id })).toEqual([]);
  });

  it('flags the same customer and agent pairing again and again, and adds their later errands to it', async () => {
    withRisk({ repeatPairingErrands: 2, repeatPairingDays: 30 });
    const customer = await signIn(t, 'customer');
    const agent = await signIn(t, 'agent');
    await fund(t, customer, 5_000_000);
    const first = await createErrand(t, customer);
    await act(t, agent, first.id, 'accept');
    expect(await flagsFor({ person: agent.userId })).toEqual([]);
    const second = await createErrand(t, customer);
    await act(t, agent, second.id, 'accept');
    const [flag] = await flagsFor({ person: agent.userId });
    expect(flag).toMatchObject({ kind: 'repeat_pairing', errandCount: 2 });
    expect(flag!.errands.map((e) => e.id).sort()).toEqual([first.id, second.id].sort());

    const third = await createErrand(t, customer);
    await act(t, agent, third.id, 'accept');
    const flags = await flagsFor({ person: agent.userId });
    expect(flags).toEqual([expect.objectContaining({ id: flag!.id, errandCount: 3 })]);
  });

  it("flags a high-value errand finished unusually fast, and leaves it out of the agent's counts until cleared", async () => {
    withRisk({ fastHighValueKobo: 200_000, fastErrandMinutes: 10 });
    const customer = await signIn(t, 'customer');
    const agent = await signIn(t, 'agent');
    await fund(t, customer, 5_000_000);
    const quick = await createErrand(t, customer, { feeKobo: 250_000 });
    await complete(customer, agent, quick.id);
    const [flag] = await flagsFor({ errand: quick.id });
    expect(flag).toMatchObject({ kind: 'fast_high_value' });
    // Below the amount: not flagged, however fast.
    const small = await createErrand(t, customer, { feeKobo: 150_000 });
    await complete(customer, agent, small.id);
    expect(await flagsFor({ errand: small.id })).toEqual([]);

    // Tier decisions see the errands nobody flagged (F3).
    const stats = async () =>
      (await request(t.http).get(`/v1/admin/people/${agent.userId}`).set(ops.headers).expect(200)).body.agent.stats;
    expect(await stats()).toMatchObject({ total: 1, completed: 1, flagged: 1 });
    // Confirmed fraud stays out; cleared, it counts again.
    await decide(ops, flag!.id, 'confirm', 'No movement at all, agent and customer related').expect(200);
    expect(await stats()).toMatchObject({ completed: 1, flagged: 1 });
    // The Flags page, opened from the person's page, counts their flags only.
    const counts = (
      await request(t.http).get(`/v1/admin/flags/counts?country=NG&person=${agent.userId}`).set(ops.headers).expect(200)
    ).body;
    expect(counts).toEqual({
      risk: { open: 0, cleared: 0, confirmed: 1 },
      verification: { open: 0, cleared: 0, confirmed: 0 },
    });
    await decide(ops, flag!.id, 'reopen', 'Opened by mistake, looking again').expect(200);
    await decide(ops, flag!.id, 'clear', 'Shop next door, receipt checked').expect(200);
    expect(await stats()).toMatchObject({ total: 2, completed: 2, flagged: 0 });
  });

  it('lets operations decide the Risk queue and verification the shared accounts, with a reason, logged', async () => {
    const customer = await signIn(t, 'customer');
    await fund(t, customer);
    const errand = await createErrand(t, customer, { description: 'Bring cash from my POS shop to the house' });
    const [risk] = await flagsFor({ errand: errand.id });
    const installKey = randomUUID();
    await signIn(t, 'agent', { installKey });
    const agent = await signIn(t, 'agent', { installKey });
    const [account] = await flagsFor({ person: agent.userId }, 'verification');

    const support = await adminAs(t, 'support');
    await request(t.http).get('/v1/admin/flags?country=NG&queue=risk').set(support.headers).expect(200);
    expect((await decide(support, risk!.id, 'clear')).status).toBe(403);
    expect((await decide(verifier, risk!.id, 'clear')).body.error.code).toBe('not_permitted');
    expect((await decide(ops, account!.id, 'clear')).body.error.code).toBe('not_permitted');
    // A reason in a few words is needed.
    expect((await decide(ops, risk!.id, 'clear', 'ok')).status).toBe(400);

    const done = await decide(ops, risk!.id, 'confirm', 'Cash runs are not allowed').expect(200);
    expect(done.body).toMatchObject({ status: 'confirmed' });
    // Decided once; a second answer needs it reopened first.
    expect((await decide(ops, risk!.id, 'clear')).body.error.code).toBe('flag_decided');
    expect(await flagsFor({ errand: errand.id }, 'risk', 'confirmed')).toEqual([
      expect.objectContaining({ id: risk!.id, decisionNote: 'Cash runs are not allowed' }),
    ]);
    const audit = await t.db
      .select()
      .from(adminAudit)
      .where(and(eq(adminAudit.targetType, 'flag'), eq(adminAudit.targetId, risk!.id)));
    expect(audit).toEqual([
      expect.objectContaining({ action: 'flag.confirm', data: expect.objectContaining({ kind: 'cash_errand' }) }),
    ]);
    await decide(verifier, account!.id, 'clear', 'Same family, checked by call').expect(200);

    // How many wait in each queue, for the panel.
    const counts = (await request(t.http).get('/v1/admin/flags/counts?country=NG').set(ops.headers).expect(200)).body;
    expect(counts.risk.confirmed).toBeGreaterThanOrEqual(1);
    expect(counts.verification.cleared).toBeGreaterThanOrEqual(1);
  });

  it('lists decided flags by when they were decided, latest first', async () => {
    const customer = await signIn(t, 'customer');
    await fund(t, customer);
    const older = await createErrand(t, customer, { description: 'Bring cash from the ATM' });
    const newer = await createErrand(t, customer, { description: 'Bring cash from the POS' });
    const [a] = await flagsFor({ errand: older.id });
    const [b] = await flagsFor({ errand: newer.id });
    await decide(ops, b!.id, 'confirm', 'Cash runs are not allowed').expect(200);
    await decide(ops, a!.id, 'confirm', 'Cash runs are not allowed').expect(200);
    const confirmed = await flagsFor({ person: customer.userId }, 'risk', 'confirmed');
    expect(confirmed.map((f) => f.id)).toEqual([a!.id, b!.id]);
  });

  it("doesn't fail a sign-in over a phone id it can't use", async () => {
    const person = await signIn(t, 'customer', { phoneId: '' });
    const rows = await t.db
      .select({ fingerprint: devices.phoneFingerprint })
      .from(devices)
      .where(eq(devices.userId, person.userId));
    expect(rows).toEqual([{ fingerprint: null }]);
  });

  it('counts someone as an agent once they apply, and looks at their phone again then', async () => {
    const phoneId = randomUUID();
    await signIn(t, 'customer', { phoneId });
    // Opened the agent app but never applied: two customers' accounts on a family phone.
    const curious = await signIn(t, 'agent', { phoneId, unapproved: true, unsecured: true });
    expect(await flagsFor({ person: curious.userId }, 'verification')).toEqual([]);
    await request(t.http).get('/v1/agent/application').set(curious.headers).expect(200);
    expect(kinds(await flagsFor({ person: curious.userId }, 'verification'))).toEqual(['shared_phone']);
  });

  it('keeps every bank account two agents share on their one flag', async () => {
    const first = `0${uniqueDigits(9)}`;
    const second = `0${uniqueDigits(9)}`;
    const one = await agentWithAccount(first);
    const two = await agentWithAccount(first);
    t.payments.accounts.set(`058:${second}`, 'TUNDE BAKARE');
    for (const agent of [one, two]) {
      await passSelfie(t, agent);
      await signed(t, agent).put('/v1/payout-account').send({ bankCode: '058', accountNumber: second }).expect(200);
    }
    const flags = await flagsFor({ person: two.userId }, 'verification');
    expect(flags).toHaveLength(1);
    expect(flags[0]!.details.accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ last4: first.slice(-4) }),
        expect.objectContaining({ last4: second.slice(-4) }),
      ]),
    );
  });

  it('fingerprints older bank accounts, past one it cannot read', async () => {
    const agent = await agentWithAccount(`0${uniqueDigits(9)}`);
    await t.db.update(payoutAccounts).set({ accountFingerprint: null }).where(eq(payoutAccounts.userId, agent.userId));
    const [good] = await t.db
      .select({ id: payoutAccounts.id, provider: payoutAccounts.provider, bankName: payoutAccounts.bankName })
      .from(payoutAccounts)
      .where(eq(payoutAccounts.userId, agent.userId));
    // An account whose number was sealed under another key.
    const [bad] = (
      await t.db.execute<{ id: string }>(sql`insert into payout_accounts
        (user_id, provider, bank_code, bank_name, account_number, account_name, recipient_code, replaced_at)
        values (${agent.userId}, ${good!.provider}, '058', ${good!.bankName}, 'enc:v1:broken', 'enc:v1:broken',
          'enc:v1:broken', now())
        returning id`)
    ).rows;
    await t.app.get(RiskFlagsService).fingerprintOldAccounts();
    const rows = await t.db
      .select({ id: payoutAccounts.id, fingerprint: payoutAccounts.accountFingerprint })
      .from(payoutAccounts)
      .where(eq(payoutAccounts.userId, agent.userId));
    expect(rows.find((r) => r.id === good!.id)?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(rows.find((r) => r.id === bad!.id)?.fingerprint).toBeNull();
    await t.db.delete(payoutAccounts).where(eq(payoutAccounts.id, bad!.id));
  });

  it('refuses a staff member deciding a flag about their own app account', async () => {
    const customer = await signIn(t, 'customer');
    await fund(t, customer);
    const errand = await createErrand(t, customer, { description: 'Withdraw cash for me at the ATM' });
    const [flag] = await flagsFor({ errand: errand.id });
    const self = await adminAs(t, 'operations', { phone: customer.phone });
    expect((await decide(self, flag!.id, 'clear', 'Nothing wrong here')).body.error.code).toBe('own_account');
  });
});
