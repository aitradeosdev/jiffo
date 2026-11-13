import { useState } from 'react';
import { View } from 'react-native';
import { errorMessage } from '@/api/client';
import { VARIANT } from '@/config';
import { useSession } from '@/auth/session';
import { useCountryConfig } from '@/api/useCountryConfig';
import { Button, Screen, Text, Wordmark } from '@/ui/kit';

/** A placeholder home for each app until the errand screens land. Proves sign-in and the API end to end. */
export default function Home() {
  const { user, signOut } = useSession();
  const { config, error } = useCountryConfig();
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leave = async () => {
    setLeaving(true);
    setSignOutError(null);
    try {
      await signOut();
    } catch (e) {
      setSignOutError(errorMessage(e));
      setLeaving(false);
    }
  };
  return (
    <Screen footer={<Button kind="secondary" label="Sign out" onPress={leave} loading={leaving} />}>
      <Wordmark height={32} />
      <Text variant="title">{user?.firstName ? `Hi ${user.firstName}` : 'Hi there'}</Text>
      <Text tone="ink2">
        {VARIANT === 'agent'
          ? 'Your errand board arrives in the next update.'
          : 'Sending errands arrives in the next update.'}
      </Text>
      <View style={{ gap: 6 }}>
        {config ? (
          <Text variant="small" tone="ink3">
            {config.country.name}: {config.categories.length} categories, {config.states.length} states
          </Text>
        ) : null}
        {error ? (
          <Text variant="small" tone="danger">
            {error}
          </Text>
        ) : null}
        {signOutError ? (
          <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
            {signOutError}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
