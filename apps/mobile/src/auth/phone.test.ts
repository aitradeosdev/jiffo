import { describe, expect, it } from 'vitest';
import { formatE164, formatNational, looksLikeMobile, nationalDigits, toE164 } from './phone';

describe('phone input', () => {
  it('accepts the ways people type Nigerian numbers', () => {
    for (const typed of ['0803 123 4567', '803-123-4567', '+234 803 123 4567', '2348031234567']) {
      expect(nationalDigits(typed)).toBe('8031234567');
    }
    expect(toE164('8031234567')).toBe('+2348031234567');
  });

  it('checks the mobile ranges and length', () => {
    expect(looksLikeMobile('8031234567')).toBe(true);
    expect(looksLikeMobile('7011234567')).toBe(true);
    expect(looksLikeMobile('2012345678')).toBe(false);
    expect(looksLikeMobile('803123456')).toBe(false);
  });

  it('formats for display', () => {
    expect(formatNational('80312')).toBe('803 12');
    expect(formatE164('+2348031234567')).toBe('+234 803 123 4567');
  });
});
