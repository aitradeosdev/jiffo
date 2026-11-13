import { useEffect, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { Platform, View } from 'react-native';
import type { IdType } from '@jiffo/shared';
import { useSession } from '../auth/session';
import { errorMessage } from '../api/client';
import { FieldGroup, Point, Waiting } from '../agent/apply-parts';
import { Button, Text } from '../ui/kit';
import { ObScreen, Question, TextBox } from '../ui/onboarding';
import { List, Row } from '../ui/parts';
import { ID_COPY, cleanIdNumber, idNumberOk, maskIdNumber } from './ids';
import { ProviderSdk } from './sdk';

/** What the API says a new check can be, for the person's app. */
export interface IdentityOptions {
  idTypes: Array<{ key: IdType; name: string }>;
  /** An agent's BVN is checked as well. */
  withBvn: boolean;
  flow: 'numbers' | 'hosted';
  /** The person picks their ID on the provider's page. */
  idChosenOnPage: boolean;
  /** The provider's name, when one is switched on. */
  provider: string | null;
}

/** The finish call's answer: done once the result is back (agents say done, customers their new status). */
export interface FinishResult {
  status: string;
  outcome?: 'passed' | 'failed' | 'review' | null;
}
const finished = (r: FinishResult) => r.status !== 'pending' && r.status !== 'checking';

type Phase = 'choose' | 'number' | 'bvn' | 'intro' | 'sdk' | 'away' | 'finishing';
interface Started {
  sdkToken: string | null;
  url: string | null;
  provider: string;
}

/** How often, and how many times, the app asks for the result after the provider's screens. */
const FINISH_EVERY_MS = 2_000;
const FINISH_TRIES = 10;
/** A provider's own page sends the result to the API on its own, which can take a little longer. */
const HOSTED_FINISH_TRIES = 30;

export interface IdentityCheckProps {
  options: IdentityOptions;
  /** Where the check starts and finishes, for this app. */
  paths: { start: string; finish: string };
  /** Where the provider's page sends the person back to (the app's scheme). */
  returnUrl: string;
  /** Under the question about which ID: why everyone is checked. */
  why: string;
  /** Progress for the sign-up bar, when the check is part of one. */
  progress?: number;
  /** Ask for the result of a check already started, rather than starting one. */
  resume?: { hosted: boolean };
  onBack: () => void;
  /** The result, or 'pending' when it isn't back after asking a while. */
  onFinished: (result: FinishResult | 'pending') => void;
}

/**
 * An identity check, the same in both apps: the person picks one of the IDs on offer, gives its number
 * (and an agent's BVN when it is checked as well), and takes the provider's selfie; or, with a provider that
 * has its own page, the app opens that page. The numbers go to the API, which passes them to the provider
 * and keeps neither.
 */
export function IdentityCheck(props: IdentityCheckProps) {
  const { api } = useSession();
  const { options } = props;
  const only = options.idTypes.length === 1 ? options.idTypes[0]!.key : null;
  const first: Phase = options.idChosenOnPage || only ? (options.flow === 'hosted' ? 'intro' : 'number') : 'choose';
  const [phase, setPhase] = useState<Phase>(props.resume ? 'finishing' : first);
  const [idType, setIdType] = useState<IdType | null>(only ?? options.idTypes[0]?.key ?? null);
  const [idNumber, setIdNumber] = useState('');
  const [bvn, setBvn] = useState('');
  const [started, setStarted] = useState<Started | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const provider = options.provider ?? 'our identity provider';
  const hosted = started ? started.url !== null : (props.resume?.hosted ?? options.flow === 'hosted');
  const needsBvn = options.withBvn && idType !== 'bvn';

  const finish = async () => {
    setPhase('finishing');
    setError(null);
    try {
      const tries = hosted ? HOSTED_FINISH_TRIES : FINISH_TRIES;
      for (let i = 0; i < tries && mounted.current; i += 1) {
        const result = await api.post<FinishResult>(props.paths.finish);
        if (finished(result)) {
          if (mounted.current) props.onFinished(result);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, FINISH_EVERY_MS));
      }
      if (mounted.current) props.onFinished('pending');
    } catch (e) {
      if (!mounted.current) return;
      setError(errorMessage(e));
      setPhase(hosted && started?.url ? 'away' : first);
    }
  };

  // Opened again for a check already running: ask for its result at once (only on opening).
  useEffect(() => {
    if (props.resume) void finish();
  }, []);

  /**
   * Opens the provider's page. On a phone it closes by itself when the page sends the person back, and the
   * result is asked for at once. Closed before that, or on the web, the person says when they are done.
   */
  const visit = async (url: string) => {
    if (Platform.OS === 'web') {
      await WebBrowser.openBrowserAsync(url);
      setPhase('away');
      return;
    }
    const result = await WebBrowser.openAuthSessionAsync(url, props.returnUrl);
    if (!mounted.current) return;
    if (result.type === 'success') void finish();
    else setPhase('away');
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const body =
        options.flow === 'hosted'
          ? { idType, consent: true }
          : { idType, idNumber, ...(needsBvn ? { bvn } : {}), consent: true };
      const result = await api.post<Started>(props.paths.start, body);
      setStarted(result);
      if (result.url) await visit(result.url);
      else setPhase('sdk');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const problem = error ? (
    <Text tone="danger" accessibilityLiveRegion="polite">
      {error}
    </Text>
  ) : null;

  if (!options.idTypes.length) {
    return (
      <ObScreen onBack={props.onBack} footer={<Button label="Go back" onPress={props.onBack} />}>
        <Question
          title="ID checks aren't available yet"
          sub="We can't check the IDs we accept right now. We'll text you when we can."
        />
      </ObScreen>
    );
  }

  if (phase === 'sdk' && started?.sdkToken) {
    return (
      <ProviderSdk
        provider={started.provider}
        providerLabel={provider}
        sdkToken={started.sdkToken}
        bvnMasked={needsBvn ? maskIdNumber(bvn) : undefined}
        onDone={finish}
        onCancel={() => setPhase(needsBvn ? 'bvn' : 'number')}
      />
    );
  }

  if (phase === 'finishing') {
    return (
      <ObScreen progress={props.progress}>
        <Question title="Checking your identity" sub={`${capitalised(provider)} is matching your selfie to your ID.`} />
        <Waiting busy title="Usually a few seconds" sub="Keep the app open" />
      </ObScreen>
    );
  }

  if (phase === 'away' && started?.url) {
    const url = started.url;
    return (
      <ObScreen
        onBack={() => setPhase(first)}
        progress={props.progress}
        footer={
          <View style={{ gap: 8 }}>
            <Button label="I've finished" onPress={finish} />
            <Button kind="secondary" label={`Open ${provider}'s page again`} onPress={() => visit(url)} />
          </View>
        }
      >
        <Question
          title={`Finish on ${provider}'s page`}
          sub="It asks for your ID and takes a selfie. Come back here when it says you're done."
        />
        {problem}
      </ObScreen>
    );
  }

  if (phase === 'choose') {
    return (
      <ObScreen onBack={props.onBack} progress={props.progress}>
        <Question title="Which ID will you use?" sub={props.why} />
        <List>
          {options.idTypes.map((t) => (
            <Row
              key={t.key}
              icon={ID_COPY[t.key].icon}
              title={t.name}
              subtitle={ID_COPY[t.key].label}
              onPress={() => {
                setIdType(t.key);
                setIdNumber('');
                setError(null);
                setPhase(options.flow === 'hosted' ? 'intro' : 'number');
              }}
            />
          ))}
        </List>
      </ObScreen>
    );
  }

  const backToStart = only || options.idChosenOnPage ? props.onBack : () => setPhase('choose');

  if (phase === 'intro' || !idType) {
    const chosen = idType && !options.idChosenOnPage ? ID_COPY[idType].short : 'ID';
    return (
      <ObScreen
        onBack={backToStart}
        progress={props.progress}
        footer={<Button label="Continue" onPress={start} loading={busy} />}
      >
        <Question
          title="Check your identity"
          sub={`${capitalised(provider)} asks for your ${chosen}${needsBvn ? ' and BVN' : ''} and takes a selfie on its own page.`}
        />
        <Reassurance provider={provider} />
        <Text variant="note" tone="ink3">
          By continuing you agree to {provider} checking your {chosen} with the issuer
          {needsBvn ? ' and your BVN with NIBSS' : ''}, and taking a selfie to match your ID photo.
        </Text>
        {problem}
      </ObScreen>
    );
  }

  const copy = ID_COPY[idType];
  if (phase === 'bvn') {
    return (
      <ObScreen
        onBack={() => setPhase('number')}
        progress={props.progress}
        footer={<Button label="Continue" onPress={start} disabled={!idNumberOk('bvn', bvn)} loading={busy} />}
      >
        <Question title="Your BVN" sub="It confirms the payout account is yours. We can't move money with it." />
        <FieldGroup label={ID_COPY.bvn.label} note={ID_COPY.bvn.hint}>
          <TextBox
            accessibilityLabel={ID_COPY.bvn.label}
            placeholder={ID_COPY.bvn.placeholder}
            inputMode="numeric"
            keyboardType="number-pad"
            value={bvn}
            onChangeText={(t) => setBvn(cleanIdNumber('bvn', t))}
            autoFocus
          />
        </FieldGroup>
        <Reassurance provider={provider} />
        <Consent provider={provider} idShort={copy.short} withBvn />
        {problem}
      </ObScreen>
    );
  }

  return (
    <ObScreen
      onBack={backToStart}
      progress={props.progress}
      footer={
        <Button
          label="Continue"
          onPress={needsBvn ? () => setPhase('bvn') : start}
          disabled={!idNumberOk(idType, idNumber)}
          loading={busy}
        />
      }
    >
      <Question
        title={`Your ${copy.short}`}
        sub="Then a quick selfie, matched to the photo the issuer holds. You must be 18 or older."
      />
      <FieldGroup label={copy.label} note={copy.hint}>
        <TextBox
          accessibilityLabel={copy.label}
          placeholder={copy.placeholder}
          inputMode={copy.digits ? 'numeric' : 'text'}
          keyboardType={copy.digits ? 'number-pad' : 'default'}
          autoCapitalize="characters"
          value={idNumber}
          onChangeText={(t) => setIdNumber(cleanIdNumber(idType, t))}
          autoFocus
        />
      </FieldGroup>
      <Reassurance provider={provider} />
      {needsBvn ? null : <Consent provider={provider} idShort={copy.short} />}
      {problem}
    </ObScreen>
  );
}

const capitalised = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Consent({ provider, idShort, withBvn }: { provider: string; idShort: string; withBvn?: boolean }) {
  return (
    <Text variant="note" tone="ink3">
      By continuing you agree to {provider} checking your {idShort} with the issuer
      {withBvn ? ' and your BVN with NIBSS' : ''}, and taking a selfie to match your ID photo.
    </Text>
  );
}

export function Reassurance({ provider }: { provider: string }) {
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
