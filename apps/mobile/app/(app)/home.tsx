import { View } from 'react-native';
import { VARIANT } from '@/config';
import { useSession } from '@/auth/session';
import { useCountryConfig } from '@/api/useCountryConfig';
import { Button, Screen, Text, Wordmark } from '@/ui/kit';

/** A placeholder home for each app until the errand screens land. Proves sign-in and the API end to end. */
export default function Home() {
  const { user, signOut } = useSession();
  const { config, error } = useCountryConfig();
  return (
    <Screen footer={<Button kind="secondary" label="Sign out" onPress={signOut} />}>
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
      </View>
    </Screen>
  );
}
