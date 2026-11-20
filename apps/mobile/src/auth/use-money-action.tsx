import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { ApiError } from '@/api/client';
import { useSession } from '@/auth/session';
import { withSelfie } from '@/agent/selfie';
import { SelfieHost, useSelfie } from '@/agent/selfie-gate';
import { space } from '@/theme/tokens';
import { Button, Field, Text } from '@/ui/kit';
import { ModalSheet } from '@/ui/modal-sheet';
import { canSign, forgetPin, moneyRequest, recallPin, setUpPhone, type SecurityStatus } from './device-security';
import { NEVER_ASK } from '@/safety/never-ask';

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
 * kept behind them), then signs and sends the request, after a selfie when the server asks for one. Render
 * `sheet` in the screen. Resolves null when the person went to set a PIN, cancelled, or didn't pass the selfie.
 */
export function useMoneyAction() {
  const { api, user } = useSession();
  const selfie = useSelfie();
  const userId = user?.id ?? '';
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState('');
  const answer = useRef<((pin: string | null) => void) | null>(null);

  /** The PIN, and whether it came from behind the fingerprint (so a wrong one there is forgotten). */
  const askPin = useCallback(async (): Promise<{ pin: string; kept: boolean } | null> => {
    const kept = await recallPin(userId);
    if (kept) return { pin: kept, kept: true };
    setTyped('');
    setAsking(true);
    const typedPin = await new Promise<string | null>((resolve) => {
      answer.current = resolve;
    });
    return typedPin ? { pin: typedPin, kept: false } : null;
  }, [userId]);

  const finish = (pin: string | null) => {
    setAsking(false);
    answer.current?.(pin);
    answer.current = null;
  };

  const run = useCallback(
    async <T,>(method: 'POST' | 'PUT', path: string, body: unknown): Promise<T | null> => {
      if (!canSign()) {
        throw new ApiError(0, 'unsupported', 'This needs the Jiffo Agent app from the App Store or Google Play.');
      }
      const status = await api.get<SecurityStatus>('/v1/me/security');
      if (!status.deviceKey && (await setUpPhone(api)) === 'sign_in_again') {
        throw new ApiError(403, 'sign_in_again', 'Sign out and in again on this phone to set it up for money.');
      }
      // The PIN screen comes back here when it's done.
      if (!status.hasPin || status.pinLocked) {
        router.push({ pathname: '/pin', params: status.pinLocked ? { reset: '1' } : {} });
        return null;
      }
      const asked = await askPin();
      if (!asked) return null;
      try {
        // A new phone, or a payout change, needs a selfie first (A4, P8, X4): asked before the code is used.
        return await withSelfie(() => moneyRequest<T>(api, method, path, body, asked.pin), selfie.take);
      } catch (error) {
        // Only a kept PIN the server turned down is forgotten: a typed slip leaves the fingerprint on.
        if (asked.kept && error instanceof ApiError && (error.code === 'pin_wrong' || error.code === 'pin_locked')) {
          await forgetPin(userId);
        }
        if (error instanceof ApiError && error.code === 'pin_locked') {
          router.push({ pathname: '/pin', params: { reset: '1' } });
        }
        throw error;
      }
    },
    [api, askPin, userId, selfie.take],
  );

  // The selfie screens are drawn here too: Withdraw and Payout account are native modals, which on iOS only
  // a screen of their own can show another modal over.
  const sheet = (
    <>
      <SelfieHost />
      <ModalSheet visible={asking} onClose={() => finish(null)} label="Enter your app PIN">
        <Text variant="title">Enter your app PIN</Text>
        <Text variant="small" tone="ink3">
          {NEVER_ASK.appPin}
        </Text>
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
    </>
  );

  return { run, sheet };
}
