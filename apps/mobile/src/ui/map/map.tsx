import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import { Platform, StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_DEFAULT, PROVIDER_GOOGLE, Polyline } from 'react-native-maps';
import { useScheme } from '../../theme/theme';
import { MAP_COLORS, googleStyle } from './palette';
import { MapPinView } from './pins';
import { DEFAULT_CENTER, routeOf, type MapHandle, type MapPin, type MapProps } from './types';

const EDGE = 56;
const CITY_DELTA = 0.035;

/**
 * The map behind the home, review and tracking screens. Google Maps on Android (styled like the
 * prototype), Apple Maps on iOS. Fits its pins inside the space the controls and sheet leave free.
 */
export function JiffoMap({
  pins,
  showRoute,
  insets,
  center,
  showsUser,
  interactive = true,
  style,
  ref,
}: MapProps & { ref?: Ref<MapHandle> }) {
  const scheme = useScheme();
  const colors = MAP_COLORS[scheme];
  const map = useRef<MapView>(null);
  // Fitting needs the map's size, which it only has once ready.
  const ready = useRef(false);
  const customMapStyle = useMemo(() => googleStyle(colors), [colors]);
  const route = showRoute ? routeOf(pins) : [];
  const key = pins.map((p) => `${p.kind}:${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join('|');
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

  useImperativeHandle(ref, () => ({ recenter: () => fit(true) }));
  // Refit when the pins move or the sheet changes size.
  useEffect(() => {
    if (ready.current) fit(true);
  }, [key, insets.top, insets.bottom, focus.lat, focus.lng]);

  return (
    <MapView
      ref={map}
      style={[StyleSheet.absoluteFill, style]}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : PROVIDER_DEFAULT}
      customMapStyle={Platform.OS === 'android' ? customMapStyle : undefined}
      userInterfaceStyle={scheme}
      initialRegion={{
        latitude: focus.lat,
        longitude: focus.lng,
        latitudeDelta: CITY_DELTA,
        longitudeDelta: CITY_DELTA,
      }}
      mapPadding={{ top: insets.top, bottom: insets.bottom, left: 0, right: 0 }}
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
 * Android draws a custom marker as a picture of its view. Let it redraw until the view has laid out,
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
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={tracks}
      accessibilityLabel={
        pin.kind === 'agent' ? 'Your agent' : pin.kind === 'pick' ? 'Pickup' : pin.kind === 'drop' ? 'Drop-off' : 'Stop'
      }
    >
      <MapPinView kind={pin.kind} label={pin.label} radar={pin.radar} />
    </Marker>
  );
}
