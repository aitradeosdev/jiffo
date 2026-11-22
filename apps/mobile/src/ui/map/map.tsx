import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import Constants from 'expo-constants';
import { Platform, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE, Polyline } from 'react-native-maps';
import { useScheme } from '../../theme/theme';
import { useCountryConfig } from '../../api/useCountryConfig';
import { mapEngine } from './engine';
import { MAPBOX_IN_BUILD, MapboxMap } from './mapbox-map';
import { MAP_COLORS, googleStyle } from './palette';
import { MapPinView } from './pins';
import { DEFAULT_CENTER, pointsDown, routeOf, type MapHandle, type MapPin, type MapProps } from './types';

const PIN_LABEL: Partial<Record<MapPin['kind'], string>> = {
  agent: 'Your agent',
  pick: 'Pickup',
  drop: 'Drop-off',
  stop: 'Stop',
  me: 'You are here',
};

const EDGE = 56;
const CITY_DELTA = 0.035;
/**
 * Whether this build put Google's map engine in the iPhone app (app.config.ts). Preview and store builds carry
 * their own settings; a development build takes them from the bundler, which must then be started with the same
 * GOOGLE_MAPS_IOS_API_KEY as the build (docs/mobile-builds.md).
 */
const GOOGLE_MAPS_ON_IOS =
  ((Constants.expoConfig?.extra ?? {}) as { googleMapsOnIos?: boolean }).googleMapsOnIos === true;
/**
 * The map behind the home, review and tracking screens: the maps provider's own, as the API says (engine.ts),
 * Google's or Mapbox's, each styled like the prototype. Fits its pins inside the space the controls and sheet leave
 * free.
 */
export function JiffoMap(props: MapProps & { ref?: Ref<MapHandle> }) {
  const { config } = useCountryConfig();
  const live = config?.map ?? null;
  const engine = mapEngine(Platform.OS, GOOGLE_MAPS_ON_IOS, live, MAPBOX_IN_BUILD);
  if (engine === 'mapbox' && live?.key) return <MapboxMap {...props} token={live.key} />;
  return <NativeMap {...props} google={engine === 'google'} />;
}

/** Google's map, styled like the prototype; Apple's on an iPhone built without its Google key. */
function NativeMap({
  pins,
  showRoute,
  insets,
  center,
  showsUser,
  interactive = true,
  style,
  ref,
  google,
}: MapProps & { ref?: Ref<MapHandle>; google: boolean }) {
  const scheme = useScheme();
  const colors = MAP_COLORS[scheme];
  const map = useRef<MapView>(null);
  // Fitting needs the map's size, which it only has once ready.
  const ready = useRef(false);
  const customMapStyle = useMemo(() => googleStyle(colors), [colors]);
  const route = showRoute ? routeOf(pins) : [];
  // Refit when pins come or go, not when one moves (the agent, a live position), so the camera stays put.
  const key = pins.map((p) => `${p.kind}:${p.key}`).join('|');
  // Once the person pans the map, leave it where they put it until they ask to recentre.
  const userMoved = useRef(false);
  const focus = center ?? DEFAULT_CENTER;

  const fit = (animated: boolean) => {
    const view = map.current;
    if (!view) return;
    if (pins.length > 1) {
      view.fitToCoordinates(
        pins.map((p) => ({ latitude: p.lat, longitude: p.lng })),
        { edgePadding: { top: EDGE, bottom: EDGE, left: EDGE, right: EDGE }, animated },
      );
    } else {
      const at = pins[0] ?? focus;
      view.animateToRegion(
        { latitude: at.lat, longitude: at.lng, latitudeDelta: CITY_DELTA / 3, longitudeDelta: CITY_DELTA / 3 },
        animated ? 400 : 0,
      );
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
    if (ready.current && !userMoved.current) fit(true);
  }, [key, insets.top, insets.bottom, focus.lat, focus.lng]);

  return (
    <MapView
      ref={map}
      style={[StyleSheet.absoluteFill, style]}
      provider={google ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
      customMapStyle={google ? customMapStyle : undefined}
      userInterfaceStyle={scheme}
      initialRegion={{
        latitude: focus.lat,
        longitude: focus.lng,
        latitudeDelta: CITY_DELTA,
        longitudeDelta: CITY_DELTA,
      }}
      mapPadding={{ top: insets.top, bottom: insets.bottom, left: 0, right: 0 }}
      onPanDrag={() => {
        userMoved.current = true;
      }}
      onMapReady={() => {
        ready.current = true;
        fit(false);
      }}
      showsUserLocation={!!showsUser}
      showsMyLocationButton={false}
      showsCompass={false}
      toolbarEnabled={false}
      showsPointsOfInterests={false}
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={false}
      pitchEnabled={false}
    >
      {route.length > 1 ? (
        <>
          <Polyline
            coordinates={route.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor={colors.routeEdge}
            strokeWidth={8}
          />
          <Polyline
            coordinates={route.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor={colors.route}
            strokeWidth={4}
          />
        </>
      ) : null}
      {pins.map((p) => (
        <PinMarker key={p.key} pin={p} />
      ))}
    </MapView>
  );
}

/**
 * Google's map draws a custom marker as a picture of its view. Let it redraw until the view has laid out,
 * and again whenever the pin's look changes, then stop so panning stays smooth.
 */
function PinMarker({ pin }: { pin: MapPin }) {
  const scheme = useScheme();
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    const timer = setTimeout(() => setTracks(false), 500);
    return () => clearTimeout(timer);
  }, [pin.kind, pin.label, pin.radar, scheme]);
  return (
    <Marker
      coordinate={{ latitude: pin.lat, longitude: pin.lng }}
      anchor={pointsDown(pin.kind) ? { x: 0.5, y: 0.95 } : { x: 0.5, y: 0.5 }}
      tracksViewChanges={tracks}
      onPress={pin.onPress}
      accessibilityLabel={PIN_LABEL[pin.kind] ?? pin.label}
    >
      <MapPinView kind={pin.kind} label={pin.label} radar={pin.radar} />
    </Marker>
  );
}
