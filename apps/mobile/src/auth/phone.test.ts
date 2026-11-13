import { describe, expect, it } from 'vitest';
import { formatE164, formatNational, nationalDigits, plausibleNumber, toE164 } from './phone';

describe('phone input', () => {
  it('accepts the ways people type Nigerian numbers', () => {
    for (const typed of ['0803 123 4567', '803-123-4567', '+234 803 123 4567', '2348031234567']) {
      expect(nationalDigits(typed, '+234')).toBe('8031234567');
    }
    expect(toE164('+234', '8031234567')).toBe('+2348031234567');
  });

  it('works with another country prefix', () => {
    expect(nationalDigits('024 123 4567', '+233')).toBe('241234567');
    expect(nationalDigits('+233 24 123 4567', '+233')).toBe('241234567');
  });

  it('only sends numbers long enough to check', () => {
    expect(plausibleNumber('8031234567')).toBe(true);
    expect(plausibleNumber('80312')).toBe(false);
  });

  it('formats for display', () => {
    expect(formatNational('80312')).toBe('803 12');
    expect(formatE164('+2348031234567', '+234')).toBe('+234 803 123 4567');
  });
});
