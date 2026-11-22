import type { MapPoint } from './types';

/** A Mapbox position: longitude, then latitude. */
export type Position = [number, number];

/** The box around the points, as Mapbox's camera fits it: its north-east corner, then its south-west. */
export function boxOf(points: MapPoint[]): { ne: Position; sw: Position } | null {
  if (!points.length) return null;
  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;
  for (const p of points) {
    north = Math.max(north, p.lat);
    south = Math.min(south, p.lat);
    east = Math.max(east, p.lng);
    west = Math.min(west, p.lng);
  }
  return { ne: [east, north], sw: [west, south] };
}

/** Room left around the pins when fitting, as Mapbox takes it: top, right, bottom, left. */
export const fitPadding = (insets: { top: number; bottom: number }, edge: number) => [
  insets.top + edge,
  edge,
  insets.bottom + edge,
  edge,
];
