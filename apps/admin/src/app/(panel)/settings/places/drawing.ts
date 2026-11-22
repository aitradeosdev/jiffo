import { TerraDraw, TerraDrawPolygonMode, TerraDrawSelectMode, type GeoJSONStoreFeatures } from 'terra-draw';
import { boundaryFrom, editableOnMap, polygonsOf, type Boundary } from '@/lib/shapes';

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

/** What each Places map takes: Google's or Mapbox's, whichever the maps provider in use draws. */
export interface PlacesMapProps {
  /** The provider's public key for the panel. */
  apiKey: string;
  shapes: MapShape[];
  edit: MapEdit | null;
  onShape: (boundary: Boundary | null) => void;
  /** Changes when the map should fit what it shows again, such as another state being picked. */
  fitKey: string;
}

/** Nigeria, before any city is drawn in the state shown. */
export const NIGERIA = { lat: 9.08, lng: 8.68 };
export const COLORS = { city: '#0B0B0B', on: '#0A7A4A', off: '#8A9097' } as const;

/** What Terra Draw draws on: Google's map or Mapbox's, through its adapter for each. */
type DrawingAdapter = ConstructorParameters<typeof TerraDraw>[0]['adapter'];

/**
 * Terra Draw on a map, the same on Google's and Mapbox's: polygons drawn and reshaped, each finished change passed
 * to `report` as a boundary, and `onReady` once it can be used. `quiet` is set while the panel itself clears or
 * loads a shape, as those changes aren't the admin's.
 */
export function startDrawing(
  adapter: DrawingAdapter,
  report: { current: (boundary: Boundary | null) => void },
  quiet: { current: boolean },
  onReady: (terra: TerraDraw) => void,
): TerraDraw {
  const terra = new TerraDraw({
    adapter,
    modes: [
      new TerraDrawPolygonMode({
        styles: { fillColor: COLORS.on, outlineColor: COLORS.on, fillOpacity: 0.25 },
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
  terra.start();
  // The finished polygons only: one still being drawn isn't a shape yet.
  const send = () => {
    if (quiet.current) return;
    const polygons = terra
      .getSnapshot()
      .filter((f) => f.geometry.type === 'Polygon' && !f.properties.currentlyDrawing)
      .map((f) => f.geometry.coordinates as number[][][]);
    report.current(boundaryFrom(polygons));
  };
  terra.on('finish', () => {
    send();
    // Done drawing: its corners can now be dragged, and another click doesn't start a second shape.
    terra.setMode('select');
  });
  terra.on('change', (_ids, type) => {
    if (type !== 'styling') send();
  });
  terra.on('ready', () => onReady(terra));
  return terra;
}

/**
 * Puts the shape being drawn or reshaped into Terra Draw, or leaves it idle, and returns the boundary to fit the
 * map to, if any. A shape with holes isn't loaded: the tool would drop them (Places offers pasting instead).
 */
export function showEdit(terra: TerraDraw, edit: MapEdit | null, quiet: { current: boolean }): Boundary | null {
  quiet.current = true;
  terra.clear();
  quiet.current = false;
  if (!edit || (edit.boundary && !editableOnMap(edit.boundary))) {
    terra.setMode('static');
    return null;
  }
  if (!edit.boundary) {
    terra.setMode('polygon');
    return null;
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
  return edit.boundary;
}
