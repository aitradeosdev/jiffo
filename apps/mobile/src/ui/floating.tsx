import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors, useScheme } from '../theme/theme';
import { fonts, radius } from '../theme/tokens';
import { Text } from './kit';
import { Icon, type IconName } from './parts';

/** The prototype's shadows (sh-1, sh-2, sh-3), stronger in dark mode. */
export function useShadows() {
  const dark = useScheme() === 'dark';
  return {
    sh1: dark ? '0 1px 3px rgba(0,0,0,0.6)' : '0 1px 3px rgba(0,0,0,0.1)',
    sh2: dark ? '0 2px 12px rgba(0,0,0,0.6)' : '0 2px 10px rgba(0,0,0,0.1)',
    sh3: dark ? '0 -4px 24px rgba(0,0,0,0.7)' : '0 -4px 24px rgba(0,0,0,0.14)',
  };
}

/** .fab: a 44px round button floating over the map. */
export function Fab({
  icon,
  label,
  onPress,
  style,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  style?: ViewStyle;
}) {
  const c = useColors();
  const { sh2 } = useShadows();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => [
        styles.fab,
        { backgroundColor: c.surface, boxShadow: sh2, transform: [{ scale: pressed ? 0.92 : 1 }] },
        style,
      ]}
    >
      <Icon name={icon} size={24} />
    </Pressable>
  );
}

/** .wpill / .brandmark: a 40px pill floating over the map. */
export function FloatPill({
  children,
  label,
  onPress,
  style,
}: {
  children: ReactNode;
  label: string;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  const c = useColors();
  const { sh2 } = useShadows();
  const look = [styles.pill, { backgroundColor: c.surface, boxShadow: sh2 }, style];
  if (!onPress)
    return (
      <View accessibilityLabel={label} style={look}>
        {children}
      </View>
    );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [...look, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
    >
      {children}
    </Pressable>
  );
}

/**
 * .sheet: the white panel over the map, rounded on top, with a grab handle. It grows with its content
 * up to maxHeight, then scrolls. onHeight reports its size so the map can keep pins clear of it.
 */
export function Sheet({
  children,
  onHeight,
  maxHeight,
  handle = true,
  top,
  aboveTabs,
  onHandlePress,
  handleLabel,
}: {
  children: ReactNode;
  onHeight?: (h: number) => void;
  maxHeight?: number | `${number}%`;
  handle?: boolean;
  /** Something pinned above the scrolling part, such as the matching shimmer. */
  top?: ReactNode;
  /** The tab bar already keeps clear of the home indicator. */
  aboveTabs?: boolean;
  /** Makes the handle a button, such as to show more or less of the sheet. */
  onHandlePress?: () => void;
  handleLabel?: string;
}) {
  const c = useColors();
  const { sh3 } = useShadows();
  const insets = useSafeAreaInsets();
  return (
    <View
      onLayout={(e) => onHeight?.(e.nativeEvent.layout.height)}
      style={[
        styles.sheet,
        {
          backgroundColor: c.surface,
          boxShadow: sh3,
          maxHeight,
          paddingBottom: 18 + (aboveTabs ? 0 : insets.bottom),
        },
      ]}
    >
      {handle && onHandlePress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={handleLabel}
          onPress={onHandlePress}
          style={styles.grab}
          hitSlop={{ left: 60, right: 60 }}
        >
          <View style={[styles.handle, { backgroundColor: c.surface3 }]} />
        </Pressable>
      ) : handle ? (
        <View style={[styles.handle, { backgroundColor: c.surface3 }]} />
      ) : null}
      {top}
      <ScrollView
        style={styles.sheetScroll}
        contentContainerStyle={styles.sheetBody}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

/** .shimmer: a thin bar with a black segment sweeping across, while an errand looks for an agent. */
export function Shimmer() {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(x, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [x]);
  const translateX = x.interpolate({ inputRange: [0, 1], outputRange: [-0.4 * width, width] });
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.shimmer, { backgroundColor: c.surface3 }]}
    >
      <Animated.View
        style={[styles.sweep, { width: 0.4 * width, backgroundColor: c.ink, transform: [{ translateX }] }]}
      />
    </View>
  );
}

/** .phead: a 60px page header with a back button and a centred title. */
export function PageHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <View style={styles.phead}>
      {onBack ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.ib} hitSlop={4}>
          <Icon name="back" size={24} />
        </Pressable>
      ) : (
        <View style={styles.ib} />
      )}
      <Text accessibilityRole="header" style={styles.pheadTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.ib}>{right}</View>
    </View>
  );
}

/** .sfoot: the bar at the bottom of a page holding its main button. */
export function PageFooter({ children }: { children: ReactNode }) {
  const c = useColors();
  return <View style={[styles.sfoot, { backgroundColor: c.surface, borderTopColor: c.line }]}>{children}</View>;
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    zIndex: 4,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    position: 'absolute',
    zIndex: 4,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 3,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingHorizontal: 16,
    gap: 16,
  },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetBody: { gap: 16 },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center' },
  grab: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 6, marginVertical: -6 },
  shimmer: { height: 4, borderRadius: 2, overflow: 'hidden' },
  sweep: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  phead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 60,
    paddingVertical: 6,
    paddingLeft: 10,
    paddingRight: 16,
  },
  pheadTitle: { flex: 1, textAlign: 'center', fontFamily: fonts.bold, fontSize: 18 },
  ib: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sfoot: { paddingTop: 12, paddingHorizontal: 16, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth },
});
