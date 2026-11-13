import { describe, expect, it } from 'vitest';
import { clientIp } from './client-ip';

describe('clientIp', () => {
  it('reads the address the nearest trusted hop saw', () => {
    expect(clientIp('203.0.113.9', 0)).toBe('203.0.113.9');
    expect(clientIp('203.0.113.9', 1)).toBe('203.0.113.9');
    // A client that writes its own header can't choose the address behind one load balancer.
    expect(clientIp('6.6.6.6, 203.0.113.9', 1)).toBe('203.0.113.9');
    expect(clientIp('6.6.6.6, 203.0.113.9, 10.0.0.2', 2)).toBe('203.0.113.9');
  });

  it('gives nothing when the header is missing or too short', () => {
    expect(clientIp(null, 1)).toBeNull();
    expect(clientIp('', 0)).toBeNull();
    expect(clientIp('203.0.113.9', 2)).toBeNull();
  });
});
