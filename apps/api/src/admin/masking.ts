/**
 * Personal details as staff see them until they reveal them with a reason (docs/security-plan.md, D5):
 * enough to tell people apart, not enough to use.
 */

/** "Tunde Adewale Bakare" → "T••• A••• B•••". */
export const maskName = (name: string | null) =>
  name
    ? name
        .trim()
        .split(/\s+/)
        .map((w) => `${w[0]?.toUpperCase() ?? ''}•••`)
        .join(' ')
    : null;

/** "1990-04-12" → "1990-••-••": the year, for an age, and nothing more. */
export const maskDate = (date: string | null) => (date ? `${date.slice(0, 4)}-••-••` : null);

/** "14 Fola Osibo Road, Lekki Phase 1" → "…, Lekki Phase 1": the area only. */
export const maskAddress = (address: string | null) => {
  if (!address) return null;
  const parts = address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length > 1 ? `…, ${parts.at(-1)}` : '…';
};

/** "+2348034471902" → "+234•••••••902". */
export const maskPhone = (phone: string | null) =>
  phone ? `${phone.slice(0, 4)}${'•'.repeat(Math.max(0, phone.length - 7))}${phone.slice(-3)}` : null;
