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
