import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '../theme/theme';
import { useShadows } from './floating';

/** A sheet that slides up over the screen with a dimmed backdrop; tapping the backdrop closes it. */
export function ModalSheet({
  visible,
  onClose,
  label,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Read out when the sheet opens. */
  label: string;
  children: ReactNode;
}) {
  const c = useColors();
  const { sh3 } = useShadows();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]}
        />
        <View
          accessibilityViewIsModal
          accessibilityLabel={label}
          style={[styles.sheet, { backgroundColor: c.surface, boxShadow: sh3, paddingBottom: 18 + insets.bottom }]}
        >
          <View style={[styles.handle, { backgroundColor: c.surface3 }]} />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 10,
    paddingHorizontal: 16,
    gap: 16,
    maxHeight: '88%',
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { gap: 16 },
});
