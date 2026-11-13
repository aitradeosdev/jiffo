import { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { radius, space } from '../theme/tokens';
import { Icon } from './parts';

/** A row of photo thumbnails; tap one to see it full screen. */
export function Photos({ urls, label }: { urls: string[]; label: string }) {
  const [open, setOpen] = useState<string | null>(null);
  if (urls.length === 0) return null;
  return (
    <>
      <ScrollView horizontal contentContainerStyle={{ gap: space.sm }} showsHorizontalScrollIndicator={false}>
        {urls.map((url, i) => (
          <Pressable
            key={url}
            accessibilityRole="imagebutton"
            accessibilityLabel={`${label} ${i + 1} of ${urls.length}`}
            onPress={() => setOpen(url)}
          >
            <Image source={{ uri: url }} style={styles.thumb} resizeMode="cover" />
          </Pressable>
        ))}
      </ScrollView>
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <View style={styles.backdrop}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photo"
            onPress={() => setOpen(null)}
            style={styles.close}
            hitSlop={12}
          >
            <Icon name="x" size={28} color="#FFFFFF" />
          </Pressable>
          {open ? (
            <Image source={{ uri: open }} style={styles.full} resizeMode="contain" accessibilityLabel={label} />
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 96, height: 96, borderRadius: radius.md },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', top: 48, right: 20, zIndex: 1 },
  full: { width: '100%', height: '80%' },
});
