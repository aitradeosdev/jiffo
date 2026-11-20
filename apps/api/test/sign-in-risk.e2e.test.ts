import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cloudIpRanges, devices, riskFlags } from '../src/db/schema';
import { CloudRangesService } from '../src/risk/cloud-ranges.service';
import { RiskFlagsService } from '../src/risk/risk-flags.service';
import { createTestApp, randomIp, randomPhone, type TestApp } from './helpers';

/**
 * Risk at sign-up and sign-in (docs/security-plan.md, A10): what the app found on the phone, how many accounts
 * have used it, a VPN, and an address in a cloud provider's published ranges. Each adds to a score; a high one
 * asks for more (a selfie before an agent's money moves, a person to look in the Risk queue), and never stops
 * the sign-in.
 */
describe('sign-in risk', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  /** Signs in as the app does, with what it says about the phone and the connection. */
  const signIn = async (
    app: 'customer' | 'agent',
    options: { signals?: string; network?: string; ip?: string; phoneId?: string } = {},
  ) => {
    const phone = randomPhone();
    const ip = options.ip ?? randomIp();
    await request(t.http).post('/v1/auth/otp/request').set('x-forwarded-for', ip).send({ phone }).expect(200);
    const code = t.messaging.lastCodeFor(phone);
    const key = randomUUID();
    const res = await request(t.http)
      .post('/v1/auth/otp/verify')
      .set('x-forwarded-for', ip)
      .set(options.signals ? { 'x-jiffo-risk': options.signals } : {})
      .set(options.network ? { 'x-jiffo-network': options.network } : {})
      .send({ phone, code, app, device: { key, platform: 'android', name: 'Test phone', phoneId: options.phoneId } })
      .expect(200);
    const userId = res.body.user.id as string;
    // The flag is raised beside the sign-in.
    await t.app.get(RiskFlagsService).settled();
    const [device] = await t.db
      .select()
      .from(devices)
      .where(and(eq(devices.userId, userId), eq(devices.deviceKey, key)));
    const flags = await t.db
      .select()
      .from(riskFlags)
      .where(and(eq(riskFlags.userId, userId), eq(riskFlags.kind, 'risky_sign_in')));
    return { userId, device: device!, flags };
  };

  it('scores an emulator high: an agent needs a selfie before money moves, and a person looks', async () => {
    const { device, flags } = await signIn('agent', { signals: 'emulator' });
    expect(device.signInRiskScore).toBeGreaterThanOrEqual(3);
    expect(device.signInRiskReasons).toEqual(['emulator']);
    expect(device.selfieNeeded).toBe(true);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ queue: 'risk', details: expect.objectContaining({ reasons: ['emulator'] }) });
  });

  it('lets a risky customer sign in, and asks a person to look, as customers have no selfie step', async () => {
    const { device, flags } = await signIn('customer', { signals: 'rooted,hooking' });
    expect(device.signInRiskReasons).toEqual(['rooted', 'hooking']);
    expect(flags).toHaveLength(1);
  });

  it('counts a VPN on its own as a little risk: kept, but nothing more is asked', async () => {
    const { device, flags } = await signIn('agent', { network: 'vpn' });
    expect(device.signInRiskReasons).toEqual(['vpn']);
    expect(device.selfieNeeded).toBe(false);
    expect(flags).toEqual([]);
  });

  it("scores an address in a cloud provider's published ranges, and names the provider", async () => {
    await t.db.insert(cloudIpRanges).values({ provider: 'aws', range: '198.18.42.0/24' }).onConflictDoNothing();
    const { device, flags } = await signIn('agent', { ip: '198.18.42.7' });
    expect(device.signInRiskReasons).toEqual(['data_centre']);
    expect(flags[0]?.details).toMatchObject({ provider: 'aws' });
    expect(device.selfieNeeded).toBe(true);
  });

  it('scores a phone several accounts have signed in on', async () => {
    const phoneId = `phone-${randomUUID()}`;
    const first = await signIn('customer', { phoneId });
    const second = await signIn('customer', { phoneId });
    expect(first.device.signInRiskReasons).toEqual([]);
    expect(second.device.signInRiskReasons).toEqual([]);
    const third = await signIn('agent', { phoneId });
    expect(third.device.signInRiskReasons).toEqual(['shared_phone']);
    expect(third.flags[0]?.details).toMatchObject({ accounts: 3 });
  });

  it('asks nothing of an ordinary sign-in', async () => {
    const { device, flags } = await signIn('agent', { network: 'wifi' });
    expect(device).toMatchObject({ signInRiskScore: 0, signInRiskReasons: [] });
    expect(flags).toEqual([]);
  });

  describe("cloud providers' published ranges", () => {
    it('reads each list, IPv4 and IPv6', () => {
      const ranges = t.app.get(CloudRangesService);
      expect(
        ranges.parse(
          'aws',
          JSON.stringify({
            prefixes: [{ ip_prefix: '3.5.140.0/22' }],
            ipv6_prefixes: [{ ipv6_prefix: '2600:1f14::/35' }],
          }),
        ),
      ).toEqual(['3.5.140.0/22', '2600:1f14::/35']);
      expect(
        ranges.parse(
          'google',
          JSON.stringify({ prefixes: [{ ipv4Prefix: '34.1.208.0/20' }, { ipv6Prefix: '2600:1900:4000::/44' }] }),
        ),
      ).toEqual(['34.1.208.0/20', '2600:1900:4000::/44']);
      expect(
        ranges.parse(
          'azure',
          JSON.stringify({ values: [{ properties: { addressPrefixes: ['4.144.0.0/17', '2603:1000::/40'] } }] }),
        ),
      ).toEqual(['4.144.0.0/17', '2603:1000::/40']);
      expect(ranges.parse('oracle', JSON.stringify({ regions: [{ cidrs: [{ cidr: '129.146.0.0/21' }] }] }))).toEqual([
        '129.146.0.0/21',
      ]);
      expect(ranges.parse('digitalocean', '5.101.96.0/21,NL,NL-NH,Amsterdam,1098 XG\n2400:6180::/48,SG,,,\n')).toEqual([
        '5.101.96.0/21',
        '2400:6180::/48',
      ]);
      // Anything that isn't an address range is left out.
      expect(ranges.parse('linode', '# comment\nnot-a-range,US\n45.33.0.0/17,US,,,\n')).toEqual(['45.33.0.0/17']);
    });

    it("replaces a provider's ranges on each refresh, and keeps them when its list can't be read", async () => {
      const ranges = t.app.get(CloudRangesService);
      await ranges.replace('vultr', ['192.0.2.0/24', '2001:db8:1::/48']);
      expect(await ranges.providerOf('192.0.2.9')).toBe('vultr');
      expect(await ranges.providerOf('2001:db8:1::5')).toBe('vultr');
      // A list that came back empty or broken changes nothing.
      await ranges.replace('vultr', []);
      expect(await ranges.providerOf('192.0.2.9')).toBe('vultr');
      await ranges.replace('vultr', ['192.0.3.0/24']);
      expect(await ranges.providerOf('192.0.2.9')).toBeNull();
      expect(await ranges.providerOf('not an address')).toBeNull();
    });
  });
});
