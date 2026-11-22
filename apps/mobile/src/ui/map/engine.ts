/**
 * Whose map the app draws: Google's, Mapbox's, or Apple's on an iPhone built without its Google key; or none yet,
 * until the API has said which.
 */
export type MapEngine = 'google' | 'mapbox' | 'apple' | 'none';

/** The map the API says to draw (its maps provider's own), and its public key for the apps. */
export interface LiveMap {
  engine: 'google' | 'mapbox' | null;
  key: string | null;
}

/**
 * The maps provider's own map, as the API says: Google's terms and Mapbox's each keep their places on their own
 * map. Mapbox's needs its token from the API and its engine in the build (every build since it was added). Google's
 * needs its key built into an iPhone build, so one made without GOOGLE_MAPS_IOS_API_KEY (a development build, say)
 * draws Apple's. With no maps provider of its own (the development stand-in), the map is drawn as built; so it is in
 * an older build without Mapbox's engine, given new code over the air, as that build always drew it.
 */
export function mapEngine(
  os: string,
  googleMapsOnIos: boolean,
  live: LiveMap | null,
  mapboxInBuild: boolean,
): MapEngine {
  // Not yet known: nothing is drawn, rather than Google's map with places Mapbox found, even for a moment.
  if (!live) return 'none';
  if (live.engine === 'mapbox' && mapboxInBuild) return live.key ? 'mapbox' : 'none';
  if (os === 'ios') return googleMapsOnIos ? 'google' : 'apple';
  return 'google';
}
