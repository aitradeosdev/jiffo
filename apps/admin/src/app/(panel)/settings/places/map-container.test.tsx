import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlacesMap } from './map';
import { PlacesMapbox } from './mapbox-map';

/**
 * Mapbox's stylesheet, and Google's map script, make the map's container position: relative, so a container
 * positioned absolutely to fill the box lost its height: 0 pixels tall, the map drawn but unseen (seen on the test
 * server). Each fills a box of its own instead.
 */
describe('the maps on Settings, Places', () => {
  const props = { shapes: [], edit: null, onShape: () => undefined, fitKey: 'LA', focus: null };
  const FILLS = /<div class="absolute inset-0"><div class="h-full w-full"><\/div><\/div>/;

  it("draws Mapbox's map into a container that fills a box of its own", () => {
    expect(renderToStaticMarkup(<PlacesMapbox apiKey="pk.test" {...props} />)).toMatch(FILLS);
  });

  it("draws Google's map the same way", () => {
    expect(renderToStaticMarkup(<PlacesMap apiKey="AIza-test" {...props} />)).toMatch(FILLS);
  });
});
