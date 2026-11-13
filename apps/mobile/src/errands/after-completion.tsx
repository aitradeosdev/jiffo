import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { useSession } from '../auth/session';
import { ApiError, errorMessage } from '../api/client';
import { useColors } from '../theme/theme';
import { space } from '../theme/tokens';
import { Button, Field, Text } from '../ui/kit';
import { Card, Icon } from '../ui/parts';
import type { ErrandView } from './types';

/** After hand-off, the agent rates the customer, once. (Customers rate and tip on their receipt screen.) */
export function AfterCompletion({ errand, onDone }: { errand: ErrandView; onDone: () => void }) {
  const c = useColors();
  const { api } = useSession();
  const [stars, setStars] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = errand.customer?.firstName ?? 'the customer';

  const rate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/v1/errands/${errand.id}/rating`, { stars, comment: comment.trim() || undefined });
      onDone();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_rated') onDone();
      else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (errand.ratedByMe) return <Text tone="ink3">Thanks for rating {name}.</Text>;
  return (
    <View style={{ gap: space.md }}>
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
              <Icon name="star" size={30} filled={n <= stars} color={n <= stars ? c.ink : c.surface3} />
            </Pressable>
          ))}
        </View>
        {stars ? (
          <>
            <Field label="Anything to add? (optional)" value={comment} onChangeText={setComment} maxLength={500} />
            <Button label="Send rating" onPress={rate} loading={busy} />
          </>
        ) : null}
      </Card>
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
