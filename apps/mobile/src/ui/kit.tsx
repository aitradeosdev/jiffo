import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
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
import { useColors, useScheme } from '../theme/theme';
import { fonts, radius, space } from '../theme/tokens';

type Tone = 'ink' | 'ink2' | 'ink3' | 'brand' | 'danger' | 'onBrand';
type Variant = 'title' | 'heading' | 'body' | 'label' | 'small';

const VARIANTS: Record<Variant, TextStyle> = {
  title: { fontFamily: fonts.bold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.bold, fontSize: 20, lineHeight: 26 },
  body: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21 },
  label: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20 },
  small: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
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

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress?: () => void;
  kind?: 'primary' | 'secondary' | 'plain';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const c = useColors();
  const off = disabled || loading;
  const bg = kind === 'primary' ? c.ink : kind === 'secondary' ? c.surface2 : 'transparent';
  const fg = kind === 'primary' ? c.onInk : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityLabel={label}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: off ? 0.45 : pressed ? 0.85 : 1 }, style]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text variant="label" style={{ color: fg }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  prefix,
  style,
  ...rest
}: TextInputProps & { label: string; error?: string | null; prefix?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="small" tone="ink3">
        {label}
      </Text>
      <View style={[styles.field, { backgroundColor: c.surface2, borderColor: error ? c.danger : 'transparent' }]}>
        {prefix ? (
          <Text variant="label" tone="ink2">
            {prefix}
          </Text>
        ) : null}
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={c.ink3}
          style={[styles.input, { color: c.ink, fontFamily: fonts.medium }, style]}
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

export function Wordmark({ height = 40 }: { height?: number }) {
  const scheme = useScheme();
  const source =
    scheme === 'dark'
      ? require('../../assets/brand/wordmark-white-1600.png')
      : require('../../assets/brand/wordmark-black-1600.png');
  // The exported wordmark is 1600 x 758.
  return (
    <Image
      source={source}
      accessibilityLabel="Jiffo"
      style={{ height, width: (height * 1600) / 758 }}
      resizeMode="contain"
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  body: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.lg, gap: space.lg },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.md, paddingTop: space.sm },
  button: {
    minHeight: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    paddingHorizontal: space.lg,
  },
  // The field draws its own focus border; the browser's outline would sit inside it on web.
  input: { flex: 1, fontSize: 17, minHeight: 52, ...(Platform.OS === 'web' ? { outlineWidth: 0 } : {}) },
});
