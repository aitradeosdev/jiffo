import { router } from 'expo-router';
import { View } from 'react-native';
import { VARIANT } from '@/config';
import { Button, Screen, Text, Wordmark } from '@/ui/kit';

const COPY = {
  customer: {
    title: 'Errands, done for you',
    body: 'Groceries, parcels, pharmacy runs and queues. A verified agent nearby does it, and your money is held until you get what you asked for.',
  },
  agent: {
    title: 'Earn running errands',
    body: 'Pick errands near you, set your price before you start, and get paid when you hand over. Earnings go to your own bank account.',
  },
} as const;

export default function Welcome() {
  const copy = COPY[VARIANT];
  return (
    <Screen footer={<Button label="Get started" onPress={() => router.push('/phone')} />}>
      <View style={{ flex: 1, justifyContent: 'center', gap: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Wordmark height={44} />
          {VARIANT === 'agent' ? (
            <Text variant="heading" tone="brand">
              Agent
            </Text>
          ) : null}
        </View>
        <Text variant="title">{copy.title}</Text>
        <Text tone="ink2">{copy.body}</Text>
      </View>
    </Screen>
  );
}
