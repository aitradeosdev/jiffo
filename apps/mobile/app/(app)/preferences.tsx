import { useEffect, useState } from 'react';
import { goBack } from '@/nav';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useResource } from '@/api/useResource';
import { Button, Screen, Text } from '@/ui/kit';
import { CategoryIcon, Icon, Row, ToggleRow } from '@/ui/parts';

interface Profile {
  tier: string;
  categoryKeys: string[] | null;
  takesPurchases: boolean;
}

/** Which errands the agent wants to see: categories, and whether they buy items with their own money. */
export default function Preferences() {
  const { api } = useSession();
  const { config } = useCountryConfig();
  const profile = useResource<Profile>('/v1/agent/profile');
  const [chosen, setChosen] = useState<Set<string> | null>(null);
  const [buys, setBuys] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile.data || !config) return;
    setChosen(new Set(profile.data.categoryKeys ?? config.categories.map((c) => c.key)));
    setBuys(profile.data.takesPurchases);
  }, [profile.data, config]);

  const all = config?.categories ?? [];
  const toggle = (key: string) =>
    setChosen((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const save = async () => {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      // Every category ticked means "all", so new categories reach the agent too.
      const categoryKeys = chosen.size === all.length ? null : [...chosen];
      await api.patch('/v1/agent/profile', { categoryKeys, takesPurchases: buys });
      goBack();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen footer={<Button label="Save" onPress={save} disabled={!chosen || chosen.size === 0} loading={busy} />}>
      <Text variant="title">Errand preferences</Text>
      <ToggleRow
        title="I buy items"
        subtitle="Errands where you pay first and are repaid at hand-off"
        value={buys}
        onChange={setBuys}
      />
      <Text variant="label">Categories</Text>
      {all.map((c) => (
        <Row
          key={c.key}
          iconNode={<CategoryIcon icon={c.icon} />}
          title={c.name}
          right={chosen?.has(c.key) ? <Icon name="check-square" /> : <Icon name="square" />}
          onPress={() => toggle(c.key)}
        />
      ))}
      {chosen?.size === 0 ? <Text tone="danger">Choose at least one category</Text> : null}
      {error ? <Text tone="danger">{error}</Text> : null}
    </Screen>
  );
}
