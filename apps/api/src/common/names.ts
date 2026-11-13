/** Lower case with accents removed, so "Túndé" on a profile matches "TUNDE" at the bank. */
export const plainName = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The words in a name, for comparing a bank's account name with a person's profile name. */
export const nameWords = (text: string) =>
  new Set(
    plainName(text)
      .split(/[^a-z]+/)
      .filter(Boolean),
  );

/**
 * Whether a name (a bank account's, or the one in the app) belongs to the person on the ID's record: it has
 * at least two words, and every one of them is in the legal name. Banks and apps drop middle names, but they
 * can't add a name that isn't on the record.
 */
export function matchesLegalName(name: string, legalName: string) {
  const legal = nameWords(legalName);
  const words = [...nameWords(name)];
  return words.length >= 2 && words.every((w) => legal.has(w));
}
