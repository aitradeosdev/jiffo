import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '@/auth/session';
import { ApiError, errorMessage } from '@/api/client';
import { naira } from '@/money';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Field, Text } from '@/ui/kit';
import { Avatar, Icon } from '@/ui/parts';
import { PageFooter } from '@/ui/floating';
import { COMPLETED_BY_TEXT, stepTime } from './stage';
import { Lines } from './trip';
import type { ErrandView } from './types';

const TIPS = [0, 20_000, 50_000, 100_000];

/** After hand-off: the receipt, a star rating and an optional tip, all going to the agent. */
export function CustomerRate({ errand, onDone }: { errand: ErrandView; onDone: () => void }) {
  const c = useColors();
  const { api } = useSession();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [tip, setTip] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tipped, setTipped] = useState(!!errand.tipped);
  const [rated, setRated] = useState(!!errand.ratedByMe);
  const name = errand.agent?.firstName ?? 'your agent';
  const dropoff = errand.stops.find((s) => s.kind === 'dropoff');
  const when = stepTime(errand, 4);
  const how = errand.completedBy ? COMPLETED_BY_TEXT[errand.completedBy] : 'completed';
  // Item money counts only if it was locked; an unlocked amount was never paid.
  const items = errand.itemsLocked ? (errand.itemAmountKobo ?? 0) : 0;
  const tipNow = tipped ? 0 : tip;
  const total = errand.feeKobo + errand.serviceFeeKobo + items + tipNow;

  const finish = () => {
    onDone();
    router.replace('/home');
  };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      if (tipNow) {
        try {
          await api.post(`/v1/errands/${errand.id}/tip`, { amountKobo: tipNow });
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'already_tipped')) throw e;
        }
        setTipped(true);
      }
      if (stars && !rated) {
        try {
          await api.post(`/v1/errands/${errand.id}/rating`, { stars, comment: comment.trim() || undefined });
        } catch (e) {
          if (!(e instanceof ApiError && e.code === 'already_rated')) throw e;
        }
        setRated(true);
      }
      finish();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.surface }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.hero}>
          <View style={[styles.tick, { backgroundColor: c.brand2 }]}>
            <Icon name="check" size={36} weight={2.8} color={c.onBrand} />
          </View>
          <Text variant="title" accessibilityRole="header" style={{ textAlign: 'center' }}>
            Delivered to {dropoff?.label ?? 'your drop-off'}
          </Text>
          <Text variant="sub" tone="ink3">
            {when ? `${when} · ` : ''}
            {how}
          </Text>
        </View>

        <View style={[styles.block, { alignItems: 'center' }]}>
          <Avatar name={name} size={64} />
          {rated ? (
            <Text variant="heading" style={{ textAlign: 'center' }}>
              Thanks for rating {name}
            </Text>
          ) : (
            <>
              <Text variant="heading" style={{ textAlign: 'center' }}>
                How was your errand with {name}?
              </Text>
              <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable
                    key={n}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: n === stars }}
                    accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
                    onPress={() => setStars(n)}
                    style={({ pressed }) => [styles.star, { transform: [{ scale: pressed ? 1.2 : 1 }] }]}
                  >
                    <Icon
                      name="star"
                      size={34}
                      weight={1.6}
                      filled={n <= stars}
                      color={n <= stars ? c.ink : c.surface3}
                    />
                  </Pressable>
                ))}
              </View>
              {stars ? (
                <View style={{ alignSelf: 'stretch' }}>
                  <Field
                    label="Anything to add? (optional)"
                    value={comment}
                    onChangeText={setComment}
                    maxLength={500}
                    multiline
                  />
                </View>
              ) : null}
            </>
          )}
        </View>

        <View style={styles.block}>
          <Text variant="sec" accessibilityRole="header">
            {tipped ? `You tipped ${name}` : 'Add a tip'}
          </Text>
          {tipped ? (
            <Text variant="note" tone="ink3">
              All of it goes to {name}. Thank you.
            </Text>
          ) : (
            <>
              <Text variant="note" tone="ink3" style={{ marginTop: -6 }}>
                It goes to {name} in full.
              </Text>
              <View style={styles.tips}>
                {TIPS.map((t) => (
                  <Pressable
                    key={t}
                    accessibilityRole="button"
                    accessibilityState={{ selected: tip === t }}
                    accessibilityLabel={t ? `Tip ${naira(t)}` : 'No tip'}
                    onPress={() => setTip(t)}
                    style={[styles.tipBtn, { backgroundColor: tip === t ? c.ink : c.surface2 }]}
                  >
                    <Text style={[styles.tipText, { color: tip === t ? c.onInk : c.ink }]}>
                      {t ? naira(t) : 'None'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>

        <View style={styles.block}>
          <Text variant="sec" accessibilityRole="header">
            Receipt
          </Text>
          <Lines
            rows={[
              ['Errand fee', naira(errand.feeKobo)],
              ['Service fee', naira(errand.serviceFeeKobo)],
              ...(items ? ([['Items (receipt)', naira(items)]] as const) : []),
              ...(tipNow ? ([['Tip', naira(tipNow)]] as const) : []),
            ]}
            total={['Total', naira(total)]}
          />
        </View>
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <PageFooter>
        <Button label={(stars && !rated) || tipNow ? 'Submit' : 'Done'} onPress={submit} loading={busy} />
      </PageFooter>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 28, gap: 22 },
  hero: { alignItems: 'center', gap: 8, paddingTop: 8, paddingBottom: 4 },
  tick: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  block: { gap: 12 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  star: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },
  tips: { flexDirection: 'row', gap: 8 },
  tipBtn: { flex: 1, height: 46, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tipText: { fontFamily: fonts.bold, fontSize: 15 },
});
