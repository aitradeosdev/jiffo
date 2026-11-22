import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlacesMapbox } from './mapbox-map';

/**
 * Mapbox's stylesheet makes the map's container position: relative, so a container positioned absolutely to fill
 * the box lost its height: 0 pixels tall, the map drawn but unseen (seen on the test server). It fills a box of
 * its own instead.
 */
describe("Mapbox's map on Settings, Places", () => {
  it('draws into a container that fills a box of its own, rather than relying on absolute positioning', () => {
    const html = renderToStaticMarkup(
      <PlacesMapbox apiKey="pk.test" shapes={[]} edit={null} onShape={() => undefined} fitKey="LA" />,
    );
    expect(html).toMatch(/<div class="absolute inset-0"><div class="h-full w-full"><\/div><\/div>/);
  });
});
