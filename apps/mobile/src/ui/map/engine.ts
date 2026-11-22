/** Whose map the app draws: Google's, Mapbox's, or Apple's on an iPhone built without its Google key. */
export type MapEngine = 'google' | 'mapbox' | 'apple';

/** The map the API says to draw (its maps provider's own), and its public key for the apps. */
export interface LiveMap {
  engine: 'google' | 'mapbox' | null;
  key: string | null;
}

/**
 * The maps provider's own map, as the API says: Google's terms and Mapbox's each keep their places on their own
 * map. Mapbox's needs its token from the API and its engine in the build (every build since it was added). Google's
 * needs its key built into an iPhone build, so one made without GOOGLE_MAPS_IOS_API_KEY (a development build, say)
 * draws Apple's. Until the API has said, the map is drawn as built.
 */
export function mapEngine(
  os: string,
  googleMapsOnIos: boolean,
  live: LiveMap | null,
  mapboxInBuild: boolean,
): MapEngine {
  if (live?.engine === 'mapbox' && live.key && mapboxInBuild) return 'mapbox';
  if (os === 'ios') return googleMapsOnIos ? 'google' : 'apple';
  return 'google';
}
