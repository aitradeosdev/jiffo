import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useScheme } from '../../theme/theme';
import { boxOf, fitPadding } from './camera';
import { MAP_COLORS } from './palette';
import { MapPinView } from './pins';
import { DEFAULT_CENTER, pointsDown, routeOf, type MapHandle, type MapPin, type MapProps } from './types';

type MapboxLib = typeof import('@rnmapbox/maps');
type CameraRef = import('@rnmapbox/maps').Camera;

/**
 * Mapbox's map engine, if this build has it. Every build since it was added does; an older one given new code over
 * the air doesn't, and loading the library there throws, so the app draws Google's map instead (engine.ts).
 */
const lib: MapboxLib | null = (() => {
  try {
    return require('@rnmapbox/maps') as MapboxLib;
  } catch {
    return null;
  }
})();

export const MAPBOX_IN_BUILD = lib !== null;

const PIN_LABEL: Partial<Record<MapPin['kind'], string>> = {
  agent: 'Your agent',
  pick: 'Pickup',
  drop: 'Drop-off',
  stop: 'Stop',
  me: 'You are here',
};

const EDGE = 56;
/** About a city's width across the screen, and a street's, as Google's map starts and shows one pin. */
const CITY_ZOOM = 13;
const PIN_ZOOM = 15;

/** The token Mapbox was last given: set once per token, before a map is drawn with it. */
let tokenSet: string | null = null;

/**
 * Mapbox's map behind the home, review and tracking screens, while Mapbox is the maps provider (engine.ts): the same
 * pins, route and fitting as Google's (map.tsx), inside the space the controls and sheet leave free. Mapbox's logo
 * and attribution stay on the map, above the sheet, as its terms ask.
 */
export function MapboxMap({
  token,
  pins,
  showRoute,
  insets,
  center,
  showsUser,
  interactive = true,
  style,
  ref,
}: MapProps & { token: string; ref?: Ref<MapHandle> }) {
  const scheme = useScheme();
  const colors = MAP_COLORS[scheme];
  const camera = useRef<CameraRef>(null);
  const [ready, setReady] = useState(tokenSet === token);
  const loaded = useRef(false);
  const userMoved = useRef(false);
  const route = showRoute ? routeOf(pins) : [];
  // Refit when pins come or go, not when one moves (the agent, a live position), so the camera stays put.
  const key = pins.map((p) => `${p.kind}:${p.key}`).join('|');
  const focus = center ?? DEFAULT_CENTER;

  useEffect(() => {
    if (!lib || tokenSet === token) return;
    let stopped = false;
    // Mapbox's own usage telemetry stays off, as Smile ID's crash reporting does (docs/security/sdks.md).
    lib.default.setTelemetryEnabled(false);
    lib.default
      .setAccessToken(token)
      .then(() => {
        tokenSet = token;
        if (!stopped) setReady(true);
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [token]);

  const fit = (animated: boolean) => {
    const view = camera.current;
    if (!view) return;
    const duration = animated ? 400 : 0;
    const box = pins.length > 1 ? boxOf(pins) : null;
    if (box) {
      view.fitBounds(box.ne, box.sw, fitPadding(insets, EDGE), duration);
    } else {
      const at = pins[0] ?? focus;
      view.setCamera({
        centerCoordinate: [at.lng, at.lat],
        zoomLevel: PIN_ZOOM,
        padding: { paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: 0, paddingRight: 0 },
        animationDuration: duration,
      });
    }
  };

  useImperativeHandle(ref, () => ({
    recenter: () => {
      userMoved.current = false;
      fit(true);
    },
  }));
  // Refit when the pins move or the sheet changes size.
  useEffect(() => {
    if (loaded.current && !userMoved.current) fit(true);
  }, [key, insets.top, insets.bottom, focus.lat, focus.lng]);

  if (!lib || !ready) return <View style={[StyleSheet.absoluteFill, style]} />;
  const { MapView, Camera, MarkerView, ShapeSource, LineLayer, LocationPuck, StyleURL } = lib;
  const ornament = { bottom: insets.bottom + 8, left: 8 };
  return (
    <MapView
      style={[StyleSheet.absoluteFill, style]}
      styleURL={scheme === 'dark' ? StyleURL.Dark : StyleURL.Street}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={false}
      pitchEnabled={false}
      compassEnabled={false}
      scaleBarEnabled={false}
      logoPosition={ornament}
      attributionPosition={{ bottom: insets.bottom + 8, right: 8 }}
      onCameraChanged={(state) => {
        if (state.gestures.isGestureActive) userMoved.current = true;
      }}
      onDidFinishLoadingMap={() => {
        loaded.current = true;
        fit(false);
      }}
    >
      <Camera
        ref={camera}
        defaultSettings={{ centerCoordinate: [focus.lng, focus.lat], zoomLevel: CITY_ZOOM }}
        padding={{ paddingTop: insets.top, paddingBottom: insets.bottom, paddingLeft: 0, paddingRight: 0 }}
      />
      {showsUser ? <LocationPuck /> : null}
      {route.length > 1 ? (
        <ShapeSource
          id="jiffo-route"
          shape={{
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates: route.map((p) => [p.lng, p.lat]) },
          }}
        >
          <LineLayer
            id="jiffo-route-edge"
            style={{ lineColor: colors.routeEdge, lineWidth: 8, lineCap: 'round', lineJoin: 'round' }}
          />
          <LineLayer
            id="jiffo-route-line"
            style={{ lineColor: colors.route, lineWidth: 4, lineCap: 'round', lineJoin: 'round' }}
          />
        </ShapeSource>
      ) : null}
      {pins.map((p) => (
        <MarkerView
          key={p.key}
          coordinate={[p.lng, p.lat]}
          anchor={pointsDown(p.kind) ? { x: 0.5, y: 0.95 } : { x: 0.5, y: 0.5 }}
          allowOverlap
        >
          <Pressable
            onPress={p.onPress}
            disabled={!p.onPress}
            accessibilityRole={p.onPress ? 'button' : 'image'}
            accessibilityLabel={PIN_LABEL[p.kind] ?? p.label}
          >
            <MapPinView kind={p.kind} label={p.label} radar={p.radar} />
          </Pressable>
        </MarkerView>
      ))}
    </MapView>
  );
}
