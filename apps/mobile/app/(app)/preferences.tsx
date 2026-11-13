import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { goBack } from '@/nav';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useResource } from '@/api/useResource';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { IconCircle, List, Row, Toggle } from '@/ui/parts';
import { PageHeader } from '@/ui/floating';

interface Profile {
  tier: string;
  categoryKeys: string[] | null;
  takesPurchases: boolean;
}

/**
 * Which errands the agent wants, after the prototype: purchase errands, and each category on or off.
 * Every change saves at once and applies to new requests, not errands already accepted.
 */
export default function Preferences() {
  const c = useColors();
  const { api } = useSession();
  const { config } = useCountryConfig();
  const profile = useResource<Profile>('/v1/agent/profile');
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [buys, setBuys] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const all = config?.categories ?? [];
  // The switches as the agent left them, read without waiting for a render, and saves one at a time.
  const current = useRef<{ chosen: Set<string> | null; buys: boolean }>({ chosen: null, buys: true });
  const queue = useRef<Promise<void>>(Promise.resolve());

  // Fill the switches once, from what is saved; after that the screen is the source until a save fails.
  const seed = useCallback(
    (saved: Profile) => {
      if (!config) return;
      const next = {
        chosen: new Set(saved.categoryKeys ?? config.categories.map((k) => k.key)),
        buys: saved.takesPurchases,
      };
      current.current = next;
      setChosen(next.chosen);
      setBuys(next.buys);
    },
    [config],
  );
  useEffect(() => {
    if (profile.data && current.current.chosen === null) seed(profile.data);
  }, [profile.data, seed]);

  // Saves straight away, in order. If one fails, the switches go back to what the server has.
  const save = (next: { chosen?: Set<string>; buys?: boolean }) => {
    current.current = { ...current.current, ...next };
    if (next.chosen) setChosen(next.chosen);
    if (next.buys !== undefined) setBuys(next.buys);
    setError(null);
    queue.current = queue.current.then(async () => {
      try {
        await api.patch('/v1/agent/profile', {
          // Every category on means "all", so new categories reach the agent too.
          ...(next.chosen ? { categoryKeys: next.chosen.size === all.length ? null : [...next.chosen] } : {}),
          ...(next.buys !== undefined ? { takesPurchases: next.buys } : {}),
        });
      } catch (e) {
        setError(errorMessage(e));
        const saved = await api.get<Profile>('/v1/agent/profile').catch(() => null);
        if (saved) seed(saved);
      }
    });
  };

  const toggle = (key: string) => {
    const chosenNow = current.current.chosen;
    if (!chosenNow) return;
    const next = new Set(chosenNow);
    if (next.has(key)) {
      if (next.size === 1) return setError('Keep at least one category on, or you would see no errands.');
      next.delete(key);
    } else next.add(key);
    save({ chosen: next });
  };

  return (
    <SafeAreaView style={[styles.fill, { backgroundColor: c.surface }]} edges={['top', 'bottom']}>
      <PageHeader title="" onBack={goBack} />
      <ScrollView contentContainerStyle={styles.body}>
        <View style={{ gap: 6 }}>
          <Text variant="title" accessibilityRole="header">
            Errand preferences
          </Text>
          <Text variant="small" tone="ink3">
            Urgent requests and the board only show errands that match. Changes apply to new requests, not errands
            you&apos;ve accepted.
          </Text>
        </View>

        <View style={[styles.buy, { backgroundColor: c.surface2 }]}>
          <IconCircle icon="bag" tone={buys ? 'brand' : undefined} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.buyTitle}>Purchase errands</Text>
            <Text variant="note" tone="ink3">
              You pay for items first; the item money is paid to you at hand-off.
            </Text>
          </View>
          <Toggle label="Purchase errands" green value={buys} onChange={(v) => save({ buys: v })} />
        </View>

        <View style={styles.secRow}>
          <Text variant="sec">Categories</Text>
          {chosen && chosen.size < all.length ? (
            <Button
              kind="secondary"
              small
              label="Turn all on"
              onPress={() => save({ chosen: new Set(all.map((k) => k.key)) })}
            />
          ) : null}
        </View>
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <List>
          {all.map((k) => (
            <Row
              key={k.key}
              icon={k.icon}
              title={k.name}
              subtitle={k.description || null}
              right={<Toggle label={k.name} green value={!!chosen?.has(k.key)} onChange={() => toggle(k.key)} />}
            />
          ))}
        </List>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 28, gap: 16 },
  buy: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14 },
  buyTitle: { fontFamily: fonts.bold, fontSize: 15.5 },
  secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
});
