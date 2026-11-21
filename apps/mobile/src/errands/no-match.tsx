import { useRef, useState } from 'react';
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
  // One request at a time, in the order the switch was flipped, so the server ends as the switch was left;
  // only the last one's answer is shown.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef(0);
  const change = (next: boolean) => {
    const turn = ++latest.current;
    setOn(next);
    setError(null);
    queue.current = queue.current.then(async () => {
      try {
        const path = `/v1/errands/${errand.id}/no-match`;
        const saved = next ? await api.put<{ noMatch: boolean }>(path) : await api.delete<{ noMatch: boolean }>(path);
        if (turn === latest.current) setOn(saved.noMatch);
      } catch (e) {
        if (turn !== latest.current) return;
        setOn(!next);
        setError(errorMessage(e));
      }
    });
  };
  // The name may be a fallback such as "the customer": the sentence starts with a capital either way.
  const who = name.charAt(0).toUpperCase() + name.slice(1);
  return (
    <View style={{ gap: 6 }}>
      <ToggleRow
        title={`Don't match me with ${name} again`}
        subtitle={`${who} isn't told. You can turn this off here later.`}
        value={on}
        onChange={change}
      />
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </View>
  );
}
