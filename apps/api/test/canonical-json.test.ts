import { describe, expect, it } from 'vitest';
import { canonicalJson } from '../src/common/canonical-json';

/** The text an evidence pack's SHA-256 is of (docs/security-plan.md, E8). */
describe('canonical JSON', () => {
  it('puts keys in order at every level, so storage order never changes the hash', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"e":2,"f":1}]},"b":1}',
    );
  });

  it('writes dates as JSON does, so different times give different text', () => {
    expect(canonicalJson({ at: new Date('2026-01-01T00:00:00Z') })).toBe('{"at":"2026-01-01T00:00:00.000Z"}');
    expect(canonicalJson({ at: new Date('2026-01-01T00:00:00Z') })).not.toBe(
      canonicalJson({ at: new Date('2027-01-01T00:00:00Z') }),
    );
  });
});
