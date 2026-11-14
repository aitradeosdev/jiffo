import { yearsOld } from '@jiffo/shared';

/** A date of birth with the age; masked until revealed (D5), the year is all there is to show. */
export const birth = (date: string | null, masked = false) =>
  !date ? '—' : masked ? `Born ${date.slice(0, 4)}` : `${date} · ${yearsOld(date)} years old`;
