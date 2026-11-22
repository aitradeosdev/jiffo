'use client';

import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { useEffect, useRef, useState } from 'react';
import type { TerraDraw } from 'terra-draw';
import { TerraDrawGoogleMapsAdapter } from 'terra-draw-google-maps-adapter';
import { boundsOf } from '@/lib/shapes';
import { COLORS, NIGERIA, showEdit, startDrawing, type PlacesMapProps } from './drawing';

export type { MapEdit, MapShape } from './drawing';

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
 * Google's map on Settings, Places, while Google is the maps provider: the state's cities as outlines and their areas
 * filled (green when on, grey when off), and, while one is being drawn or reshaped, Terra Draw on top. Each change
 * to the drawing is passed up as a boundary.
 */
export function PlacesMap({ apiKey, shapes, edit, onShape, fitKey }: PlacesMapProps) {
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
      setProblem(
        "Google refused the map's key. Check the panel map key under Settings, Providers, Maps, and its restrictions.",
      );
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
          terra = startDrawing(
            new TerraDrawGoogleMapsAdapter({ lib: maps, map: m, coordinatePrecision: 6 }),
            report,
            quiet,
            (t) => {
              if (stopped) return;
              draw.current = t;
              setReady(true);
            },
          );
        });
      })
      .catch(() => setProblem("Google's map couldn't be loaded. Check the connection, then reload the page."));
    return () => {
      stopped = true;
      listener?.remove();
      terra?.stop();
      draw.current = null;
      // A map built again (another key) draws its shapes afresh once its own drawing tool is ready.
      setReady(false);
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
    const shown = showEdit(terra, edit, quiet);
    const box = shown ? boundsOf([shown]) : null;
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
