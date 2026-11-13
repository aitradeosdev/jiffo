import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { ProviderName, providerName, useApplication, type Application, type CheckOutcome } from '@/agent/application';
import { Confirmed, Waiting } from '@/agent/apply-parts';
import { IdentityCheck, type FinishResult } from '@/identity/check';
import { Button, Text } from '@/ui/kit';
import { ObScreen, Question } from '@/ui/onboarding';

/** The identity result already on the application, as this screen shows it. */
function savedOutcome(app: Application): CheckOutcome | 'pending' | null {
  if (app.identityChecking) return 'pending';
  if (!app.steps.identity) return null;
  const id = app.identityIdType ?? 'nin';
  const keys = [id, 'bvn', 'selfie', 'duplicate', 'id_type'];
  const own = app.checks.filter((c) => keys.includes(c.key));
  if (own.some((c) => c.outcome === 'failed')) return 'failed';
  // As the API decides: the ID and the selfie must pass, and the BVN too when it is checked.
  const needed = [id, 'selfie', ...(app.withBvn && id !== 'bvn' ? ['bvn'] : [])];
  const all = needed.every((key) => own.some((c) => c.key === key));
  return all && own.every((c) => c.outcome === 'passed') ? 'passed' : 'review';
}

/** Where the provider's page sends the agent back to (see the API's identity/done page). */
const RETURN_URL = 'jiffo-agent://identity-done';

/**
 * Identity: one of the IDs on offer, the BVN when it is checked as well, and the provider's selfie (see
 * IdentityCheck). Opened again after a check, it shows the result, so it isn't replaced by accident.
 */
export default function Identity() {
  const { app, reload } = useApplication();
  const [checking, setChecking] = useState<false | 'new' | 'resume'>(
    app && (app.steps.identity || app.identityChecking) ? false : 'new',
  );
  const [outcome, setOutcome] = useState<CheckOutcome | 'pending' | null>(() => app && savedOutcome(app));
  const provider = providerName(app);
  const hosted = app?.identityFlow === 'hosted';
  const back = () => router.dismissTo('/apply');

  if (!app) return null;

  const onFinished = async (result: FinishResult | 'pending') => {
    setOutcome(result === 'pending' ? 'pending' : (result.outcome ?? 'review'));
    setChecking(false);
    await reload();
  };

  if (checking) {
    return (
      <IdentityCheck
        options={{
          idTypes: app.idTypes,
          withBvn: app.withBvn,
          flow: app.identityFlow,
          idChosenOnPage: app.idChosenOnPage,
          provider: app.provider,
        }}
        paths={{ start: '/v1/agent/application/identity', finish: '/v1/agent/application/identity/finish' }}
        returnUrl={RETURN_URL}
        why="Every agent on Jiffo has had their ID checked."
        resume={checking === 'resume' ? { hosted } : undefined}
        onBack={back}
        onFinished={onFinished}
      />
    );
  }

  const again = () => {
    setOutcome(null);
    setChecking('new');
  };
  return (
    <ObScreen
      footer={
        <View style={{ gap: 8 }}>
          <Button label="Back to your application" onPress={back} />
          {outcome === 'pending' ? (
            // Asks about the check already running: starting a new one would mean doing it all again.
            <>
              <Button kind="secondary" label="Ask for the result again" onPress={() => setChecking('resume')} />
              <Button kind="plain" label="Start a new check" onPress={again} />
            </>
          ) : (
            <Button
              kind="secondary"
              label={outcome === 'failed' && !hosted ? 'Check the numbers and try again' : 'Check again'}
              onPress={again}
            />
          )}
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
          title={
            app.withBvn && app.identityIdType !== 'bvn' ? 'Your ID, BVN and selfie match' : 'Your ID and selfie match'
          }
          sub={
            app.legalName
              ? `Name on your ID: ${app.legalName}`
              : 'We keep the result, your legal name and date of birth'
          }
        />
      ) : outcome === 'pending' ? (
        <Waiting
          icon="clock"
          title={`${ProviderName(app)} is still checking`}
          sub={
            hosted
              ? `Carry on with the other steps. The result is on your application when it's back. If you closed ${provider}'s page before the end, start a new check.`
              : "Carry on with the other steps. The result is on your application when it's back."
          }
        />
      ) : (
        <Waiting
          icon="alert"
          title="Some results need a closer look"
          sub={
            outcome === 'failed' && !hosted
              ? 'A number may have been typed wrong. Try again, or carry on and our team looks when you submit.'
              : 'Carry on with the other steps. Our team looks at it when you submit.'
          }
        />
      )}
    </ObScreen>
  );
}
