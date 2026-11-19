import { describe, expect, it } from 'vitest';
import { networkOf } from '../src/risk/networks.service';

/** What counts as one network (docs/security-plan.md, E6). */
describe('networks', () => {
  it('takes an IPv4 address whole, however it is written', () => {
    expect(networkOf('102.89.4.7')).toBe('102.89.4.7');
    expect(networkOf('::ffff:102.89.4.7')).toBe('102.89.4.7');
  });

  it("takes an IPv6 address's first half, which a home network keeps while each phone's own half changes", () => {
    const home = networkOf('2c0f:2a80:0:1f00:1c4e:9a2b:77d1:4a01');
    expect(networkOf('2c0f:2a80:0:1f00:8f21:3:9bc0:12')).toBe(home);
    expect(networkOf('2C0F:2A80:0000:1F00::1')).toBe(home);
    expect(networkOf('2c0f:2a80:0:1f01::1')).not.toBe(home);
    expect(networkOf('2c0f::1')).toBe('2c0f:0:0:0');
  });
});
