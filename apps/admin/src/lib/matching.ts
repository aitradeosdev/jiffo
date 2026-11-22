/** How the matching dashboard and offer log say their figures (docs/matching.md, M15). */

/** A time in seconds: "45 s", "1 min 30 s", "1 h 5 min"; a dash with none to go by. */
export function duration(seconds: number | null): string {
  if (seconds === null) return '—';
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 3_600) {
    const rest = s % 60;
    return `${Math.floor(s / 60)} min${rest ? ` ${rest} s` : ''}`;
  }
  const minutes = Math.round((s % 3_600) / 60);
  return `${Math.floor(s / 3_600)} h${minutes ? ` ${minutes} min` : ''}`;
}

/** A share or rate from 0 to 1, as a whole percentage; a dash with none to go by. */
export const share = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

/** The parts of an offer's score, in points out of 100, leaving out the total and any part at 0. */
export function partsText(parts: Record<string, number>): string {
  return Object.entries(parts)
    .filter(([k, v]) => k !== 'total' && Math.round(v * 100) !== 0)
    .map(([k, v]) => `${k} ${Math.round(v * 100)}`)
    .join(' · ');
}

export type OfferStatus = 'open' | 'accepted' | 'declined' | 'expired' | 'withdrawn';

/** What became of an offer. */
export const OFFER_STATUS: Record<OfferStatus, { label: string; tone: 'neutral' | 'brand' | 'warn' | 'danger' }> = {
  open: { label: 'Waiting', tone: 'warn' },
  accepted: { label: 'Accepted', tone: 'brand' },
  declined: { label: 'Declined', tone: 'neutral' },
  expired: { label: 'Ran out', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
