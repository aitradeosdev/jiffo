/**
 * The map Settings, Places draws (docs/admin-panel.md, Places): the maps provider's own, as its terms keep its places
 * on its own map, with its public key for the panel. `engine` null: the provider in use has none.
 */
export interface PlacesMapInfo {
  engine: 'google' | 'mapbox' | null;
  key: string | null;
}

/** Why no map can be drawn, or null when one can. */
export function mapNotice(map: PlacesMapInfo): string | null {
  if (map.engine && map.key) return null;
  if (map.engine === 'google') {
    return 'The map needs a key for the browser: add one under Settings, Providers, Maps, Google Maps Platform, as "Panel map key". Until then, shapes can be pasted as GeoJSON.';
  }
  if (map.engine === 'mapbox') {
    return 'The map needs a public token: add one under Settings, Providers, Maps, Mapbox, as "Map token for the panel" or "Map token for the apps". Until then, shapes can be pasted as GeoJSON.';
  }
  return 'The map is drawn by the maps provider in use: switch on Google Maps or Mapbox under Settings, Providers. Until then, shapes can be pasted as GeoJSON.';
}

/** A box on the map: its west and east longitudes, and its south and north latitudes. */
export interface MapBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** A state or city the maps provider found by name: its middle and, where the provider gave one, its box. */
export interface Located {
  name: string;
  lat: number;
  lng: number;
  bounds: MapBox | null;
}

/** Where the map goes: `key` changes each time it should go there, even to the same box again. */
export interface MapFocus {
  key: string;
  box: MapBox;
}

/** Countries whose first-level regions are named "… State", which finds them as the region and not a city. */
const STATE_NAMED = new Set(['NG']);
/** Named as what it is already. */
const namedAsState = (name: string) => /\b(state|territory)$/i.test(name);

/** The words a state is looked up by. */
export function stateQuery(name: string, countryCode: string) {
  const trimmed = name.trim();
  return STATE_NAMED.has(countryCode.toUpperCase()) && !namedAsState(trimmed) ? `${trimmed} State` : trimmed;
}

/** The words a city is looked up by: in its state, as many towns share a name. */
export function cityQuery(name: string, stateName: string, countryCode: string) {
  return `${name.trim()}, ${stateQuery(stateName, countryCode)}`;
}

/** About how far each reaches from its middle, in degrees, when the provider gave no box: a state, or a city. */
const REACH = { state: 1, city: 0.12 } as const;

/** The box to show: the provider's own, or one around the point it found. */
export function focusBox(found: Located, kind: 'state' | 'city'): MapBox {
  if (found.bounds) return found.bounds;
  const r = REACH[kind];
  return { west: found.lng - r, south: found.lat - r, east: found.lng + r, north: found.lat + r };
}
