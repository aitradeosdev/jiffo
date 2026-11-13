import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { useColors } from '@/theme/theme';

/** .segs: five bars, green up to the current step, the current one filling. */
export function Segments({ step, onInk, thick }: { step: number; onInk?: boolean; thick?: boolean }) {
  const c = useColors();
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(fill, {
          toValue: 1,
          duration: 1600,
          easing: Easing.bezier(0.2, 0.8, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(fill, {
          toValue: 0,
          duration: 1600,
          easing: Easing.bezier(0.2, 0.8, 0.2, 1),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fill]);
  const track = onInk ? 'rgba(127,127,127,0.45)' : c.surface3;
  return (
    <View style={[styles.row, thick && { gap: 5 }]} accessibilityLabel={`Step ${Math.max(0, step) + 1} of 5`}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={[styles.seg, thick && styles.thick, { backgroundColor: i < step ? c.brand2 : track }]}>
          {i === step ? (
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: c.brand2, transformOrigin: 'left', transform: [{ scaleX: fill }] },
              ]}
            />
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  /** .tbar: the tracker's thicker bar. */
  thick: { height: 7, borderRadius: 4 },
});
