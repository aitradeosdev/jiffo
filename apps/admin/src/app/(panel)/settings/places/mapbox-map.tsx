'use client';

import 'mapbox-gl/dist/mapbox-gl.css';
import type { Map as MapboxMap } from 'mapbox-gl';
import { useEffect, useRef, useState } from 'react';
import type { TerraDraw } from 'terra-draw';
import { boundsOf } from '@/lib/shapes';
import { COLORS, NIGERIA, showEdit, startDrawing, type PlacesMapProps } from './drawing';

const SOURCE = 'jiffo-places';

/** A box from boundsOf, as Mapbox takes it: west-south, then east-north. */
const corners = (box: { west: number; south: number; east: number; north: number }) =>
  [
    [box.west, box.south],
    [box.east, box.north],
  ] as [[number, number], [number, number]];

/**
 * Mapbox's map on Settings, Places, while Mapbox is the maps provider: the same as Google's (map.tsx), the state's
 * cities as outlines and their areas filled (green when on, grey when off), with Terra Draw on top while one is
 * being drawn or reshaped. Mapbox's library is loaded only here, when the page needs it.
 */
export function PlacesMapbox({ apiKey, shapes, edit, onShape, fitKey }: PlacesMapProps) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<MapboxMap | null>(null);
  const draw = useRef<TerraDraw | null>(null);
  const [ready, setReady] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const report = useRef(onShape);
  report.current = onShape;
  // Set while the drawing tool is cleared or loaded with a shape: those changes aren't the admin's.
  const quiet = useRef(false);

  // The map, the cities and areas under it, and Terra Draw on top, once.
  useEffect(() => {
    let stopped = false;
    let terra: TerraDraw | null = null;
    let m: MapboxMap | null = null;
    Promise.all([import('mapbox-gl'), import('terra-draw-mapbox-gl-adapter')])
      .then(([{ default: mapboxgl }, { TerraDrawMapboxGLAdapter }]) => {
        if (stopped || !element.current) return;
        m = new mapboxgl.Map({
          container: element.current,
          accessToken: apiKey,
          style: 'mapbox://styles/mapbox/streets-v12',
          center: [NIGERIA.lng, NIGERIA.lat],
          zoom: 5,
          attributionControl: true,
        });
        map.current = m;
        m.on('error', (event) => {
          const status = (event.error as { status?: number } | undefined)?.status;
          if (status === 401 || status === 403) {
            setProblem(
              "Mapbox refused the map's token. Check the panel's map token under Settings, Providers, Maps, and its URL restrictions.",
            );
          }
        });
        m.on('load', () => {
          const here = m;
          if (stopped || !here) return;
          // The cities and areas first, so Terra Draw's layers go on top of them.
          here.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
          const city = ['==', ['get', 'kind'], 'city'];
          const color = ['case', city, COLORS.city, ['get', 'enabled'], COLORS.on, COLORS.off];
          here.addLayer({
            id: `${SOURCE}-fill`,
            type: 'fill',
            source: SOURCE,
            paint: {
              'fill-color': color as never,
              'fill-opacity': ['case', city, 0, ['get', 'selected'], 0.35, 0.2] as never,
            },
          });
          here.addLayer({
            id: `${SOURCE}-line`,
            type: 'line',
            source: SOURCE,
            paint: {
              'line-color': color as never,
              'line-width': ['case', ['get', 'selected'], 3, city, 2, 1] as never,
            },
          });
          terra = startDrawing(
            new TerraDrawMapboxGLAdapter({ map: here, coordinatePrecision: 6 }),
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
      .catch(() => setProblem("Mapbox's map couldn't be loaded. Check the connection, then reload the page."));
    return () => {
      stopped = true;
      terra?.stop();
      m?.remove();
      draw.current = null;
      // A map built again (another key) draws its shapes afresh once its own drawing tool is ready.
      setReady(false);
      map.current = null;
    };
  }, [apiKey]);

  // The cities and areas, redrawn when they change.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const source = m.getSource(SOURCE) as { setData?: (data: unknown) => void } | undefined;
    source?.setData?.({
      type: 'FeatureCollection',
      features: shapes.map((shape) => ({
        type: 'Feature',
        properties: { kind: shape.kind, enabled: shape.enabled, selected: shape.selected, name: shape.name },
        geometry: shape.boundary,
      })),
    });
  }, [shapes, ready]);

  // Fit the shapes shown when asked to (another state picked).
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const box = boundsOf(shapes.map((s) => s.boundary));
    if (box) m.fitBounds(corners(box), { padding: 32, duration: 0 });
    // Only when fitKey changes: shapes changing as one is drawn must not move the map.
  }, [fitKey, ready]);

  // Terra Draw: drawing a new shape, reshaping one, or idle.
  useEffect(() => {
    const terra = draw.current;
    if (!terra || !ready) return;
    const shown = showEdit(terra, edit, quiet);
    const box = shown ? boundsOf([shown]) : null;
    if (box) map.current?.fitBounds(corners(box), { padding: 48, duration: 0 });
    // Only when another shape starts being edited: its own changes come back through onShape.
  }, [edit?.key, ready]);

  return (
    <div className="relative h-[60vh] min-h-80 overflow-hidden rounded-2xl bg-surface-2">
      {/* Mapbox's stylesheet makes its container position: relative, which undoes absolute positioning: the
          container fills a box of its own instead, or it would be 0 pixels tall and the map unseen. */}
      <div className="absolute inset-0">
        <div ref={element} className="h-full w-full" />
      </div>
      {problem ? (
        <p role="alert" className="absolute inset-x-4 top-4 rounded-xl bg-surface px-3.5 py-2.5 text-sm font-medium">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
