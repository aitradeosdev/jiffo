import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../theme/theme';
import { fonts, radius, space } from '../theme/tokens';
import { WordmarkSvg } from './svg';

type Tone = 'ink' | 'ink2' | 'ink3' | 'brand' | 'brandInk' | 'urgent' | 'danger' | 'onBrand' | 'onInk';
type Variant = 'title' | 'heading' | 'sec' | 'body' | 'label' | 'small' | 'sub' | 'note' | 'price';

/** The prototype's type scale: .t1, .t2, .sec, body, list titles, .sub and .note. */
const VARIANTS: Record<Variant, TextStyle> = {
  title: { fontFamily: fonts.bold, fontSize: 24, lineHeight: 28, letterSpacing: -0.48 },
  heading: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 24, letterSpacing: -0.3 },
  sec: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 23, letterSpacing: -0.18 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 21 },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 19 },
  sub: { fontFamily: fonts.regular, fontSize: 14.5, lineHeight: 20 },
  note: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  price: { fontFamily: fonts.extrabold, fontSize: 20, lineHeight: 24, fontVariant: ['tabular-nums'] },
};

export function Text({
  variant = 'body',
  tone = 'ink',
  style,
  ...rest
}: TextProps & { variant?: Variant; tone?: Tone }) {
  const c = useColors();
  return <RNText {...rest} style={[VARIANTS[variant], { color: c[tone] }, style]} />;
}

export function Screen({
  children,
  scroll = true,
  footer,
}: {
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
}) {
  const c = useColors();
  const body = <View style={styles.body}>{children}</View>;
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {scroll ? (
          <ScrollView contentContainerStyle={styles.grow} keyboardShouldPersistTaps="handled">
            {body}
          </ScrollView>
        ) : (
          body
        )}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type ButtonKind = 'primary' | 'brand' | 'secondary' | 'plain' | 'danger';

/** .btn: 52 high, radius 10, bold 16. primary is ink, secondary the soft grey, plain is text only. `small` is the 38 high pill. */
export function Button({
  label,
  onPress,
  kind = 'primary',
  small,
  icon,
  disabled,
  loading,
  style,
  tint,
}: {
  label: string;
  onPress?: () => void;
  kind?: ButtonKind;
  small?: boolean;
  icon?: ReactNode;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
  /** Fixed colours, for buttons on a surface that doesn't follow the theme (the black camera screen). */
  tint?: { bg: string; fg: string };
}) {
  const c = useColors();
  const off = disabled || loading;
  const bg =
    tint?.bg ?? { primary: c.ink, brand: c.brand, secondary: c.surface2, plain: 'transparent', danger: c.danger }[kind];
  const fg =
    tint?.fg ?? { primary: c.onInk, brand: c.onBrand, secondary: c.ink, plain: c.ink, danger: c.onDanger }[kind];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityLabel={label}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        small ? styles.buttonSmall : kind === 'plain' ? styles.buttonText : null,
        { backgroundColor: bg, opacity: off ? 0.35 : 1, transform: [{ scale: pressed && !off ? 0.98 : 1 }] },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {icon}
          <RNText
            style={[styles.buttonLabel, small && { fontSize: 14 }, { color: fg, flexShrink: 1, textAlign: 'center' }]}
          >
            {label}
          </RNText>
        </>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  prefix,
  style,
  onFocus,
  onBlur,
  ...rest
}: TextInputProps & { label: string; error?: string | null; prefix?: string }) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="small" tone="ink3">
        {label}
      </Text>
      <View
        style={[
          styles.field,
          {
            backgroundColor: focused ? c.surface : c.surface2,
            borderColor: error ? c.danger : focused ? c.ink : 'transparent',
          },
        ]}
      >
        {prefix ? (
          <Text variant="label" tone="ink2">
            {prefix}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={c.ink3}
          style={[styles.input, { color: c.ink, fontFamily: fonts.medium }, style]}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
      </View>
      {error ? (
        <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

/** The Jiffo wordmark, drawn as vector from the prototype's artwork. */
export function Wordmark({ height = 40 }: { height?: number }) {
  return <WordmarkSvg height={height} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  body: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.lg },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.md, paddingTop: space.sm },
  button: {
    minHeight: 52,
    paddingVertical: 8,
    borderRadius: 10,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonSmall: { minHeight: 38, paddingVertical: 6, paddingHorizontal: 14, borderRadius: radius.pill },
  buttonText: { minHeight: 44 },
  buttonLabel: { fontFamily: fonts.bold, fontSize: 16 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: 10,
    borderWidth: 2,
    paddingHorizontal: 14,
  },
  // The field draws its own focus border; the browser's outline would sit inside it on web.
  input: { flex: 1, fontSize: 17, minHeight: 52, ...(Platform.OS === 'web' ? { outlineWidth: 0 } : {}) },
});
