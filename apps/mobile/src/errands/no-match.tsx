import { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '../auth/session';
import { errorMessage } from '../api/client';
import { Text } from '../ui/kit';
import { ToggleRow } from '../ui/parts';
import type { ErrandView } from './types';

/**
 * "Don't match me again" with the other person on an errand (docs/matching.md, M1): saved at once, and undone
 * here the same way. The other person is never told.
 */
export function NoMatch({ errand, name }: { errand: ErrandView; name: string }) {
  const { api } = useSession();
  const [on, setOn] = useState(!!errand.noMatch);
  const [error, setError] = useState<string | null>(null);
  const change = async (next: boolean) => {
    setOn(next);
    setError(null);
    try {
      const path = `/v1/errands/${errand.id}/no-match`;
      const saved = next ? await api.put<{ noMatch: boolean }>(path) : await api.delete<{ noMatch: boolean }>(path);
      setOn(saved.noMatch);
    } catch (e) {
      setOn(!next);
      setError(errorMessage(e));
    }
  };
  return (
    <View style={{ gap: 6 }}>
      <ToggleRow
        title={`Don't match me with ${name} again`}
        subtitle={`${name} isn't told. You can turn this off here later.`}
        value={on}
        onChange={(v) => void change(v)}
      />
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
