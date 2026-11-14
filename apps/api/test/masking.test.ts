import { describe, expect, it } from 'vitest';
import { maskAddress, maskDate, maskName, maskPhone } from '../src/admin/masking';

describe('masking personal details (D5)', () => {
  it('keeps enough to tell people apart, not enough to use', () => {
    expect(maskName('Tunde  Adewale Bakare')).toBe('T••• A••• B•••');
    expect(maskDate('1990-04-12')).toBe('1990-••-••');
    expect(maskAddress('14 Fola Osibo Road, Lekki Phase 1')).toBe('…, Lekki Phase 1');
    expect(maskAddress('14 Fola Osibo Road')).toBe('…');
    expect(maskPhone('+2348034471902')).toBe('+234•••••••902');
    expect(maskPhone('08034471902')).toBe('0803••••902');
  });

  it('never shows a short number whole', () => {
    expect(maskPhone('0803447')).toBe('•••••47');
    expect(maskPhone('1234')).toBe('••••');
    for (let n = 1; n <= 16; n++) {
      const phone = '9'.repeat(n);
      expect(maskPhone(phone)).toContain('•');
      expect(maskPhone(phone)).toHaveLength(n);
    }
  });
});
