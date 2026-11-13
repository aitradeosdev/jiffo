import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useColors } from '@/theme/theme';
import { Text } from '@/ui/kit';
import { EndedErrand } from './ended';
import { Matching } from './matching';
import { CustomerRate } from './rate';
import { CustomerTrip } from './trip';
import { useErrand, useHandoffPin } from './use-errand';

/**
 * The customer's view of one errand: matching while it waits for an agent, the live tracker while it
 * runs, the receipt with rating and tip once delivered, and a short summary if it ended unfinished.
 * Its actions come from the server's allowedEvents.
 */
export function CustomerErrand({ id }: { id: string }) {
  const c = useColors();
  const state = useErrand(id);
  const { errand, error, reload, can, act, busy, actionError, shortKobo } = state;
  const pin = useHandoffPin(errand);
  // While matching, look again every half minute so the count of agents nearby stays current.
  const matching = errand?.status === 'requested';
  useEffect(() => {
    if (!matching) return;
    const timer = setInterval(reload, 30_000);
    return () => clearInterval(timer);
  }, [matching, reload]);

  if (!errand) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg, padding: 24 }}>
        {error ? <Text tone="danger">{error}</Text> : <ActivityIndicator />}
      </View>
    );
  }
  if (errand.status === 'requested') {
    return (
      <Matching
        errand={errand}
        onCancel={can('cancel') ? () => act('cancel') : undefined}
        cancelling={busy === 'cancel'}
        onRaise={can('raise_fee') ? (amountKobo) => act('raise_fee', { amountKobo }) : undefined}
        raising={busy === 'raise_fee'}
        shortKobo={shortKobo}
        error={actionError}
      />
    );
  }
  if (errand.status === 'completed') return <CustomerRate errand={errand} onDone={reload} />;
  if (errand.status === 'cancelled' || errand.status === 'expired') return <EndedErrand errand={errand} />;
  return <CustomerTrip errand={errand} pin={pin} actions={{ can, act, busy, actionError }} />;
}
