import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '@/nav';
import { useErrand } from '@/errands/use-errand';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Text } from '@/ui/kit';
import { Icon } from '@/ui/parts';
import { PageHeader } from '@/ui/floating';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

/** The hand-off PIN on a keypad, after the prototype. Four digits send it; a wrong one clears to retry. */
export default function Handoff() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = useColors();
  const { errand, act, busy, actionError } = useErrand(id);
  const [pin, setPin] = useState('');
  const name = errand?.customer?.firstName ?? 'the customer';
  const items = errand?.itemsLocked ? (errand.itemAmountKobo ?? 0) : 0;

  const press = async (key: string) => {
    if (busy) return;
    if (key === 'back') return setPin((p) => p.slice(0, -1));
    const next = (pin + key).slice(0, 4);
    setPin(next);
    if (next.length === 4) {
      const ok = await act('confirm_pin', { pin: next });
      if (ok) router.back();
      else setPin('');
    }
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.surface }]} edges={['top', 'bottom']}>
      <PageHeader title="Hand-off PIN" onBack={goBack} />
      <View style={styles.top}>
        <Text variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
          Enter {name}&apos;s PIN
        </Text>
        {errand ? (
          <Text variant="sub" tone="ink3" style={{ textAlign: 'center' }}>
            It releases {naira(errand.feeKobo)} for the errand{items ? ` and ${naira(items)} for the items` : ''}.
          </Text>
        ) : null}
        <View style={styles.boxes} accessibilityLabel={`${pin.length} of 4 digits entered`}>
          {[0, 1, 2, 3].map((i) => (
            <View
              key={i}
              style={[
                styles.box,
                {
                  backgroundColor: i < pin.length ? c.surface : c.surface2,
                  borderColor: i < pin.length ? c.ink : 'transparent',
                },
              ]}
            >
              <Text style={styles.dot}>{i < pin.length ? '•' : ''}</Text>
            </View>
          ))}
        </View>
        {actionError ? (
          <Text tone="danger" accessibilityLiveRegion="polite" style={{ textAlign: 'center' }}>
            {actionError}
          </Text>
        ) : null}
      </View>
      <View style={styles.pad}>
        {KEYS.map((k, i) =>
          k === '' ? (
            <View key={i} style={styles.key} />
          ) : (
            <Pressable
              key={i}
              accessibilityRole="button"
              accessibilityLabel={k === 'back' ? 'Delete' : k}
              onPress={() => press(k)}
              style={({ pressed }) => [
                styles.key,
                { backgroundColor: k === 'back' ? 'transparent' : c.surface2, opacity: pressed ? 0.6 : 1 },
              ]}
            >
              {k === 'back' ? <Icon name="backspace" size={26} /> : <Text style={styles.keyText}>{k}</Text>}
            </Pressable>
          ),
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flex: 1, justifyContent: 'center', gap: 12, paddingHorizontal: 24 },
  boxes: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 12 },
  box: { width: 58, height: 64, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  dot: { fontFamily: fonts.extrabold, fontSize: 28 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 22, paddingBottom: 24 },
  key: { width: '31%', flexGrow: 1, height: 60, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontFamily: fonts.semibold, fontSize: 26 },
});
