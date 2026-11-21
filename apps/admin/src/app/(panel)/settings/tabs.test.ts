import { describe, expect, it } from 'vitest';
import { fullLoad } from './tabs';

/**
 * Places is the one page whose security rules let Google's map load, and a page's rules come with its document:
 * reached by a tab inside the panel, it would keep the rules of the page it came from, and the map wouldn't load.
 */
describe('settings tabs', () => {
  it('open Places as a page of its own, and every other tab within the panel', () => {
    expect(fullLoad('/settings/places')).toBe(true);
    for (const href of ['/settings', '/settings/categories', '/settings/states', '/settings/providers']) {
      expect(fullLoad(href)).toBe(false);
    }
  });
});
