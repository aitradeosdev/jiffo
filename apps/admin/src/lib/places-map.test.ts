import { describe, expect, it } from 'vitest';
import { cityQuery, focusBox, mapNotice, stateQuery } from './places-map';

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

  it('looks a state up as a state, and a city in its state, so the map goes to the right one', () => {
    expect(stateQuery('Lagos')).toBe('Lagos State');
    expect(stateQuery('Cross River')).toBe('Cross River State');
    // Already named as what it is.
    expect(stateQuery('Federal Capital Territory')).toBe('Federal Capital Territory');
    expect(stateQuery('Kano State')).toBe('Kano State');
    expect(cityQuery('  Ikeja ', 'Lagos')).toBe('Ikeja, Lagos State');
    expect(cityQuery('Abuja', 'Federal Capital Territory')).toBe('Abuja, Federal Capital Territory');
  });

  it('shows the box the maps provider gave, or a box around the point it found, wider for a state', () => {
    const bounds = { west: 2.7, south: 6.37, east: 4.35, north: 6.7 };
    expect(focusBox({ name: 'Lagos', lat: 6.5, lng: 3.5, bounds }, 'state')).toEqual(bounds);
    const city = focusBox({ name: 'Ikeja', lat: 6.6, lng: 3.35, bounds: null }, 'city');
    const state = focusBox({ name: 'Kano', lat: 12, lng: 8.5, bounds: null }, 'state');
    expect(city.west).toBeLessThan(3.35);
    expect(city.east).toBeGreaterThan(3.35);
    expect(city.south).toBeLessThan(6.6);
    expect(city.north).toBeGreaterThan(6.6);
    expect(state.east - state.west).toBeGreaterThan((city.east - city.west) * 4);
  });
});
