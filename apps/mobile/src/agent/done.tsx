import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/session';
import { ApiError, errorMessage } from '../api/client';
import { naira } from '../money';
import { useColors } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { Button, Field, Text } from '../ui/kit';
import { Avatar, Icon } from '../ui/parts';
import { PageFooter } from '../ui/floating';
import { Lines } from '../errands/trip';
import { shortWhen } from '../errands/when';
import type { ErrandView } from '../errands/types';

const TIER = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' } as Record<string, string>;

/** After hand-off, for the agent: what they earned and when they can withdraw it, and a rating. */
export function AgentDone({ errand, onRated }: { errand: ErrandView; onRated: () => void }) {
  const c = useColors();
  const { api } = useSession();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rated, setRated] = useState(!!errand.ratedByMe);
  const s = errand.settlement;
  const name = errand.customer?.firstName ?? 'the customer';
  const earned = s ? s.agentKobo + s.tipKobo : (errand.agentEarnsKobo ?? 0);
  const how = {
    pin: `Hand-off confirmed with ${name}'s PIN`,
    photo: `${name} approved your drop-off photo`,
    auto: 'Your drop-off photo was approved after 24 hours',
    support: 'Completed by support',
  }[errand.completedBy ?? 'pin'];
  const headline = s?.bySupport ? 'Settled by Jiffo support' : how;
  // What support moved away from the usual share, so the lines still add up to the earnings.
  const changedBySupport = s?.bySupport ? errand.feeKobo - s.commissionKobo - s.agentKobo : 0;
  const pct = s && errand.feeKobo ? Math.round((s.commissionKobo / errand.feeKobo) * 100) : null;

  const rate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/errands/${errand.id}/rating`, { stars, comment: comment.trim() || undefined });
      setRated(true);
      onRated();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_rated') setRated(true);
      else setError(errorMessage(e));
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
          <Text variant="title" accessibilityRole="header">
            {naira(earned)} earned
          </Text>
          <Text variant="sub" tone="ink3" style={{ textAlign: 'center' }}>
            {headline}
          </Text>
        </View>

        {s ? (
          <View style={styles.block}>
            <Text variant="sec">This errand</Text>
            <Lines
              rows={[
                ['Errand fee', naira(errand.feeKobo)],
                [
                  `Commission${s.tier ? ` (${TIER[s.tier] ?? s.tier}${pct !== null ? `, ${pct}%` : ''})` : ''}`,
                  `−${naira(s.commissionKobo)}`,
                ],
                ...(changedBySupport
                  ? ([
                      [
                        'Changed by support',
                        changedBySupport > 0 ? `−${naira(changedBySupport)}` : naira(-changedBySupport),
                      ],
                    ] as const)
                  : []),
                ...(s.tipKobo ? ([[`Tip from ${name}`, naira(s.tipKobo)]] as const) : []),
              ]}
              total={['Your earnings', naira(earned)]}
            />
            <Text variant="note" tone="ink3">
              {s.heldUntil
                ? `Withdrawable ${shortWhen(s.heldUntil)}. Silver and above get errand earnings instantly.`
                : 'Withdrawable now.'}
            </Text>
          </View>
        ) : null}

        {s?.itemsKobo ? (
          <View style={[styles.itemsCard, { backgroundColor: c.brandSoft }]}>
            <Icon name="check" size={20} weight={2.4} color={c.brandInk} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.itemsTitle, { color: c.ink }]}>{naira(s.itemsKobo)} item money paid back</Text>
              <Text variant="note" tone="ink2">
                Withdrawable now. You spent your own money, so it never waits.
              </Text>
            </View>
          </View>
        ) : null}

        {/* Ratings are for completed errands only. */}
        {errand.status === 'completed' ? (
          <View style={[styles.block, { alignItems: 'center' }]}>
            <Avatar name={errand.customer?.firstName} size={56} />
            {rated ? (
              <Text variant="heading">Thanks for rating {name}</Text>
            ) : (
              <>
                <Text variant="heading">How was {name}?</Text>
                <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Pressable
                      key={n}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: n === stars }}
                      accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
                      onPress={() => setStars(n)}
                      style={styles.star}
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
                  <View style={{ alignSelf: 'stretch', gap: 10 }}>
                    <Field
                      label="Anything to add? (optional)"
                      value={comment}
                      onChangeText={setComment}
                      maxLength={500}
                    />
                    <Button kind="secondary" label="Send rating" onPress={rate} loading={busy} />
                  </View>
                ) : null}
              </>
            )}
          </View>
        ) : null}
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <PageFooter>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button kind="secondary" label="Earnings" onPress={() => router.replace('/wallet')} style={{ flex: 1 }} />
          <Button label="Back to the board" onPress={() => router.replace('/home')} style={{ flex: 1.4 }} />
        </View>
      </PageFooter>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingHorizontal: 16, paddingTop: 28, paddingBottom: 28, gap: 22 },
  hero: { alignItems: 'center', gap: 8 },
  tick: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  block: { gap: 12 },
  itemsCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14 },
  itemsTitle: { fontFamily: fonts.bold, fontSize: 15 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  star: { width: 50, height: 50, alignItems: 'center', justifyContent: 'center' },
});
