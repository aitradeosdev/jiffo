import { useState, type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { noWebOutline, Text } from './kit';
import { Icon } from './parts';

/** .ob: a sign-up step with a back button, a progress bar, the step, and its button at the bottom. */
export function ObScreen({
  onBack,
  progress,
  footer,
  children,
}: {
  onBack?: () => void;
  /** 0 to 1 through sign-up; leave out on screens outside it. */
  progress?: number;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.head}>
          {onBack ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.ib}>
              <Icon name="back" size={24} />
            </Pressable>
          ) : (
            <View style={styles.ib} />
          )}
          {progress !== undefined ? (
            <View
              accessibilityRole="progressbar"
              accessibilityLabel="Sign-up progress"
              accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
              style={[styles.prog, { backgroundColor: c.surface3 }]}
            >
              <View style={[styles.progFill, { width: `${progress * 100}%`, backgroundColor: c.ink }]} />
            </View>
          ) : null}
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
        {footer ? <View style={styles.foot}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** .obq: the step's question, with a line under it. */
export function Question({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.q} accessibilityRole="header">
        {title}
      </Text>
      {sub ? (
        <Text variant="sub" tone="ink3">
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** .tin: a big text box with its name in the placeholder; black border while typing. In a row, pass flex: 1. */
export function TextBox({ style, onFocus, onBlur, ...rest }: TextInputProps & { accessibilityLabel: string }) {
  const c = useColors();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      placeholderTextColor={c.ink3}
      onFocus={(e) => {
        setFocused(true);
        onFocus?.(e);
      }}
      onBlur={(e) => {
        setFocused(false);
        onBlur?.(e);
      }}
      style={[
        styles.tin,
        {
          color: c.ink,
          backgroundColor: focused ? c.surface : c.surface2,
          borderColor: focused ? c.ink : 'transparent',
        },
        noWebOutline,
        style,
      ]}
      {...rest}
    />
  );
}

/** Nigeria's flag, drawn: green, white, green. */
export function Flag({ country }: { country: string }) {
  if (country !== 'NG') return null;
  return (
    <View style={styles.flag} accessibilityElementsHidden importantForAccessibility="no">
      <View style={{ flex: 1, backgroundColor: '#008751' }} />
      <View style={{ flex: 1, backgroundColor: '#FFFFFF' }} />
      <View style={{ flex: 1, backgroundColor: '#008751' }} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 56,
    paddingTop: 6,
    paddingLeft: 10,
    paddingRight: 16,
  },
  ib: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  prog: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', marginRight: 6 },
  progFill: { height: '100%', borderRadius: 2 },
  body: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 24, gap: 18 },
  foot: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16 },
  q: { fontFamily: fonts.bold, fontSize: 27, lineHeight: 31, letterSpacing: -0.54 },
  tin: {
    minWidth: 0,
    height: 54,
    borderRadius: 10,
    borderWidth: 2,
    paddingHorizontal: 14,
    fontSize: 17,
    fontFamily: fonts.semibold,
    letterSpacing: 0.5,
  },
  flag: {
    width: 22,
    height: 15,
    borderRadius: 2,
    overflow: 'hidden',
    flexDirection: 'row',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.14)',
  },
});
