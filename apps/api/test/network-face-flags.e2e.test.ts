import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FakeIdentityAdapter, type IdentityResult } from '../src/adapters/identity';
import { CountriesService } from '../src/countries/countries.service';
import { customerVerifications, userNetworks } from '../src/db/schema';
import { NetworksService } from '../src/risk/networks.service';
import { RiskFlagsService } from '../src/risk/risk-flags.service';
import {
  act,
  adminAs,
  createErrand,
  createTestApp,
  fund,
  randomIp,
  signIn,
  uniqueNin,
  type Person,
  type TestApp,
} from './helpers';

interface Flag {
  id: string;
  kind: string;
  people: Array<{ id: string }>;
  details: Record<string, unknown>;
}

/**
 * Shared networks and the same face (docs/security-plan.md, E6, I3): a customer and agent who used one Wi-Fi
 * network or address, and a face the identity provider found on another person's check with another ID.
 */
describe('network and same-face flags', () => {
  let t: TestApp;
  let ops: Awaited<ReturnType<typeof adminAs>>;
  beforeAll(async () => {
    t = await createTestApp();
    ops = await adminAs(t, 'operations');
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  afterAll(() => t.close());

  const settled = async () => {
    await t.app.get(NetworksService).settled();
    await t.app.get(RiskFlagsService).settled();
  };
  const flagsFor = async (filter: { person?: string; errand?: string }, queue = 'risk') => {
    await settled();
    const query = new URLSearchParams({ country: 'NG', queue, status: 'open', limit: '100' });
    if (filter.person) query.set('person', filter.person);
    if (filter.errand) query.set('errand', filter.errand);
    return (await request(t.http).get(`/v1/admin/flags?${query}`).set(ops.headers).expect(200)).body.flags as Flag[];
  };
  /** A request from the app on a connection: the app says what kind, the server sees the address. */
  const from = async (who: Person, ip: string, network?: string) => {
    const call = request(t.http).get('/v1/me').set(who.headers).set('x-forwarded-for', ip);
    if (network) call.set('x-jiffo-network', network);
    await call.expect(200);
  };
  const withRisk = (risk: Record<string, unknown>) => {
    const countries = t.app.get(CountriesService);
    const real = countries.currentSettingsIfAny.bind(countries);
    vi.spyOn(countries, 'currentSettingsIfAny').mockImplementation(async (code) => {
      const saved = await real(code);
      return saved && { ...saved, settings: { ...saved.settings, risk: { ...saved.settings.risk, ...risk } } };
    });
  };
  const pair = async () => {
    const customer = await signIn(t, 'customer');
    const agent = await signIn(t, 'agent');
    await fund(t, customer);
    return { customer, agent };
  };
  const accepted = async (customer: Person, agent: Person) => {
    const errand = await createErrand(t, customer);
    await act(t, agent, errand.id, 'accept');
    return errand;
  };

  it('flags a customer and agent who used one Wi-Fi network, and keeps only a keyed hash of the address', async () => {
    const { customer, agent } = await pair();
    const ip = randomIp();
    await from(customer, ip, 'wifi');
    await from(agent, ip, 'wifi');
    const errand = await accepted(customer, agent);
    const [flag] = await flagsFor({ errand: errand.id });
    expect(flag).toMatchObject({ kind: 'pair_shared_network', details: { by: ['wifi'] } });
    expect(flag!.people.map((p) => p.id).sort()).toEqual([customer.userId, agent.userId].sort());
    const kept = await t.db.select().from(userNetworks).where(eq(userNetworks.userId, customer.userId));
    expect(kept).toEqual([
      expect.objectContaining({ kind: 'wifi', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    ]);
    expect(JSON.stringify([kept, flag])).not.toContain(ip);
  });

  it("doesn't count a phone network's or a VPN's address, which thousands share, or an unknown one", async () => {
    const { customer, agent } = await pair();
    const ip = randomIp();
    for (const network of ['cellular', 'vpn', undefined]) {
      await from(customer, ip, network);
      await from(agent, ip, network);
    }
    const errand = await accepted(customer, agent);
    expect(await flagsFor({ errand: errand.id })).toEqual([]);
    expect(await t.db.select().from(userNetworks).where(eq(userNetworks.userId, customer.userId))).toEqual([]);
  });

  it("doesn't count a busy address, such as a shop's Wi-Fi, or one used long ago", async () => {
    withRisk({ busyNetworkAccounts: 3 });
    const { customer, agent } = await pair();
    const busy = randomIp();
    for (const who of [customer, agent, await signIn(t, 'customer'), await signIn(t, 'customer')]) {
      await from(who, busy, 'wifi');
    }
    const old = randomIp();
    await from(customer, old, 'wifi');
    await from(agent, old, 'wifi');
    await settled();
    // Past the days Settings look back over.
    await t.db
      .update(userNetworks)
      .set({ lastSeenAt: sql`now() - interval '60 days'` })
      .where(eq(userNetworks.fingerprint, t.app.get(NetworksService).fingerprint(old)));
    const errand = await accepted(customer, agent);
    expect(await flagsFor({ errand: errand.id })).toEqual([]);
  });

  it('forgets addresses after 90 days', async () => {
    const who = await signIn(t, 'customer');
    await from(who, randomIp(), 'wifi');
    await settled();
    await t.db
      .update(userNetworks)
      .set({ lastSeenAt: sql`now() - interval '91 days'` })
      .where(eq(userNetworks.userId, who.userId));
    await t.app.get(NetworksService).prune();
    expect(await t.db.select().from(userNetworks).where(eq(userNetworks.userId, who.userId))).toEqual([]);
  });

  describe('the same face', () => {
    const customer = async () => {
      const who = await signIn(t, 'customer', { unverified: true });
      await request(t.http).patch('/v1/me').set(who.headers).send({ firstName: 'Ada', lastName: 'Obi' }).expect(200);
      return who;
    };
    const checkId = async (who: Person, idNumber = uniqueNin()) => {
      await request(t.http)
        .post('/v1/me/identity')
        .set(who.headers)
        .send({ idType: 'nin', idNumber, consent: true })
        .expect(200);
      return (await request(t.http).post('/v1/me/identity/finish').set(who.headers).expect(200)).body;
    };
    const referenceOf = async (who: Person) =>
      (
        await t.db
          .select({ reference: customerVerifications.reference })
          .from(customerVerifications)
          .where(eq(customerVerifications.userId, who.userId))
      )[0]!.reference;
    /** The identity provider says the next check's face was seen on these earlier checks. */
    const providerFinds = (related: NonNullable<IdentityResult['related']>) => {
      const real = FakeIdentityAdapter.prototype.identityResult;
      vi.spyOn(FakeIdentityAdapter.prototype, 'identityResult').mockImplementation(async function (
        this: FakeIdentityAdapter,
        reference: string,
      ) {
        const result = await real.call(this, reference);
        return result.status === 'done' ? { ...result, related } : result;
      });
    };

    it("flags a face the provider found on another person's check with another ID, for verification", async () => {
      const first = await customer();
      await checkId(first);
      const second = await customer();
      providerFinds([{ reference: await referenceOf(first), face: true, idNumber: false }]);
      await checkId(second);
      const [flag] = await flagsFor({ person: second.userId }, 'verification');
      expect(flag).toMatchObject({ kind: 'same_face', details: { sameIdNumber: false } });
      expect(flag!.people.map((p) => p.id).sort()).toEqual([first.userId, second.userId].sort());
    });

    it("ignores matches it can't tie to another account, and matches on the ID number alone", async () => {
      const first = await customer();
      await checkId(first);
      const second = await customer();
      providerFinds([
        { reference: 'cid-not-ours', face: true, idNumber: false },
        { reference: await referenceOf(first), face: false, idNumber: true },
      ]);
      await checkId(second);
      expect(await flagsFor({ person: second.userId }, 'verification')).toEqual([]);
    });
  });
});
