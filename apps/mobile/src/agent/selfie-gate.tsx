import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { errorMessage } from '@/api/client';
import { useSession } from '@/auth/session';
import { useColors } from '@/theme/theme';
import { space } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { SELFIE_WHY, waitForVerdict, type SelfieAnswer, type SelfieReason, type StartedSelfie } from './selfie';
import { SelfieCapture, selfieCaptureAvailable } from './selfie-capture';
import type { CaptureEnd } from './selfie-capture.types';

interface SelfieGate {
  /** Asks for a selfie check; true once it passed. False when the agent left it, or it didn't pass. */
  take: (reason: SelfieReason) => Promise<boolean>;
}

const SelfieContext = createContext<SelfieGate>({ take: async () => false });

/** The selfie check, wherever the server asks for one: going online, money actions, the PIN. */
export const useSelfie = () => useContext(SelfieContext);

type Step =
  | { kind: 'closed' }
  | { kind: 'intro'; error?: string }
  | { kind: 'capture'; started: StartedSelfie; consentedAt: string }
  | { kind: 'checking'; started: StartedSelfie }
  | { kind: 'answer'; started: StartedSelfie; answer: SelfieAnswer };

/**
 * Agents' selfie checks (docs/security-plan.md, A4, I2, I8, P8, X4): says why one is asked for, takes it in
 * Smile ID's own SDK, and waits for the verdict the server got from Smile ID. Only the outcome is kept.
 */
export function SelfieProvider({ children }: { children: ReactNode }) {
  const c = useColors();
  const { api, user, signOut } = useSession();
  const [step, setStep] = useState<Step>({ kind: 'closed' });
  const [reason, setReason] = useState<SelfieReason>('daily');
  const [busy, setBusy] = useState(false);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (passed: boolean) => void } | null>(null);

  const close = useCallback((passed: boolean) => {
    setStep({ kind: 'closed' });
    pending.current?.resolve(passed);
    pending.current = null;
  }, []);

  const take = useCallback((why: SelfieReason) => {
    if (pending.current) return pending.current.promise;
    let resolve!: (passed: boolean) => void;
    const promise = new Promise<boolean>((r) => {
      resolve = r;
    });
    pending.current = { promise, resolve };
    setReason(why);
    setStep({ kind: 'intro' });
    return promise;
  }, []);

  const check = useCallback(
    async (started: StartedSelfie) => {
      setStep({ kind: 'checking', started });
      try {
        const answer = await waitForVerdict(() => api.post<SelfieAnswer>(`/v1/agent/selfie/${started.id}/finish`, {}));
        if (answer.status === 'passed') return close(true);
        setStep({ kind: 'answer', started, answer });
      } catch (e) {
        setStep({ kind: 'intro', error: errorMessage(e) });
      }
    },
    [api, close],
  );

  // Tapping "Take selfie" is agreeing to it, with the notice on this screen.
  const begin = async () => {
    setBusy(true);
    try {
      const started = await api.post<StartedSelfie>(
        '/v1/agent/selfie',
        reason === 'payout_change' ? { for: 'payout_change' } : {},
      );
      // The development provider decides on its own, with no camera.
      if (!started.session.token) return void (await check(started));
      if (!selfieCaptureAvailable()) {
        setStep({ kind: 'intro', error: 'This needs the Jiffo Agent app from the App Store or Google Play.' });
        return;
      }
      setStep({ kind: 'capture', started, consentedAt: new Date().toISOString() });
    } catch (e) {
      setStep({ kind: 'intro', error: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const captured = (started: StartedSelfie) => (end: CaptureEnd) => {
    if (end === 'sent') return void check(started);
    setStep({
      kind: 'intro',
      error: end === 'error' ? "The selfie couldn't be sent. Check your connection and try again." : undefined,
    });
  };

  const value = useMemo(() => ({ take }), [take]);
  const open = step.kind !== 'closed';
  return (
    <SelfieContext.Provider value={value}>
      {children}
      <Modal visible={open} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => close(false)}>
        {step.kind === 'capture' ? (
          <SelfieCapture
            session={step.started.session}
            givenNames={user?.firstName ?? ''}
            lastName={user?.lastName ?? ''}
            consentedAt={step.consentedAt}
            onEnd={captured(step.started)}
          />
        ) : (
          <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={['top', 'bottom']}>
            <View style={{ flex: 1, padding: space.lg, gap: space.md, justifyContent: 'center' }}>
              {step.kind === 'intro' ? (
                <>
                  <Text variant="title" accessibilityRole="header">
                    Take a quick selfie
                  </Text>
                  <Text tone="ink2">{SELFIE_WHY[reason]}</Text>
                  <Text variant="small" tone="ink3">
                    Smile ID compares it with the photo from your ID check. Jiffo keeps only the result, never the
                    photo.
                  </Text>
                  {step.error ? (
                    <Text tone="danger" accessibilityLiveRegion="polite">
                      {step.error}
                    </Text>
                  ) : null}
                  <Button label="Take selfie" onPress={() => void begin()} loading={busy} />
                  <Button label="Not now" kind="plain" onPress={() => close(false)} disabled={busy} />
                </>
              ) : step.kind === 'checking' ? (
                <>
                  <Text variant="title" accessibilityRole="header">
                    Checking your selfie
                  </Text>
                  <Text tone="ink2">This takes a few seconds.</Text>
                </>
              ) : step.kind === 'answer' ? (
                <Answer
                  answer={step.answer}
                  again={() => setStep({ kind: 'intro' })}
                  recheck={() => void check(step.started)}
                  leave={() => close(false)}
                  signOut={() => {
                    close(false);
                    void signOut();
                  }}
                />
              ) : null}
            </View>
          </SafeAreaView>
        )}
      </Modal>
    </SelfieContext.Provider>
  );
}

function Answer({
  answer,
  again,
  recheck,
  leave,
  signOut,
}: {
  answer: SelfieAnswer;
  again: () => void;
  recheck: () => void;
  leave: () => void;
  signOut: () => void;
}) {
  if (answer.status === 'suspended') {
    return (
      <>
        <Text variant="title" accessibilityRole="header">
          Account paused
        </Text>
        <Text tone="ink2">
          Your selfies didn't match your ID, so your account is paused for our team to look at. Contact support.
        </Text>
        <Button label="OK" onPress={signOut} />
      </>
    );
  }
  if (answer.status === 'pending') {
    return (
      <>
        <Text variant="title" accessibilityRole="header">
          Still checking
        </Text>
        <Text tone="ink2">Smile ID hasn't answered yet. Check again in a minute.</Text>
        <Button label="Check again" onPress={recheck} />
        <Button label="Not now" kind="plain" onPress={leave} />
      </>
    );
  }
  const failed = answer.status === 'failed';
  const left = failed ? answer.triesLeft : undefined;
  return (
    <>
      <Text variant="title" accessibilityRole="header">
        {failed ? "That didn't match" : 'Take it again'}
      </Text>
      <Text tone="ink2">
        {failed
          ? `The selfie didn't match the photo from your ID check.${
              typeof left === 'number'
                ? ` ${left} ${left === 1 ? 'try' : 'tries'} left before your account is paused.`
                : ''
            }`
          : 'The selfie was unclear. Take it again in good light, with your face in the frame.'}
      </Text>
      <Button label="Try again" onPress={again} />
      <Button label="Not now" kind="plain" onPress={leave} />
    </>
  );
}
