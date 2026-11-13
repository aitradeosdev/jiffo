import { useState } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import { CALLABLE_STATES, type ErrandState } from '@jiffo/shared';
import { useSession } from '../auth/session';
import { ApiError, errorMessage } from '../api/client';
import { useCountryConfig } from '../api/useCountryConfig';
import { useColors } from '../theme/theme';
import { Button, Text } from '../ui/kit';
import { ModalSheet } from '../ui/modal-sheet';
import { Icon, IconCircle } from '../ui/parts';

/** Whether the two sides of an errand can call each other now. */
export const canCall = (status: ErrandState) => CALLABLE_STATES.has(status);

/**
 * .cbtn: the round phone button next to the other person's name. It asks first, then Jiffo rings the
 * person's own phone and connects them; neither sees the other's number.
 */
export function CallButton({ errandId, name, style }: { errandId: string; name: string; style?: ViewStyle }) {
  const c = useColors();
  const { config } = useCountryConfig();
  const [open, setOpen] = useState(false);
  // No button until the server has a calls provider set up.
  if (!config?.features?.calls) return null;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Call ${name}`}
        onPress={() => setOpen(true)}
        style={[styles.cbtn, { backgroundColor: c.surface2 }, style]}
      >
        <Icon name="phone" size={20} />
      </Pressable>
      <CallSheet visible={open} onClose={() => setOpen(false)} errandId={errandId} name={name} />
    </>
  );
}

function CallSheet({
  visible,
  onClose,
  errandId,
  name,
}: {
  visible: boolean;
  onClose: () => void;
  errandId: string;
  name: string;
}) {
  const c = useColors();
  const { api } = useSession();
  const [state, setState] = useState<'idle' | 'busy' | 'ringing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    onClose();
    setState('idle');
    setError(null);
  };
  const ring = async () => {
    setState('busy');
    setError(null);
    try {
      await api.post(`/v1/errands/${errandId}/call`);
      setState('ringing');
    } catch (e) {
      // A call placed moments ago (a second tap): the phone is about to ring, which is what was wanted.
      if (e instanceof ApiError && e.code === 'call_just_placed') {
        setState('ringing');
        return;
      }
      setError(errorMessage(e));
      setState('idle');
    }
  };
  return (
    <ModalSheet visible={visible} onClose={close} label={`Call ${name}`}>
      {state === 'ringing' ? (
        <>
          <View style={styles.ringing} accessibilityLiveRegion="polite">
            <IconCircle tone="brand" size={56}>
              <Icon name="phone" size={26} color={c.brandInk} />
            </IconCircle>
            <Text variant="heading" style={{ textAlign: 'center' }}>
              Your phone will ring in a moment
            </Text>
            <Text tone="ink2" style={{ textAlign: 'center' }}>
              Answer it to be connected to {name}.
            </Text>
          </View>
          <Button label="Done" kind="secondary" onPress={close} />
        </>
      ) : (
        <>
          <View style={{ gap: 6 }}>
            <Text variant="heading">Call {name}</Text>
            <Text tone="ink2">
              Jiffo rings your phone first, then connects you to {name}. Neither of you sees the other&apos;s number.
            </Text>
          </View>
          <Text variant="note" tone="ink3">
            Calls aren&apos;t recorded. Confirm anything you agree on a call in the chat too.
          </Text>
          {error ? (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button
            label="Ring my phone"
            icon={<Icon name="phone" size={18} color={c.onInk} />}
            onPress={ring}
            loading={state === 'busy'}
          />
        </>
      )}
    </ModalSheet>
  );
}

const styles = StyleSheet.create({
  cbtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  ringing: { alignItems: 'center', gap: 10, paddingVertical: 8 },
});
