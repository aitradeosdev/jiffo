import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Linking, Modal, View } from 'react-native';
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

interface Hosts {
  hosts: string[];
  register: (id: string) => () => void;
  view: ReactNode;
}
const HostContext = createContext<Hosts | null>(null);

/**
 * Where the selfie screens are drawn, for a screen shown as a native modal (Withdraw, Payout account): on
 * iOS, a modal can't be shown over one from the app's root, so that screen draws it itself. Elsewhere the
 * provider draws it.
 */
export function SelfieHost() {
  const hosts = useContext(HostContext);
  const id = useId();
  const register = hosts?.register;
  useEffect(() => register?.(id), [register, id]);
  if (!hosts || hosts.hosts[hosts.hosts.length - 1] !== id) return null;
  return hosts.view;
}

type Step =
  | { kind: 'closed' }
  | { kind: 'starting' }
  | { kind: 'intro'; started: StartedSelfie | null; error?: string }
  | { kind: 'capture'; started: StartedSelfie; consentedAt: string }
  | { kind: 'checking'; started: StartedSelfie }
  | { kind: 'answer'; started: StartedSelfie; answer: SelfieAnswer; error?: string };

/** A Smile ID session the SDK can run with; without these it would refuse to start. */
const ready = (s: StartedSelfie) => !!s.session.token && !!s.session.partnerId && !!s.session.privacyPolicyUrl;

/**
 * Agents' selfie checks (docs/security-plan.md, A4, I2, I8, P8, X4): says why one is asked for, with the
 * privacy notice, takes it in Smile ID's own SDK, and waits for the verdict the server got from Smile ID.
 * Only the outcome is kept. Each request is its own: closing it drops whatever it was still doing.
 */
export function SelfieProvider({ children }: { children: ReactNode }) {
  const c = useColors();
  const { api, user, signOut } = useSession();
  const [step, setStep] = useState<Step>({ kind: 'closed' });
  const [reason, setReason] = useState<SelfieReason>('daily');
  const [hosts, setHosts] = useState<string[]>([]);
  const pending = useRef<{ promise: Promise<boolean>; resolve: (passed: boolean) => void } | null>(null);
  /** Changes with each request and when it closes, so work for an earlier one changes nothing. */
  const run = useRef(0);

  const close = useCallback((passed: boolean) => {
    run.current += 1;
    setStep({ kind: 'closed' });
    pending.current?.resolve(passed);
    pending.current = null;
  }, []);

  const start = useCallback(
    async (why: SelfieReason) => {
      const token = run.current;
      setStep({ kind: 'starting' });
      try {
        const started = await api.post<StartedSelfie>(
          '/v1/agent/selfie',
          why === 'payout_change' ? { for: 'payout_change' } : {},
        );
        if (run.current === token) setStep({ kind: 'intro', started });
      } catch (e) {
        if (run.current === token) setStep({ kind: 'intro', started: null, error: errorMessage(e) });
      }
    },
    [api],
  );

  const take = useCallback(
    (why: SelfieReason) => {
      // A payout change needs a fresh selfie: asked while another is open, it is what this one is for.
      if (pending.current) {
        if (why === 'payout_change' && reason !== 'payout_change') {
          run.current += 1;
          setReason(why);
          void start(why);
        }
        return pending.current.promise;
      }
      let resolve!: (passed: boolean) => void;
      const promise = new Promise<boolean>((r) => {
        resolve = r;
      });
      pending.current = { promise, resolve };
      run.current += 1;
      setReason(why);
      void start(why);
      return promise;
    },
    [reason, start],
  );

  const check = useCallback(
    async (started: StartedSelfie) => {
      const token = run.current;
      setStep({ kind: 'checking', started });
      try {
        const answer = await waitForVerdict(() => api.post<SelfieAnswer>(`/v1/agent/selfie/${started.id}/finish`, {}));
        if (run.current !== token) return;
        if (answer.status === 'passed') return close(true);
        setStep({ kind: 'answer', started, answer });
      } catch (e) {
        // The selfie was sent: keep this check, and ask again rather than take another.
        if (run.current === token) {
          setStep({ kind: 'answer', started, answer: { status: 'pending' }, error: errorMessage(e) });
        }
      }
    },
    [api, close],
  );

  // Tapping "Take selfie" is agreeing to it, with the notice on this screen.
  const begin = (started: StartedSelfie) => {
    // The development provider decides on its own, with no camera.
    if (!started.session.token) return void check(started);
    if (!selfieCaptureAvailable()) {
      return setStep({
        kind: 'intro',
        started,
        error: 'This needs the Jiffo Agent app from the App Store or Google Play.',
      });
    }
    if (!ready(started)) {
      return setStep({ kind: 'intro', started, error: "Selfie checks aren't set up yet. Contact support." });
    }
    setStep({ kind: 'capture', started, consentedAt: new Date().toISOString() });
  };

  const captured = (started: StartedSelfie) => (end: CaptureEnd) => {
    if (end === 'sent') return void check(started);
    setStep({
      kind: 'intro',
      started,
      error:
        end === 'error'
          ? "The selfie couldn't be taken or sent. Try again, or contact support if it keeps happening."
          : undefined,
    });
  };

  const register = useCallback((id: string) => {
    setHosts((h) => [...h, id]);
    return () => setHosts((h) => h.filter((x) => x !== id));
  }, []);

  const view = (
    <Modal
      visible={step.kind !== 'closed'}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={() => close(false)}
    >
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
            {step.kind === 'starting' || step.kind === 'intro' ? (
              <>
                <Text variant="title" accessibilityRole="header">
                  Take a quick selfie
                </Text>
                <Text tone="ink2">{SELFIE_WHY[reason]}</Text>
                <Text variant="small" tone="ink3">
                  Smile ID compares it with the photo from your ID check. Jiffo keeps only the result, never the photo.
                </Text>
                {step.kind === 'intro' && step.started?.session.privacyPolicyUrl ? (
                  <Button
                    label="Read the privacy notice"
                    kind="plain"
                    small
                    onPress={() => void Linking.openURL(step.started!.session.privacyPolicyUrl!)}
                  />
                ) : null}
                {step.kind === 'intro' && step.error ? (
                  <Text tone="danger" accessibilityLiveRegion="polite">
                    {step.error}
                  </Text>
                ) : null}
                {step.kind === 'intro' && step.started ? (
                  <Button label="Take selfie" onPress={() => begin(step.started!)} />
                ) : (
                  <Button
                    label={step.kind === 'starting' ? 'Take selfie' : 'Try again'}
                    loading={step.kind === 'starting'}
                    onPress={() => void start(reason)}
                  />
                )}
                <Button label="Not now" kind="plain" onPress={() => close(false)} />
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
                error={step.error}
                again={() => void start(reason)}
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
  );

  const value = useMemo(() => ({ take }), [take]);
  const hostValue = useMemo(() => ({ hosts, register, view }), [hosts, register, view]);
  return (
    <SelfieContext.Provider value={value}>
      <HostContext.Provider value={hostValue}>
        {children}
        {hosts.length === 0 ? view : null}
      </HostContext.Provider>
    </SelfieContext.Provider>
  );
}

function Answer({
  answer,
  error,
  again,
  recheck,
  leave,
  signOut,
}: {
  answer: SelfieAnswer;
  error?: string;
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
        <Text tone="ink2">
          {error
            ? `Your selfie was sent, but we couldn't get the answer: ${error}`
            : "Smile ID hasn't answered yet. Check again in a minute."}
        </Text>
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
