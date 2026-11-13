import { useRef } from 'react';
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
  // Once this agent has had the errand, it never turns back into a request for them: if the customer
  // released them, or they left, it went back to matching for other agents.
  const wasMine = useRef(false);
  if (errand?.role === 'agent') wasMine.current = true;

  if (!errand) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        {error ? <Text tone="danger">{error}</Text> : <ActivityIndicator />}
      </View>
    );
  }
  const movedOn = wasMine.current && errand.role === 'prospect';
  if (errand.role === 'prospect' && !movedOn) {
    return (
      <AgentRequest errand={errand} onAccept={() => act('accept')} accepting={busy === 'accept'} error={actionError} />
    );
  }
  // An errand support settled as cancelled can still have paid the agent: show what it paid.
  if (errand.status === 'completed' || (errand.status === 'cancelled' && errand.settlement)) {
    return <AgentDone errand={errand} onRated={reload} />;
  }
  if (movedOn || errand.status === 'cancelled' || errand.status === 'expired' || errand.status === 'requested') {
    // Cancelled by the customer, or released back to matching: this agent is done with it.
    return (
      <View style={[styles.center, { backgroundColor: c.surface, gap: 12, padding: 24 }]}>
        <IconCircle icon="x" size={64} />
        <Text variant="title" style={{ textAlign: 'center' }}>
          {errand.status === 'cancelled' ? 'The customer cancelled' : 'This errand moved on'}
        </Text>
        <Text variant="sub" tone="ink3" style={{ textAlign: 'center' }}>
          {errand.status === 'cancelled'
            ? 'Nothing more to do here.'
            : 'It went back to other agents. Nothing more to do here.'}
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
