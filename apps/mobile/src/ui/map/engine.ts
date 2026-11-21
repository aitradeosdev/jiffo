/** Whose map the app draws: Google's, or Apple's on an iPhone built without its Google key. */
export type MapEngine = 'google' | 'apple';

/**
 * Places are found with Google (the API's maps provider), and Google's terms keep its results off other
 * companies' maps, so both phones draw Google's map. An iPhone build made without GOOGLE_MAPS_IOS_API_KEY (a
 * development build, say) has no Google engine in it, so it draws Apple's.
 */
export function mapEngine(os: string, googleMapsOnIos: boolean): MapEngine {
  if (os === 'ios') return googleMapsOnIos ? 'google' : 'apple';
  return 'google';
}
