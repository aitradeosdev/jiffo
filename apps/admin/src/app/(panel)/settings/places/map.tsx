'use client';

import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { useEffect, useRef, useState } from 'react';
import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode, type GeoJSONStoreFeatures } from 'terra-draw';
import { TerraDrawGoogleMapsAdapter } from 'terra-draw-google-maps-adapter';
import { boundaryFrom, boundsOf, editableOnMap, polygonsOf, type Boundary } from '@/lib/shapes';

/** A city or area drawn on the map. */
export interface MapShape {
  id: string;
  kind: 'city' | 'area';
  name: string;
  enabled: boolean;
  boundary: Boundary;
  /** The one being looked at or changed: drawn more strongly. */
  selected: boolean;
}

/** Drawing a new shape (no boundary yet) or reshaping one. */
export interface MapEdit {
  /** Changes when a different shape starts being drawn, so the drawing starts afresh. */
  key: string;
  boundary: Boundary | null;
}

/** Nigeria, before any city is drawn in the state shown. */
const NIGERIA = { lat: 9.08, lng: 8.68 };
const COLORS = { city: '#0B0B0B', on: '#0A7A4A', off: '#8A9097' };

let loaded: Promise<typeof google.maps> | null = null;
/** Google's map script, loaded once per page with the panel's browser key. */
function loadMaps(key: string) {
  loaded ??= (async () => {
    setOptions({ key, v: 'weekly' });
    await Promise.all([importLibrary('maps'), importLibrary('geometry')]);
    return google.maps;
  })();
  return loaded;
}

/**
 * The map on Settings, Places: the state's cities as outlines and their areas filled (green when on, grey when
 * off), and, while one is being drawn or reshaped, Terra Draw on top. Each change to the drawing is passed up as a
 * boundary.
 */
export function PlacesMap({
  apiKey,
  shapes,
  edit,
  onShape,
  fitKey,
}: {
  apiKey: string;
  shapes: MapShape[];
  edit: MapEdit | null;
  onShape: (boundary: Boundary | null) => void;
  /** Changes when the map should fit what it shows again, such as another state being picked. */
  fitKey: string;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const draw = useRef<TerraDraw | null>(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const report = useRef(onShape);
  report.current = onShape;
  // Set while the drawing tool is cleared or loaded with a shape: those changes aren't the admin's.
  const quiet = useRef(false);

  // The map, and Terra Draw on it, once.
  useEffect(() => {
    let stopped = false;
    let listener: google.maps.MapsEventListener | null = null;
    let terra: TerraDraw | null = null;
    // Google calls this when it refuses the key.
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () =>
      setProblem("Google refused the map's key. Check GOOGLE_MAPS_BROWSER_KEY and its restrictions.");
    loadMaps(apiKey)
      .then((maps) => {
        if (stopped || !element.current) return;
        const m = new maps.Map(element.current, {
          center: NIGERIA,
          zoom: 6,
          mapTypeControl: false,
          streetViewControl: false,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        map.current = m;
        // Terra Draw needs the map's projection first.
        listener = m.addListener('projection_changed', () => {
          listener?.remove();
          // Left the page while the map was getting ready.
          if (stopped) return;
          terra = new TerraDraw({
            adapter: new TerraDrawGoogleMapsAdapter({ lib: maps, map: m, coordinatePrecision: 6 }),
            modes: [
              new TerraDrawPolygonMode({
                styles: { fillColor: '#0A7A4A', outlineColor: '#0A7A4A', fillOpacity: 0.25 },
              }),
              new TerraDrawSelectMode({
                flags: {
                  polygon: {
                    feature: {
                      draggable: true,
                      coordinates: { midpoints: true, draggable: true, deletable: true },
                    },
                  },
                },
              }),
            ],
          });
          const t = terra;
          t.start();
          // The finished polygons only: one still being drawn isn't a shape yet.
          const send = () => {
            if (quiet.current) return;
            const polygons = t
              .getSnapshot()
              .filter((f) => f.geometry.type === 'Polygon' && !f.properties.currentlyDrawing)
              .map((f) => f.geometry.coordinates as number[][][]);
            report.current(boundaryFrom(polygons));
          };
          t.on('finish', () => {
            send();
            // Done drawing: its corners can now be dragged, and another click doesn't start a second shape.
            t.setMode('select');
          });
          t.on('change', (_ids, type) => {
            if (type !== 'styling') send();
          });
          t.on('ready', () => {
            if (stopped) return;
            draw.current = t;
            setReady(true);
          });
        });
      })
      .catch(() => setProblem("Google's map couldn't be loaded. Check the connection, then reload the page."));
    return () => {
      stopped = true;
      listener?.remove();
      terra?.stop();
      draw.current = null;
    };
  }, [apiKey]);

  // The cities and areas, redrawn when they change.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    m.data.forEach((f) => m.data.remove(f));
    for (const shape of shapes) {
      m.data.addGeoJson({
        type: 'Feature',
        properties: { kind: shape.kind, enabled: shape.enabled, selected: shape.selected, name: shape.name },
        geometry: shape.boundary,
      });
    }
    m.data.setStyle((f) => {
      const city = f.getProperty('kind') === 'city';
      const selected = !!f.getProperty('selected');
      const color = city ? COLORS.city : f.getProperty('enabled') ? COLORS.on : COLORS.off;
      return {
        clickable: false,
        strokeColor: color,
        strokeWeight: selected ? 3 : city ? 2 : 1,
        fillColor: color,
        fillOpacity: city ? 0 : selected ? 0.35 : 0.2,
        zIndex: city ? 1 : 2,
      };
    });
  }, [shapes, ready]);

  // Fit the shapes shown when asked to (another state picked).
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const box = boundsOf(shapes.map((s) => s.boundary));
    if (box) m.fitBounds(box, 32);
    // Only when fitKey changes: shapes changing as one is drawn must not move the map.
  }, [fitKey, ready]);

  // Terra Draw: drawing a new shape, reshaping one, or idle.
  useEffect(() => {
    const terra = draw.current;
    if (!terra || !ready) return;
    quiet.current = true;
    terra.clear();
    quiet.current = false;
    // A shape with holes isn't loaded: the tool would drop it (Places offers pasting instead).
    if (!edit || (edit.boundary && !editableOnMap(edit.boundary))) {
      terra.setMode('static');
      return;
    }
    if (!edit.boundary) {
      terra.setMode('polygon');
      return;
    }
    const features = polygonsOf(edit.boundary).map(
      (coordinates) =>
        ({
          id: crypto.randomUUID(),
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates },
          properties: { mode: 'polygon' },
        }) as GeoJSONStoreFeatures,
    );
    quiet.current = true;
    terra.addFeatures(features);
    quiet.current = false;
    terra.setMode('select');
    const box = boundsOf([edit.boundary]);
    if (box) map.current?.fitBounds(box, 48);
    // Only when another shape starts being edited: its own changes come back through onShape.
  }, [edit?.key, ready]);

  return (
    <div className="relative h-[60vh] min-h-80 overflow-hidden rounded-2xl bg-surface-2">
      <div ref={element} className="absolute inset-0" />
      {problem ? (
        <p role="alert" className="absolute inset-x-4 top-4 rounded-xl bg-surface px-3.5 py-2.5 text-sm font-medium">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
