import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useColors } from '../theme/theme';
import { Button, Text } from '../ui/kit';
import { IconCircle } from '../ui/parts';
import { AgentDone } from '../agent/done';
import { AgentRequest } from '../agent/request';
import { AgentTrip } from '../agent/trip';
import { useErrand } from './use-errand';

/**
 * The agent's view of one errand: the request before accepting, the running job, and what it earned
 * once handed off. Every action comes from the server's allowedEvents.
 */
export function AgentErrand({ id }: { id: string }) {
  const c = useColors();
  const { errand, error, reload, can, act, busy, actionError } = useErrand(id);

  if (!errand) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        {error ? <Text tone="danger">{error}</Text> : <ActivityIndicator />}
      </View>
    );
  }
  if (errand.role === 'prospect') {
    return (
      <AgentRequest errand={errand} onAccept={() => act('accept')} accepting={busy === 'accept'} error={actionError} />
    );
  }
  if (errand.status === 'completed') return <AgentDone errand={errand} onRated={reload} />;
  if (errand.status === 'cancelled' || errand.status === 'expired' || errand.status === 'requested') {
    // Cancelled by the customer, or released back to matching: this agent is done with it.
    return (
      <View style={[styles.center, { backgroundColor: c.surface, gap: 12, padding: 24 }]}>
        <IconCircle icon="x" size={64} />
        <Text variant="title" style={{ textAlign: 'center' }}>
          {errand.status === 'cancelled' ? 'The customer cancelled' : 'This errand moved on'}
        </Text>
        <Text variant="sub" tone="ink3" style={{ textAlign: 'center' }}>
          Nothing more to do here. Anything you&apos;d earned on it stays yours.
        </Text>
        <Button label="Back to the board" onPress={() => router.replace('/home')} />
      </View>
    );
  }
  return <AgentTrip errand={errand} actions={{ can, act, busy, actionError }} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
