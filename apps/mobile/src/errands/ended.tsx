import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '@/nav';
import { useColors } from '@/theme/theme';
import { Button, Text } from '@/ui/kit';
import { IconCircle } from '@/ui/parts';
import { PageFooter, PageHeader } from '@/ui/floating';
import { useDraft } from './draft';
import type { ErrandView, PlacePick } from './types';

/** A cancelled errand, or one no agent took: what happened to the money, and a quick way to try again. */
export function EndedErrand({ errand }: { errand: ErrandView }) {
  const c = useColors();
  const { reset } = useDraft();
  const expired = errand.status === 'expired';
  const place = (kind: 'pickup' | 'stop' | 'dropoff'): PlacePick | null => {
    const s = errand.stops.find((x) => x.kind === kind);
    return s
      ? {
          placeId: `errand:${errand.id}:${s.seq}`,
          name: s.label ?? s.address,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          stateCode: errand.stateCode,
        }
      : null;
  };
  const again = () => {
    reset({
      categoryKey: errand.categoryKey,
      description: errand.description,
      buy: errand.buy,
      pickup: place('pickup'),
      stop: place('stop'),
      dropoff: place('dropoff'),
    });
    router.replace('/plan');
  };
  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.surface }]} edges={['top', 'bottom']}>
      <PageHeader title="" onBack={goBack} />
      <View style={styles.body}>
        <IconCircle icon={expired ? 'clock' : 'x'} size={64} />
        <Text variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
          {expired ? 'No agent took it in time' : 'Errand cancelled'}
        </Text>
        <Text variant="sub" tone="ink3" style={{ textAlign: 'center' }}>
          {expired
            ? 'Nothing was held from your wallet. Try again, maybe with a higher fee.'
            : 'Anything that was held went back to your wallet.'}
        </Text>
        <Text tone="ink2" style={{ textAlign: 'center' }} numberOfLines={3}>
          {errand.description}
        </Text>
      </View>
      <PageFooter>
        <View style={{ gap: 8 }}>
          <Button label="Request it again" onPress={again} />
          <Button kind="plain" label="Back to home" onPress={() => router.replace('/home')} />
        </View>
      </PageFooter>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
});
