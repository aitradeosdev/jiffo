/** The open board (docs/matching.md, M11): its order, and the area cells live updates go by. */

interface BoardOrdered {
  /** How long the agent takes to reach the pickup, estimated or by road. */
  travelSeconds: number;
  /** What the agent earns per km of the whole trip. */
  perKmKobo: number;
  createdAt: string | Date;
}

/**
 * "Best for you", the board's own order: quickest to reach, by the whole minute, then most per km, then newest.
 * For Array.prototype.sort.
 */
export function byBestForYou(a: BoardOrdered, b: BoardOrdered) {
  return (
    Math.ceil(a.travelSeconds / 60) - Math.ceil(b.travelSeconds / 60) ||
    b.perKmKobo - a.perKmKobo ||
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

/** What the agent earns per km of the whole trip: to the pickup, then along the errand; one km at least. */
export function perKmKobo(earnsKobo: number, toPickupMeters: number, routeMeters: number) {
  return Math.round(earnsKobo / Math.max(1, (toPickupMeters + routeMeters) / 1000));
}

/** Cells of a tenth of a degree, about 11 km across in Nigeria, that board updates go to. */
const CELL_DEGREES = 0.1;
const CELL_KM = 11;

/** The cell a place is in. */
export function boardCell(at: { lat: number; lng: number }) {
  return `${Math.floor(at.lat / CELL_DEGREES)}:${Math.floor(at.lng / CELL_DEGREES)}`;
}

/**
 * The cells an agent watches: theirs and enough around it that any pickup within their reach is in one. Cells are
 * narrower east to west away from the equator, so more are watched that way there.
 */
export function boardCellsAround(at: { lat: number; lng: number }, reachKm: number) {
  const northSouth = Math.max(1, Math.ceil(reachKm / CELL_KM));
  const eastWest = Math.max(1, Math.ceil(reachKm / (CELL_KM * Math.max(0.1, Math.cos((at.lat * Math.PI) / 180)))));
  const lat = Math.floor(at.lat / CELL_DEGREES);
  const lng = Math.floor(at.lng / CELL_DEGREES);
  const cells: string[] = [];
  for (let i = -northSouth; i <= northSouth; i++) {
    for (let j = -eastWest; j <= eastWest; j++) cells.push(`${lat + i}:${lng + j}`);
  }
  return cells;
}
