import { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { formatE164 } from '@/auth/phone';
import { useCountryConfig } from '@/api/useCountryConfig';
import { VARIANT } from '@/config';
import { Button, Screen, Text } from '@/ui/kit';
import { Row } from '@/ui/parts';

export default function Account() {
  const { user, signOut } = useSession();
  const { config } = useCountryConfig();
  const [error, setError] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const leave = async () => {
    setLeaving(true);
    setError(null);
    try {
      await signOut();
    } catch (e) {
      setError(errorMessage(e));
      setLeaving(false);
    }
  };
  return (
    <Screen footer={<Button kind="secondary" label="Sign out" onPress={leave} loading={leaving} />}>
      <Text variant="title">{[user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Account'}</Text>
      <View>
        <Row
          icon="phone"
          title={user ? formatE164(user.phone, config?.country.phonePrefix ?? '') : '…'}
          subtitle="Phone number"
        />
        <Row icon="info" title={VARIANT === 'agent' ? 'Jiffo Agent' : 'Jiffo'} subtitle="Version 0.1.0" />
      </View>
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
