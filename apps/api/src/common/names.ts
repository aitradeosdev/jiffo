/** Lower case with accents removed, so "Túndé" on a profile matches "TUNDE" at the bank. */
export const plainName = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The words in a name, for comparing a bank's account name with a person's profile name. */
export const nameWords = (text: string) =>
  new Set(
    plainName(text)
      .split(/[^a-z]+/)
      .filter(Boolean),
  );
