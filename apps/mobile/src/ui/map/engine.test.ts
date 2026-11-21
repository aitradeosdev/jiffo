import { describe, expect, it } from 'vitest';
import { mapEngine } from './engine';

/**
 * Which company's map the apps draw. Places are found with Google (the API's maps provider), and Google's terms
 * keep its results off other companies' maps, so both phones draw Google's map. An iPhone build made without
 * its Google key (a development build, say) draws Apple's, as the Google engine isn't in it.
 */
describe('the map the apps draw', () => {
  it("is Google's on Android", () => {
    expect(mapEngine('android', false)).toBe('google');
    expect(mapEngine('android', true)).toBe('google');
  });

  it("is Google's on iPhone when the build has its Google key, and Apple's when not", () => {
    expect(mapEngine('ios', true)).toBe('google');
    expect(mapEngine('ios', false)).toBe('apple');
  });
});
