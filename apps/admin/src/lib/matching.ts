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
  // Whole minutes first, so 1 h 59.5 min is 2 h, never "1 h 60 min".
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
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

/**
 * How long the agent took to answer an offer. A withdrawn offer was ended by the errand (cancelled, or taken
 * another way), never by the agent, and one that ran out had no answer.
 */
export function answerText(status: OfferStatus, offeredAt: string, answeredAt: string | null): string {
  const after = answeredAt ? duration((Date.parse(answeredAt) - Date.parse(offeredAt)) / 1000) : null;
  if (status === 'accepted' || status === 'declined') return after ? `answered after ${after}` : '';
  if (status === 'withdrawn') return after ? `withdrawn after ${after}, unanswered` : 'withdrawn, unanswered';
  if (status === 'expired') return 'not answered';
  return '';
}

/** What became of an offer. */
export const OFFER_STATUS: Record<OfferStatus, { label: string; tone: 'neutral' | 'brand' | 'warn' | 'danger' }> = {
  open: { label: 'Waiting', tone: 'warn' },
  accepted: { label: 'Accepted', tone: 'brand' },
  declined: { label: 'Declined', tone: 'neutral' },
  expired: { label: 'Ran out', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
