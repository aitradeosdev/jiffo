import { useImperativeHandle, useMemo, useState, type Ref } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Polyline, Rect } from 'react-native-svg';
import { useScheme } from '../../theme/theme';
import { MAP_COLORS, type MapColors } from './palette';
import { MapPinView } from './pins';
import { pointsDown, routeOf, type MapHandle, type MapPin, type MapProps } from './types';

const EDGE = 56;

/** A seeded random source, so the drawn streets stay put between renders. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Streets, blocks and parks drawn to fill the view: a stand-in for the real map on the web build. */
function Streets({ w, h, m }: { w: number; h: number; m: MapColors }) {
  const shapes = useMemo(() => {
    const r = rng(20261112);
    const blocks: Array<{ x: number; y: number; w: number; h: number; park: boolean }> = [];
    for (let y = 8; y < h; y += 46 + r() * 20) {
      for (let x = 8; x < w; x += 52 + r() * 26) {
        if (r() < 0.55) blocks.push({ x, y, w: 26 + r() * 22, h: 18 + r() * 16, park: r() < 0.08 });
      }
    }
    const wave = (y0: number, amp: number, k: number) => {
      let d = `M -20 ${y0}`;
      for (let x = 0; x <= w + 40; x += 20) d += ` L ${x} ${(y0 + amp * Math.sin(x / 140 + k)).toFixed(1)}`;
      return d;
    };
    const streets: string[] = [];
    for (let y = 30; y < h; y += 44 + r() * 22) streets.push(wave(y, 6 + r() * 6, r() * 6));
    for (let x = 24; x < w; x += 56 + r() * 30) {
      const lean = (r() - 0.5) * 60;
      streets.push(`M ${x} -20 Q ${x + lean} ${h / 2} ${x - lean / 2} ${h + 20}`);
    }
    return {
      blocks,
      streets,
      primary: `M ${w * 0.62} -20 C ${w * 0.5} ${h * 0.3}, ${w * 0.7} ${h * 0.6}, ${w * 0.56} ${h + 20}`,
      motor: wave(h * 0.72, 14, 1.3),
      water: `M -20 -20 L ${w + 20} -20 L ${w + 20} ${h * 0.07} ${Array.from({ length: 12 }, (_, i) => {
        const x = w + 20 - ((w + 40) / 11) * i;
        return `L ${x.toFixed(1)} ${(h * 0.07 + 10 * Math.sin(x / 90)).toFixed(1)}`;
      }).join(' ')} Z`,
    };
  }, [w, h]);
  return (
    <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
      <Rect x={0} y={0} width={w} height={h} fill={m.land} />
      {shapes.blocks.map((b, i) => (
        <Rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx={3} fill={b.park ? m.park : m.building} />
      ))}
      <Path d={shapes.water} fill={m.water} />
      {shapes.streets.map((d, i) => (
        <Path key={`e${i}`} d={d} stroke={m.roadEdge} strokeWidth={6} fill="none" />
      ))}
      {shapes.streets.map((d, i) => (
        <Path key={`s${i}`} d={d} stroke={m.road} strokeWidth={4.5} fill="none" />
      ))}
      <Path d={shapes.primary} stroke={m.primaryEdge} strokeWidth={10} fill="none" />
      <Path d={shapes.primary} stroke={m.primary} strokeWidth={7.5} fill="none" />
      <Path d={shapes.motor} stroke={m.motorEdge} strokeWidth={14} fill="none" />
      <Path d={shapes.motor} stroke={m.motor} strokeWidth={11} fill="none" />
    </Svg>
  );
}

/** Places the pins inside the free area, keeping their real layout (an equirectangular projection). */
function project(pins: MapPin[], w: number, h: number, insets: { top: number; bottom: number }) {
  if (!pins.length) return [];
  const lat0 = pins.reduce((s, p) => s + p.lat, 0) / pins.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const xs = pins.map((p) => p.lng * k);
  const ys = pins.map((p) => -p.lat);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const left = EDGE;
  const top = insets.top + EDGE;
  const aw = Math.max(40, w - 2 * EDGE);
  const ah = Math.max(40, h - insets.top - insets.bottom - 2 * EDGE);
  const span = Math.max(x1 - x0, y1 - y0) || 1;
  const scale = x1 - x0 || y1 - y0 ? Math.min(aw / (x1 - x0 || span), ah / (y1 - y0 || span)) : 0;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return pins.map((p, i) => ({
    pin: p,
    x: left + aw / 2 + ((xs[i] ?? cx) - cx) * scale,
    y: top + ah / 2 + ((ys[i] ?? cy) - cy) * scale,
  }));
}

/** The web build's map: drawn streets with the real pins on top. Phones use react-native-maps. */
export function JiffoMap({ pins, showRoute, insets, style, ref }: MapProps & { ref?: Ref<MapHandle> }) {
  const scheme = useScheme();
  const m = MAP_COLORS[scheme];
  const [size, setSize] = useState({ w: 0, h: 0 });
  useImperativeHandle(ref, () => ({ recenter: () => undefined }));
  const placed = project(pins, size.w, size.h, insets);
  const route = showRoute ? routeOf(pins) : [];
  const line = route
    .map((p) => placed.find((q) => q.pin.key === p.key))
    .filter((q): q is NonNullable<typeof q> => !!q)
    .map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`)
    .join(' ');
  return (
    <View
      style={[StyleSheet.absoluteFill, style]}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {size.w ? <Streets w={size.w} h={size.h} m={m} /> : null}
      {route.length > 1 && size.w ? (
        <Svg width={size.w} height={size.h} style={StyleSheet.absoluteFill}>
          <Polyline
            points={line}
            stroke={m.routeEdge}
            strokeWidth={8}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Polyline
            points={line}
            stroke={m.route}
            strokeWidth={4}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      ) : null}
      {placed.map(({ pin, x, y }) => (
        <Pressable
          key={pin.key}
          disabled={!pin.onPress}
          onPress={pin.onPress}
          accessibilityRole={pin.onPress ? 'button' : undefined}
          accessibilityLabel={pin.label}
          style={[styles.pin, { left: x, top: y }, pointsDown(pin.kind) && styles.down]}
        >
          <MapPinView kind={pin.kind} label={pin.label} radar={pin.radar} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { position: 'absolute', transform: [{ translateX: '-50%' }, { translateY: '-50%' }] },
  down: { transform: [{ translateX: '-50%' }, { translateY: '-95%' }] },
});
