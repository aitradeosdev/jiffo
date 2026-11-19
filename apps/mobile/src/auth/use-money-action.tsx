import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { ApiError } from '@/api/client';
import { useSession } from '@/auth/session';
import { space } from '@/theme/tokens';
import { Button, Field, Text } from '@/ui/kit';
import { ModalSheet } from '@/ui/modal-sheet';
import { canSign, forgetPin, moneyRequest, recallPin, setUpPhone, type SecurityStatus } from './device-security';

/** What to show for a money action's error, with the tries left after a wrong PIN. */
export function moneyErrorMessage(error: unknown, fallback: (e: unknown) => string): string {
  if (error instanceof ApiError && error.code === 'pin_wrong') {
    const left = error.details.triesLeft;
    return typeof left === 'number' ? `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Wrong PIN.';
  }
  return fallback(error);
}

/**
 * Runs a withdrawal or payout account change (docs/security-plan.md, A3, A7): sets this phone up if it isn't,
 * sends the agent to create or reset their PIN if needed, asks for the PIN (by fingerprint or face when it is
 * kept behind them), then signs and sends the request. Render `sheet` in the screen. Resolves null when the
 * person went to set a PIN or cancelled.
 */
export function useMoneyAction() {
  const { api } = useSession();
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState('');
  const answer = useRef<((pin: string | null) => void) | null>(null);

  const askPin = useCallback(async (): Promise<string | null> => {
    const kept = await recallPin();
    if (kept) return kept;
    setTyped('');
    setAsking(true);
    return new Promise((resolve) => {
      answer.current = resolve;
    });
  }, []);

  const finish = (pin: string | null) => {
    setAsking(false);
    answer.current?.(pin);
    answer.current = null;
  };

  const run = useCallback(
    async <T,>(method: 'POST' | 'PUT', path: string, body: unknown, backTo: string): Promise<T | null> => {
      if (!canSign()) {
        throw new ApiError(0, 'unsupported', 'This needs the Jiffo Agent app from the App Store or Google Play.');
      }
      const status = await api.get<SecurityStatus>('/v1/me/security');
      if (!status.deviceKey && (await setUpPhone(api)) === 'sign_in_again') {
        throw new ApiError(403, 'sign_in_again', 'Sign out and in again on this phone to set it up for money.');
      }
      if (!status.hasPin || status.pinLocked) {
        router.push({ pathname: '/pin', params: { next: backTo, ...(status.pinLocked ? { reset: '1' } : {}) } });
        return null;
      }
      const pin = await askPin();
      if (!pin) return null;
      try {
        return await moneyRequest<T>(api, method, path, body, pin);
      } catch (error) {
        if (error instanceof ApiError && (error.code === 'pin_wrong' || error.code === 'pin_locked')) {
          // A kept PIN that no longer works is forgotten, so the next try asks for it.
          await forgetPin();
          if (error.code === 'pin_locked') router.push({ pathname: '/pin', params: { next: backTo, reset: '1' } });
        }
        throw error;
      }
    },
    [api, askPin],
  );

  const sheet = (
    <ModalSheet visible={asking} onClose={() => finish(null)} label="Enter your app PIN">
      <Text variant="title">Enter your app PIN</Text>
      <View style={{ gap: space.md }}>
        <Field
          label="App PIN"
          value={typed}
          onChangeText={(t) => setTyped(t.replace(/\D/g, '').slice(0, 4))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          autoFocus
        />
        <Button label="Confirm" onPress={() => finish(typed)} disabled={typed.length !== 4} />
      </View>
    </ModalSheet>
  );

  return { run, sheet };
}
