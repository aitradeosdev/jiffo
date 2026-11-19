import { describe, expect, it } from 'vitest';
import { oneOf, safeLinkPath, wholeNumber } from './links';

describe('links into the app (docs/security-plan.md, MB5)', () => {
  it('opens only the screens other apps and pages may send people to, without their parameters', () => {
    expect(safeLinkPath('jiffo://identity-done')).toBe('/identity-done');
    expect(safeLinkPath('jiffo-agent://identity-done?for=agent')).toBe('/identity-done');
    expect(safeLinkPath('jiffo:///identity-done/')).toBe('/identity-done');
    expect(safeLinkPath('/identity-done')).toBe('/identity-done');
    expect(safeLinkPath('jiffo://')).toBe('/');
    // Anything else opens the app's start, which sends a signed-out visitor to sign in.
    for (const link of [
      'jiffo://withdraw?amount=100000',
      'jiffo-agent://pin?reset=1',
      'jiffo://errand/../../wallet',
      'jiffo://errand/%2e%2e%2fwallet',
      'jiffo://payout-account',
      'jiffo://identity-done/../withdraw',
      'jiffo://IDENTITY-DONE',
      'https://evil.example/identity-done',
      'javascript:alert(1)',
      '%E0%A4%A',
    ]) {
      expect(safeLinkPath(link), link).toBe('/');
    }
  });

  it('reads a parameter only as one of the values it may have', () => {
    expect(oneOf('dropoff', ['pickup', 'dropoff'] as const, 'pickup')).toBe('dropoff');
    expect(oneOf('__proto__', ['pickup', 'dropoff'] as const, 'pickup')).toBe('pickup');
    expect(oneOf(['dropoff', 'pickup'], ['pickup', 'dropoff'] as const, 'pickup')).toBe('pickup');
    expect(oneOf(undefined, ['pickup'] as const, 'pickup')).toBe('pickup');
  });

  it('reads a number parameter as a whole number in range, or not at all', () => {
    expect(wholeNumber('250000', { max: 10_000_000 })).toBe(250000);
    expect(wholeNumber('2.5', { max: 10 })).toBeNull();
    expect(wholeNumber('1e9', { max: 10_000_000 })).toBeNull();
    expect(wholeNumber('-5', { max: 10 })).toBeNull();
    expect(wholeNumber('99999999999', { max: 10_000_000 })).toBeNull();
    expect(wholeNumber('abc', { max: 10 })).toBeNull();
    expect(wholeNumber(undefined, { max: 10 })).toBeNull();
  });
});

describe('errand ids from the address', () => {
  it('are only ids, since they go into API paths', async () => {
    const { errandIdParam } = await import('./links');
    expect(errandIdParam('3f1c2b9e-6d4a-4c1e-9b7a-2a5d8e9f0c11')).toBe('3f1c2b9e-6d4a-4c1e-9b7a-2a5d8e9f0c11');
    expect(errandIdParam('../wallet')).toBeNull();
    expect(errandIdParam(['3f1c2b9e-6d4a-4c1e-9b7a-2a5d8e9f0c11'])).toBeNull();
    expect(errandIdParam(undefined)).toBeNull();
  });
});
