import { describe, expect, it } from 'vitest';
import { mapNotice } from './places-map';

/** Settings, Places draws the map of the maps provider in use (docs/admin-panel.md, Places). */
describe('the Places map', () => {
  it("draws the maps provider's own map once it has a key for the panel", () => {
    expect(mapNotice({ engine: 'google', key: 'AIza-x' })).toBeNull();
    expect(mapNotice({ engine: 'mapbox', key: 'pk.x' })).toBeNull();
  });

  it('says which key is missing, and that shapes can be pasted meanwhile', () => {
    expect(mapNotice({ engine: 'google', key: null })).toMatch(/Google Maps Platform.*Panel map key.*pasted/s);
    expect(mapNotice({ engine: 'mapbox', key: null })).toMatch(/Mapbox.*Map token for the panel.*pasted/s);
  });

  it('says when the maps provider in use has no map of its own', () => {
    expect(mapNotice({ engine: null, key: null })).toMatch(/Google Maps or Mapbox.*pasted/s);
  });
});
