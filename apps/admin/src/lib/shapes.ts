/** A position as GeoJSON has it: [longitude, latitude]. */
export type Position = [number, number];
/** A polygon: its outline, then any holes, each a closed ring. */
export type PolygonRings = Position[][];

/** A city's or area's boundary as the API takes it (docs/admin-panel.md, Places). */
export type Boundary =
  { type: 'Polygon'; coordinates: PolygonRings } | { type: 'MultiPolygon'; coordinates: PolygonRings[] };

const round = (n: number) => Math.round(n * 1e6) / 1e6;

/** Each ring to 6 decimals (about 10 cm) and closed: its last point the same as its first. */
function tidy(rings: number[][][]): PolygonRings {
  return rings.map((ring) => {
    const points = ring.map(([lng, lat]) => [round(lng!), round(lat!)] as Position);
    const [first, last] = [points[0], points[points.length - 1]];
    if (first && last && (first[0] !== last[0] || first[1] !== last[1])) points.push([first[0], first[1]]);
    return points;
  });
}

/** The boundary from the polygons drawn: one polygon, several, or none yet. */
export function boundaryFrom(polygons: number[][][][]): Boundary | null {
  const tidied = polygons.map(tidy);
  if (!tidied.length) return null;
  return tidied.length === 1
    ? { type: 'Polygon', coordinates: tidied[0]! }
    : { type: 'MultiPolygon', coordinates: tidied };
}

/** A boundary's polygons, one by one. */
export const polygonsOf = (b: Boundary): PolygonRings[] => (b.type === 'Polygon' ? [b.coordinates] : b.coordinates);

/** The box around some boundaries, for the map to show them all; null when there are none. */
export function boundsOf(boundaries: Boundary[]) {
  const points = boundaries.flatMap((b) => polygonsOf(b).flat(2));
  if (!points.length) return null;
  const lngs = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  return { west: Math.min(...lngs), south: Math.min(...lats), east: Math.max(...lngs), north: Math.max(...lats) };
}

type Geometry = { type?: unknown; coordinates?: unknown };

/** Every polygon in a piece of GeoJSON: a geometry, a feature or a collection of features. */
function polygonsIn(value: unknown): number[][][][] | string {
  const v = value as { type?: unknown; geometry?: unknown; features?: unknown };
  if (v?.type === 'FeatureCollection' && Array.isArray(v.features)) {
    const all: number[][][][] = [];
    for (const feature of v.features) {
      const found = polygonsIn(feature);
      if (typeof found === 'string') return found;
      all.push(...found);
    }
    return all;
  }
  if (v?.type === 'Feature') return polygonsIn(v.geometry);
  const g = value as Geometry;
  if (g?.type === 'Polygon' && Array.isArray(g.coordinates)) return [g.coordinates as number[][][]];
  if (g?.type === 'MultiPolygon' && Array.isArray(g.coordinates)) return g.coordinates as number[][][][];
  return 'Paste a polygon: the shape must be an area, not a point or a line';
}

/** Why a ring can't be used, or null. */
function ringProblem(ring: unknown): string | null {
  if (!Array.isArray(ring) || ring.length < 3) return 'Each shape needs at least 3 points';
  for (const p of ring) {
    if (!Array.isArray(p) || typeof p[0] !== 'number' || typeof p[1] !== 'number')
      return 'A point is not [longitude, latitude]';
    if (Math.abs(p[0]) > 180) return 'A longitude is out of range: points are [longitude, latitude]';
    if (Math.abs(p[1]) > 90) return 'A latitude is out of range: points are [longitude, latitude]';
  }
  return null;
}

/**
 * A boundary from pasted GeoJSON (a polygon, several, or a feature or collection of them), for when the map can't
 * be used, or a shape was drawn in another tool. Says what is wrong when it isn't one.
 */
export function parseBoundary(text: string): { boundary?: Boundary; error?: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: "That isn't GeoJSON. Paste the shape's GeoJSON, as a tool like geojson.io exports it." };
  }
  const polygons = polygonsIn(value);
  if (typeof polygons === 'string') return { error: polygons };
  if (!polygons.length) return { error: 'Paste a polygon: no shape was found' };
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) return { error: 'Each shape needs at least 3 points' };
    for (const ring of polygon) {
      const problem = ringProblem(ring);
      if (problem) return { error: problem };
    }
  }
  return { boundary: boundaryFrom(polygons)! };
}
