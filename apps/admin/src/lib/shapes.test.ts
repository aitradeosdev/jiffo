import { describe, expect, it } from 'vitest';
import {
  shapeMissing,
  boundaryField,
  boundaryFrom,
  boundsOf,
  editableOnMap,
  parseBoundary,
  polygonsOf,
  type PolygonRings,
} from './shapes';

const square = (w: number, s: number, e: number, n: number): PolygonRings => [
  [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
    [w, s],
  ],
];

/** The shapes admin draws for cities and areas (Settings, Places), as the API takes them. */
describe('shapes', () => {
  it('make one polygon, or several, from what was drawn, closed and to 6 decimals', () => {
    expect(boundaryFrom([square(3.1234567, 6.4, 3.2, 6.5)])).toEqual({
      type: 'Polygon',
      coordinates: square(3.123457, 6.4, 3.2, 6.5),
    });
    // A ring drawn without its closing point is closed.
    const open = [square(3, 6, 4, 7)[0]!.slice(0, 4)];
    expect(boundaryFrom([open])).toEqual({ type: 'Polygon', coordinates: square(3, 6, 4, 7) });
    expect(boundaryFrom([square(3, 6, 3.1, 6.1), square(4, 7, 4.1, 7.1)])).toEqual({
      type: 'MultiPolygon',
      coordinates: [square(3, 6, 3.1, 6.1), square(4, 7, 4.1, 7.1)],
    });
    expect(boundaryFrom([])).toBeNull();
  });

  it('read a pasted shape: a polygon, several, or a GeoJSON feature or collection of them', () => {
    const polygon = { type: 'Polygon', coordinates: square(3, 6, 4, 7) };
    expect(parseBoundary(JSON.stringify(polygon))).toEqual({ boundary: polygon });
    expect(parseBoundary(JSON.stringify({ type: 'Feature', properties: {}, geometry: polygon }))).toEqual({
      boundary: polygon,
    });
    const collection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: polygon },
        { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: square(5, 8, 6, 9) } },
      ],
    };
    expect(parseBoundary(JSON.stringify(collection))).toEqual({
      boundary: { type: 'MultiPolygon', coordinates: [square(3, 6, 4, 7), square(5, 8, 6, 9)] },
    });
  });

  it('say what is wrong with a pasted shape that is not one', () => {
    expect(parseBoundary('not json').error).toMatch(/GeoJSON/);
    expect(parseBoundary(JSON.stringify({ type: 'Point', coordinates: [3, 6] })).error).toMatch(/polygon/i);
    expect(
      parseBoundary(
        JSON.stringify({
          type: 'Polygon',
          coordinates: [
            [
              [3, 6],
              [4, 6],
            ],
          ],
        }),
      ).error,
    ).toMatch(/at least/);
    expect(parseBoundary(JSON.stringify({ type: 'Polygon', coordinates: square(200, 6, 201, 7) })).error).toMatch(
      /longitude/i,
    );
  });

  it('take a boundary apart into its polygons, to edit, and find where to look on the map', () => {
    const multi = { type: 'MultiPolygon' as const, coordinates: [square(3, 6, 3.1, 6.1), square(4, 7, 4.1, 7.1)] };
    expect(polygonsOf(multi)).toEqual([square(3, 6, 3.1, 6.1), square(4, 7, 4.1, 7.1)]);
    expect(polygonsOf({ type: 'Polygon', coordinates: square(3, 6, 4, 7) })).toEqual([square(3, 6, 4, 7)]);
    expect(boundsOf([multi, { type: 'Polygon', coordinates: square(2, 5, 2.5, 5.5) }])).toEqual({
      west: 2,
      south: 5,
      east: 4.1,
      north: 7.1,
    });
    expect(boundsOf([])).toBeNull();
  });

  it('find where to look around very detailed shapes, without running out of stack', () => {
    const ring: [number, number][] = Array.from({ length: 200_000 }, (_, i) => [3 + i / 1e6, 6 + i / 1e6]);
    ring.push(ring[0]!);
    expect(boundsOf([{ type: 'Polygon', coordinates: [ring] }])).toEqual({
      west: 3,
      south: 6,
      east: 3 + 199_999 / 1e6,
      north: 6 + 199_999 / 1e6,
    });
  });

  it('say a shape with holes cannot be reshaped on the map, which would drop them', () => {
    expect(editableOnMap({ type: 'Polygon', coordinates: square(3, 6, 4, 7) })).toBe(true);
    const holed = { type: 'Polygon' as const, coordinates: [...square(3, 6, 4, 7), ...square(3.4, 6.4, 3.6, 6.6)] };
    expect(editableOnMap(holed)).toBe(false);
    expect(editableOnMap({ type: 'MultiPolygon', coordinates: [square(3, 6, 4, 7), holed.coordinates] })).toBe(false);
  });

  it('send a shape only when it is new or changed, so a rename alone keeps the shape as it is', () => {
    const shape = { type: 'Polygon' as const, coordinates: square(3, 6, 4, 7) };
    expect(boundaryField({ reshaping: false, changed: false, drawn: shape })).toBe(JSON.stringify(shape));
    expect(boundaryField({ reshaping: true, changed: false, drawn: shape })).toBe('');
    expect(boundaryField({ reshaping: true, changed: true, drawn: shape })).toBe(JSON.stringify(shape));
    expect(boundaryField({ reshaping: false, changed: true, drawn: null })).toBe('');
  });
});

/** A new city or area is a name and a shape: sent without one, the panel says what's missing (Places). */
describe('a new place without a shape', () => {
  it('is asked for its shape, drawn or pasted, before going to the server', () => {
    expect(shapeMissing('')).toMatch(/Draw the outline on the map, or paste one/);
    expect(shapeMissing('   ')).toMatch(/paste one/);
    expect(shapeMissing('{"type":"Polygon","coordinates":[]}')).toBeNull();
  });
});
