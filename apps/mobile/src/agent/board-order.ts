import { haversineMeters } from '@jiffo/shared';

/** The board's orders (docs/matching.md, M11): "Best for you" is the server's own; the rest the agent picks. */
export type BoardSort = 'best' | 'near' | 'fee' | 'newest' | 'buy';

interface Sortable {
  distanceMeters: number;
  feeKobo: number;
  createdAt: string;
  buy: boolean;
}

/** The board in the order the agent chose; "Buying items" shows only those. */
export function sortBoard<T extends Sortable>(list: T[], sort: BoardSort): T[] {
  const out = [...list];
  if (sort === 'near') out.sort((a, b) => a.distanceMeters - b.distanceMeters);
  // By the fee each card shows.
  if (sort === 'fee') out.sort((a, b) => b.feeKobo - a.feeKobo);
  if (sort === 'newest') out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (sort === 'buy') return out.filter((j) => j.buy);
  return out;
}

/** Moved this far, or this long since, the app tells the server again where to watch the board. */
const MOVED_METERS = 1_000;
const EVERY_MS = 5 * 60_000;

/** Whether to watch the board again from here: first time, after moving a km, or every five minutes. */
export function watchAgain(
  last: { at: { lat: number; lng: number }; when: number } | null,
  at: { lat: number; lng: number },
  now: number,
) {
  return !last || now - last.when >= EVERY_MS || haversineMeters(last.at, at) >= MOVED_METERS;
}
