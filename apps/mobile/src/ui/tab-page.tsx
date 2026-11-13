import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useColors } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { Text } from './kit';

/** .tabpage with .phead.big: a tab's large left-aligned title over a scrolling body. */
export function TabPage({
  title,
  children,
  refreshing,
  onRefresh,
  gap = 16,
}: {
  title?: string;
  children: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
  gap?: number;
}) {
  const c = useColors();
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.bg }]} edges={['top']}>
      {title ? (
        <View style={styles.head}>
          <Text style={styles.title} accessibilityRole="header">
            {title}
          </Text>
        </View>
      ) : null}
      <ScrollView
        contentContainerStyle={[styles.body, { gap }, !title && { paddingTop: 22 }]}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined}
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  head: { minHeight: 60, justifyContent: 'center', paddingHorizontal: 16, paddingTop: 6 },
  title: { fontFamily: fonts.bold, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 28 },
});
