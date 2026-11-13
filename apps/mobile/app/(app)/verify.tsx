import { useState } from 'react';
import { router } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '@/auth/session';
import { Confirmed, Waiting } from '@/agent/apply-parts';
import { IdentityCheck } from '@/identity/check';
import { useCustomerIdentity } from '@/identity/customer';
import { capitalised, idName, providerLabel } from '@/identity/ids';
import { Button, Text } from '@/ui/kit';
import { ObScreen, Question } from '@/ui/onboarding';
import { List, Row } from '@/ui/parts';

/** Where the provider's page sends the customer back to (see the API's identity/done page). */
const RETURN_URL = 'jiffo://identity-done';

/**
 * The customer's identity check, during sign-up and whenever they open it again: one of the IDs on offer and
 * a selfie, checked by the identity provider. Adding money and requesting errands open once verified.
 */
export default function Verify() {
  const { user } = useSession();
  const { identity, error, reload } = useCustomerIdentity();
  const [checking, setChecking] = useState<false | 'new' | 'resume'>(false);
  const [busy, setBusy] = useState(false);
  // Each check is a fresh screen, so one that finished never stays on its last step.
  const [attempt, setAttempt] = useState(0);
  // The result couldn't be loaded after a check: said, with a way to load it again.
  const [lost, setLost] = useState(false);
  const home = () => router.replace('/home');
  const leave = () => (router.canGoBack() ? router.back() : home());

  if (!identity || lost) {
    return (
      <ObScreen onBack={leave}>
        <Question title="Verify your identity" />
        {error || lost ? (
          <>
            <Waiting icon="alert" title="Couldn't load this" sub="Check your connection and try again." />
            <Button
              kind="secondary"
              label="Try again"
              onPress={async () => {
                if (await reload()) setLost(false);
              }}
            />
          </>
        ) : (
          <Waiting busy title="Loading" />
        )}
      </ObScreen>
    );
  }

  const provider = providerLabel(identity.provider);
  const start = checking || (identity.status === 'none' ? 'new' : false);
  if (start) {
    return (
      <IdentityCheck
        key={attempt}
        options={identity}
        paths={{ start: '/v1/me/identity', finish: '/v1/me/identity/finish' }}
        returnUrl={RETURN_URL}
        why="Every customer and agent is verified, so you know who's running your errand and they know who they're running it for."
        resume={start === 'resume' ? { hosted: (identity.startedFlow ?? identity.flow) === 'hosted' } : undefined}
        onBack={checking ? () => setChecking(false) : leave}
        onFinished={async () => {
          const next = await reload();
          setAttempt((n) => n + 1);
          setChecking(false);
          if (!next) setLost(true);
        }}
      />
    );
  }

  const again = async () => {
    setBusy(true);
    await reload();
    setBusy(false);
    setAttempt((n) => n + 1);
    setChecking('new');
  };

  if (identity.status === 'verified') {
    return (
      <ObScreen footer={<Button label="Continue" onPress={leave} />}>
        <Question
          title={`You're verified${user?.firstName ? `, ${user.firstName}` : ''}`}
          sub="Your ID and selfie match. Agents see a verified badge next to your name."
        />
        <List>
          {identity.legalName ? <Row icon="user" title="Legal name" subtitle={identity.legalName} /> : null}
          <Row icon="check" title="Age" subtitle="18 or older" />
          {identity.idType ? <Row icon="card" title="ID" subtitle={idName(identity.idType)} /> : null}
          <Row icon="shield" title="Checked by" subtitle={provider} />
        </List>
        <Confirmed title="You can add money now" sub="By bank transfer from any bank app. Cards aren't accepted." />
      </ObScreen>
    );
  }

  if (identity.status === 'checking') {
    return (
      <ObScreen
        onBack={leave}
        footer={
          <View style={{ gap: 8 }}>
            <Button label="Ask for the result again" onPress={() => setChecking('resume')} />
            <Button kind="plain" label="Start a new check" onPress={again} loading={busy} />
          </View>
        }
      >
        <Question title="We're checking your ID" />
        <Waiting
          icon="clock"
          title={`${capitalised(provider)} is still checking`}
          sub={
            (identity.startedFlow ?? identity.flow) === 'hosted'
              ? `The result comes here when it's back. If you closed ${provider}'s page before the end, start a new check.`
              : "The result comes here when it's back."
          }
        />
      </ObScreen>
    );
  }

  if (identity.status === 'review') {
    return (
      <ObScreen footer={<Button label="Continue" onPress={leave} />}>
        <Question
          title="We're checking your ID"
          sub={`A person on our team looks at your check, usually within ${identity.reviewHours} hours. We'll text you.`}
        />
        <Checks identity={identity} />
        <Text variant="note" tone="ink3">
          Meanwhile you can look around. Adding money and requesting errands open once you're approved.
        </Text>
      </ObScreen>
    );
  }

  // Failed, or declined by our team.
  const declined = identity.status === 'declined';
  return (
    <ObScreen
      onBack={leave}
      footer={
        <View style={{ gap: 8 }}>
          {declined ? null : <Button label="Try again" onPress={again} loading={busy} />}
          <Button kind={declined ? 'primary' : 'plain'} label={declined ? 'Continue' : 'Later'} onPress={leave} />
        </View>
      }
    >
      <Question
        title="We couldn't verify your ID"
        sub={
          declined
            ? (identity.decisionNote ?? 'Our team could not verify your ID. Contact support to talk it through.')
            : 'Check the number and try again, in good light, facing the camera.'
        }
      />
      {declined ? null : <Checks identity={identity} />}
    </ObScreen>
  );
}

/** The checks that didn't pass, in words. */
function Checks({
  identity,
}: {
  identity: { checks: Array<{ key: string; outcome: string; note?: string; label: string }> };
}) {
  const open = identity.checks.filter((c) => c.outcome !== 'passed');
  if (!open.length) return null;
  return (
    <List>
      {open.map((c) => (
        <Row
          key={c.key}
          icon={c.outcome === 'failed' ? 'x' : 'clock'}
          title={c.label}
          subtitle={c.note ?? (c.outcome === 'failed' ? "Didn't match" : 'Our team looks at it')}
          subtitleLines={2}
        />
      ))}
    </List>
  );
}
