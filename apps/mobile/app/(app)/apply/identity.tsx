import { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { ProviderName, providerName, useApplication, type Application, type CheckOutcome } from '@/agent/application';
import { Confirmed, FieldGroup, Point, Waiting } from '@/agent/apply-parts';
import { ProviderSdk } from '@/agent/identity-sdk';
import { Button, Text } from '@/ui/kit';
import { ObScreen, Question, TextBox } from '@/ui/onboarding';

type Phase = 'nin' | 'bvn' | 'sdk' | 'finishing' | 'done';
interface Started {
  sdkToken: string;
  provider: string;
}
interface Finished {
  status: 'pending' | 'done';
  outcome?: CheckOutcome;
}

/** The identity result already on the application, as this screen shows it. */
function savedOutcome(app: Application): CheckOutcome | 'pending' | null {
  if (app.identityChecking) return 'pending';
  if (!app.steps.identity) return null;
  const own = app.checks.filter((c) => ['nin', 'bvn', 'selfie', 'duplicate'].includes(c.key));
  if (own.some((c) => c.outcome === 'failed')) return 'failed';
  const all = ['nin', 'bvn', 'selfie'].every((key) => own.some((c) => c.key === key));
  return all && own.every((c) => c.outcome === 'passed') ? 'passed' : 'review';
}

const digits = (text: string) => text.replace(/\D/g, '').slice(0, 11);
const mask = (number: string) => `•••••••${number.slice(-4)}`;
/** How often, and how many times, the app asks for the result after the provider's screens. */
const FINISH_EVERY_MS = 2_000;
const FINISH_TRIES = 10;

/**
 * Identity: the NIN, then the BVN, then the provider's own screens for the BVN approval and the selfie. The
 * numbers go to the API, which passes them to the provider and keeps neither.
 */
export default function Identity() {
  const { api } = useSession();
  const { app, reload } = useApplication();
  // Opened again after a check: start from its result, so it isn't replaced by accident.
  const [phase, setPhase] = useState<Phase>(app && (app.steps.identity || app.identityChecking) ? 'done' : 'nin');
  const [nin, setNin] = useState('');
  const [bvn, setBvn] = useState('');
  const [started, setStarted] = useState<Started | null>(null);
  const [outcome, setOutcome] = useState<CheckOutcome | 'pending' | null>(() => app && savedOutcome(app));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const provider = providerName(app);
  const back = () => router.dismissTo('/apply');

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setStarted(await api.post<Started>('/v1/agent/application/identity', { nin, bvn, consent: true }));
      setPhase('sdk');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    setPhase('finishing');
    setError(null);
    try {
      for (let i = 0; i < FINISH_TRIES && mounted.current; i += 1) {
        const result = await api.post<Finished>('/v1/agent/application/identity/finish');
        if (result.status === 'done') {
          setOutcome(result.outcome ?? 'review');
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, FINISH_EVERY_MS));
      }
      if (!mounted.current) return;
      setOutcome((o) => o ?? 'pending');
      setPhase('done');
      await reload();
    } catch (e) {
      if (!mounted.current) return;
      setError(errorMessage(e));
      setPhase('bvn');
    }
  };

  if (phase === 'sdk' && started) {
    return (
      <ProviderSdk
        provider={started.provider}
        providerLabel={provider}
        sdkToken={started.sdkToken}
        bvnMasked={mask(bvn)}
        onDone={finish}
        onCancel={() => setPhase('bvn')}
      />
    );
  }

  if (phase === 'finishing') {
    return (
      <ObScreen>
        <Question
          title="Checking your identity"
          sub={`${ProviderName(app)} is matching your selfie to your ID photo.`}
        />
        <Waiting busy title="Usually a few seconds" sub="Keep the app open" />
      </ObScreen>
    );
  }

  if (phase === 'done') {
    const again = () => {
      setNin('');
      setBvn('');
      setOutcome(null);
      setPhase('nin');
    };
    return (
      <ObScreen
        footer={
          <View style={{ gap: 8 }}>
            <Button label="Back to your application" onPress={back} />
            <Button
              kind="secondary"
              label={outcome === 'failed' ? 'Check the numbers and try again' : 'Check again'}
              onPress={again}
            />
            {outcome === 'passed' ? (
              <Text variant="note" tone="ink3" style={{ textAlign: 'center' }}>
                Checking again replaces this result.
              </Text>
            ) : null}
          </View>
        }
      >
        <Question title={outcome === 'passed' ? 'Identity checked' : 'Identity sent'} />
        {outcome === 'passed' ? (
          <Confirmed
            title="Your NIN, BVN and selfie match"
            sub={
              app?.legalName
                ? `Name on your NIN: ${app.legalName}`
                : 'We keep the result, your legal name and date of birth'
            }
          />
        ) : outcome === 'pending' ? (
          <Waiting
            icon="clock"
            title={`${ProviderName(app)} is still checking`}
            sub="Carry on with the other steps. The result is on your application when it's back."
          />
        ) : (
          <Waiting
            icon="alert"
            title="Some results need a closer look"
            sub={
              outcome === 'failed'
                ? 'A number may have been typed wrong. Try again, or carry on and our team looks when you submit.'
                : 'Carry on with the other steps. Our team looks at it when you submit.'
            }
          />
        )}
      </ObScreen>
    );
  }

  if (phase === 'bvn') {
    return (
      <ObScreen
        onBack={() => setPhase('nin')}
        progress={2 / 3}
        footer={<Button label="Continue" onPress={start} disabled={bvn.length !== 11} loading={busy} />}
      >
        <Question
          title="Your BVN"
          sub="Step 2 of 3. It confirms the payout account is yours. We can't move money with it."
        />
        <FieldGroup
          label="Bank Verification Number"
          note="Dial *565*0# on the phone number linked to your bank to see it."
        >
          <TextBox
            accessibilityLabel="Bank Verification Number"
            placeholder="11 digits"
            inputMode="numeric"
            keyboardType="number-pad"
            maxLength={11}
            value={bvn}
            onChangeText={(t) => setBvn(digits(t))}
            autoFocus
          />
        </FieldGroup>
        <Reassurance provider={provider} />
        <Text variant="note" tone="ink3">
          By continuing you agree to {provider} checking your NIN with NIMC and your BVN with NIBSS, and to taking a
          selfie to match your ID photo.
        </Text>
        {error ? (
          <Text tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </ObScreen>
    );
  }

  return (
    <ObScreen
      onBack={back}
      progress={1 / 3}
      footer={<Button label="Continue" onPress={() => setPhase('bvn')} disabled={nin.length !== 11} />}
    >
      <Question title="Your NIN" sub="Step 1 of 3. Every agent on Jiffo has had their ID checked." />
      <FieldGroup label="National Identification Number" note="On your NIN slip or card, or dial *346# to see it.">
        <TextBox
          accessibilityLabel="National Identification Number"
          placeholder="11 digits"
          inputMode="numeric"
          keyboardType="number-pad"
          maxLength={11}
          value={nin}
          onChangeText={(t) => setNin(digits(t))}
          autoFocus
        />
      </FieldGroup>
      <Reassurance provider={provider} />
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </ObScreen>
  );
}

function Reassurance({ provider }: { provider: string }) {
  return (
    <View>
      <Point
        icon="shield"
        title={`Checked by ${provider}`}
        sub="Our identity provider checks it with the issuer, such as NIMC"
      />
      <Point icon="eyeoff" title="We don't keep your ID" sub="We keep the result, your legal name and date of birth" />
    </View>
  );
}
