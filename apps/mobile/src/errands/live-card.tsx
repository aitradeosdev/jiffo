import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Text } from '@/ui/kit';
import { Avatar, Icon } from '@/ui/parts';
import { Segments } from './progress';
import { STATUS_TEXT, stepOf, type ErrandView } from './types';
import { upcoming, whenLabel } from './when';

/** .livecard: a running errand, in black, with its progress. */
export function LiveCard({ errand }: { errand: ErrandView }) {
  const c = useColors();
  const step = stepOf(errand.status);
  const scheduled = errand.status === 'requested' ? upcoming(errand.scheduledFor) : null;
  const title = scheduled ? `Scheduled · ${whenLabel(scheduled)}` : STATUS_TEXT[errand.status];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. Open errand`}
      onPress={() => router.push(`/errand/${errand.id}`)}
      style={[styles.livecard, { backgroundColor: c.ink }]}
    >
      {step < 0 ? (
        <View style={[styles.ico, { backgroundColor: 'rgba(255,255,255,0.14)' }]}>
          <Icon name={scheduled ? 'cal' : 'search'} size={19} color={c.onInk} />
        </View>
      ) : (
        <Avatar name={errand.agent?.firstName} size={48} onInk />
      )}
      <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
        <Text style={[styles.liveTitle, { color: c.onInk }]} numberOfLines={1}>
          {title}
        </Text>
        {step < 0 ? (
          <Text variant="note" style={{ color: c.onInk, opacity: 0.75 }} numberOfLines={1}>
            {scheduled ? 'Goes on the board ahead of time' : 'Your errand is with nearby agents'}
          </Text>
        ) : (
          <Segments step={step} onInk />
        )}
      </View>
      <Icon name="chev" size={20} color={c.onInk} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ico: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  livecard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  liveTitle: { fontFamily: fonts.bold, fontSize: 15 },
});
