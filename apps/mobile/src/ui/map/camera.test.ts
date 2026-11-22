import { describe, expect, it } from 'vitest';
import { boxOf, fitPadding } from './camera';

/** Fitting the pins inside the space the controls and sheet leave free, on Mapbox's map. */
describe("the map's camera", () => {
  it('takes the box around the pins, north-east corner first, as Mapbox does, longitude before latitude', () => {
    const box = boxOf([
      { lat: 6.45, lng: 3.47 },
      { lat: 6.6, lng: 3.35 },
      { lat: 6.5, lng: 3.4 },
    ]);
    expect(box).toEqual({ ne: [3.47, 6.6], sw: [3.35, 6.45] });
    expect(boxOf([])).toBeNull();
  });

  it("keeps the pins clear of the controls above and the sheet below, and of the map's edges", () => {
    // Top, right, bottom, left.
    expect(fitPadding({ top: 120, bottom: 300 }, 56)).toEqual([176, 56, 356, 56]);
  });
});
