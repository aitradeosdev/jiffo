/** The board's orders (docs/matching.md, M11): "Best for you" is the server's own; the rest the agent picks. */
export type BoardSort = 'best' | 'near' | 'fee' | 'newest' | 'buy';

interface Sortable {
  distanceMeters: number;
  agentEarnsKobo: number;
  createdAt: string;
  buy: boolean;
}

/** The board in the order the agent chose; "Buying items" shows only those. */
export function sortBoard<T extends Sortable>(list: T[], sort: BoardSort): T[] {
  const out = [...list];
  if (sort === 'near') out.sort((a, b) => a.distanceMeters - b.distanceMeters);
  if (sort === 'fee') out.sort((a, b) => b.agentEarnsKobo - a.agentEarnsKobo);
  if (sort === 'newest') out.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (sort === 'buy') return out.filter((j) => j.buy);
  return out;
}

/** Metres between two places, on the earth's surface. */
function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
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
  return !last || now - last.when >= EVERY_MS || metersBetween(last.at, at) >= MOVED_METERS;
}
