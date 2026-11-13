import { describe, expect, it } from 'vitest';
import { ID_TYPE_KEYS } from '@jiffo/shared';
import { ID_COPY, cleanIdNumber, idNumberOk } from './ids';

describe('ID numbers as the apps take them', () => {
  it('keeps each ID to the longest number the API accepts for it', () => {
    for (const type of ID_TYPE_KEYS) {
      const { digits, max } = ID_COPY[type];
      const longest = (digits ? '1' : 'A').repeat(max);
      // A passport starts with a letter and then digits, or is all letters and digits.
      expect(idNumberOk(type, longest), `${type} at ${max}`).toBe(true);
      expect(cleanIdNumber(type, longest + '9')).toBe(longest);
    }
  });

  it('cleans what is pasted or typed into the ID number field', () => {
    expect(cleanIdNumber('nin', '2201 384 5576')).toBe('22013845576');
    expect(cleanIdNumber('passport', 'a1234 5678')).toBe('A12345678');
    expect(cleanIdNumber('drivers_licence', 'lag-12345-aa12')).toBe('LAG12345AA12');
    expect(idNumberOk('voters_card', cleanIdNumber('voters_card', '90f5 b0a1 b2c3 d4e5 f67'))).toBe(true);
  });
});
