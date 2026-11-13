import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSession } from '../auth/session';
import { ApiError, errorMessage } from '../api/client';
import { naira } from '../money';
import { useColors } from '../theme/theme';
import { space } from '../theme/tokens';
import { Button, Field, Text } from '../ui/kit';
import { Card, Chip, Icon } from '../ui/parts';
import type { ErrandView } from './types';

const TIPS = [20_000, 50_000, 100_000];

/**
 * After hand-off. The customer can tip (all of it goes to the agent) and rate the agent; the agent
 * rates the customer. Each once.
 */
export function AfterCompletion({ errand, onDone }: { errand: ErrandView; onDone: () => void }) {
  const c = useColors();
  const { api } = useSession();
  const [tip, setTip] = useState<number | null>(null);
  const [tipped, setTipped] = useState(!!errand.tipped);
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState<'tip' | 'rate' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isAgent = errand.role === 'agent';
  const name = isAgent ? (errand.customer?.firstName ?? 'the customer') : (errand.agent?.firstName ?? 'your agent');

  const sendTip = async () => {
    if (!tip) return;
    setBusy('tip');
    setError(null);
    try {
      await api.post(`/v1/errands/${errand.id}/tip`, { amountKobo: tip });
      setTipped(true);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_tipped') setTipped(true);
      else setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const rate = async () => {
    setBusy('rate');
    setError(null);
    try {
      await api.post(`/v1/errands/${errand.id}/rating`, { stars, comment: comment.trim() || undefined });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_rated') onDone();
      else setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <View style={{ gap: space.md }}>
      {isAgent ? null : (
        <Card>
          <Text variant="label">{tipped ? `Thanks! ${name} gets all of it.` : `Tip ${name}?`}</Text>
          {tipped ? null : (
            <>
              <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
                {TIPS.map((t) => (
                  <Chip key={t} label={naira(t)} selected={tip === t} onPress={() => setTip(tip === t ? null : t)} />
                ))}
              </View>
              {tip ? <Button label={`Tip ${naira(tip)}`} onPress={sendTip} loading={busy === 'tip'} /> : null}
            </>
          )}
        </Card>
      )}
      {errand.ratedByMe ? (
        <Text tone="ink3">Thanks for rating {name}.</Text>
      ) : (
        <Card>
          <Text variant="label">How was {name}?</Text>
          <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityRole="radiogroup">
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                accessibilityRole="radio"
                accessibilityState={{ checked: stars === n }}
                accessibilityLabel={`${n} star${n > 1 ? 's' : ''}`}
                onPress={() => setStars(n)}
                hitSlop={6}
              >
                <Icon name="star" size={30} color={n <= stars ? c.ink : c.surface3} />
              </Pressable>
            ))}
          </View>
          {stars ? (
            <>
              <Field label="Anything to add? (optional)" value={comment} onChangeText={setComment} maxLength={500} />
              <Button label="Send rating" onPress={rate} loading={busy === 'rate'} />
            </>
          ) : null}
        </Card>
      )}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
