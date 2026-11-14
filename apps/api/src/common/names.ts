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

/** How many single-letter changes turn one word into the other. */
function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j]!;
      row[j] = Math.min(above + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/** A word close to one in the legal name: an initial of it, or a spelling slip (one letter, two in a long word). */
const closeTo = (word: string, legal: Set<string>) =>
  [...legal].some(
    (l) =>
      (word.length === 1 && l.startsWith(word)) ||
      (word.length >= 4 && editDistance(word, l) <= (word.length >= 8 ? 2 : 1)),
  );

/**
 * How a name (a bank account's) compares with the legal name on the ID record:
 * - "match": every word is in the legal name (see matchesLegalName).
 * - "near": at least two words, one of them exactly in the legal name, and every other one close to a
 *   word in it (an initial, or a spelling slip). Support looks at these rather than refusing them
 *   (docs/security-plan.md, I4).
 * - "none": anything else.
 */
export function nameMatch(name: string, legalName: string): 'match' | 'near' | 'none' {
  if (matchesLegalName(name, legalName)) return 'match';
  const legal = nameWords(legalName);
  const words = [...nameWords(name)];
  if (words.length < 2 || !words.some((w) => legal.has(w))) return 'none';
  return words.every((w) => legal.has(w) || closeTo(w, legal)) ? 'near' : 'none';
}
