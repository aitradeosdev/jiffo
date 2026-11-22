import { describe, expect, it } from 'vitest';
import { mapEngine } from './engine';

const google = { engine: 'google' as const, key: null };
const mapbox = { engine: 'mapbox' as const, key: 'pk.app-token' };

/**
 * Which company's map the apps draw: the maps provider's own, as the API says (its terms, Google's and Mapbox's
 * alike, keep its places on its own map). Google's needs its key built into an iPhone build, so one without it
 * (a development build, say) draws Apple's.
 */
describe('the map the apps draw', () => {
  it("is Google's while Google finds places, on Android and on an iPhone built with its key", () => {
    expect(mapEngine('android', false, google, true)).toBe('google');
    expect(mapEngine('ios', true, google, true)).toBe('google');
    expect(mapEngine('ios', false, google, true)).toBe('apple');
  });

  it("is Mapbox's while Mapbox finds places, on both phones", () => {
    expect(mapEngine('android', false, mapbox, true)).toBe('mapbox');
    expect(mapEngine('ios', true, mapbox, true)).toBe('mapbox');
    expect(mapEngine('ios', false, mapbox, true)).toBe('mapbox');
  });

  it("draws nothing until the API has said, so Mapbox's places never show on Google's map, even for a moment", () => {
    expect(mapEngine('android', false, null, true)).toBe('none');
    expect(mapEngine('ios', true, null, true)).toBe('none');
    // Mapbox switched on without a token for the apps (the panel won't switch it on so): still not Google's.
    expect(mapEngine('android', false, { engine: 'mapbox', key: null }, true)).toBe('none');
  });

  it("is as built with no maps provider of its own (the development stand-in), and in an older build without Mapbox's engine", () => {
    expect(mapEngine('android', false, { engine: null, key: null }, true)).toBe('google');
    expect(mapEngine('ios', false, { engine: null, key: null }, true)).toBe('apple');
    // An older build, given new code over the air, without Mapbox's engine: drawn as that build always drew it.
    expect(mapEngine('android', false, mapbox, false)).toBe('google');
  });
});
