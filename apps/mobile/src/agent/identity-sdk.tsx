import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { fonts } from '../theme/tokens';
import { Button, Text } from '../ui/kit';
import { ObScreen, Question } from '../ui/onboarding';
import { Icon } from '../ui/parts';
import { Confirmed, Point, Waiting } from './apply-parts';

export interface ProviderSdkProps {
  /** The adapter's name, as the API gives it when the check starts. */
  provider: string;
  /** The provider's name for people, when admin has set one. */
  providerLabel: string;
  sdkToken: string;
  /** The BVN, masked, for the approval screen. */
  bvnMasked: string;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * The part of the identity check the provider runs in the app: the BVN approval with NIBSS and the selfie
 * with a liveness check. The provider's SDK takes the selfie and sends it to the provider; Jiffo never sees
 * it. Each provider's SDK is added here with its adapter on the server.
 */
export function ProviderSdk(props: ProviderSdkProps) {
  if (props.provider === 'fake') return <TestProviderSdk {...props} />;
  return (
    <ObScreen onBack={props.onCancel} footer={<Button label="Back to your application" onPress={props.onCancel} />}>
      <Question
        title="Update Jiffo Agent"
        sub={`This version of the app can't run ${props.providerLabel}'s checks. Update the app, then try again.`}
      />
    </ObScreen>
  );
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * For development and tests: the screens the provider's SDK shows, with nothing sent anywhere. No camera is
 * opened and no photo is taken; the API's test provider decides the results from the NIN.
 */
function TestProviderSdk({ bvnMasked, onDone, onCancel }: ProviderSdkProps) {
  const [step, setStep] = useState<'consent' | 'selfie'>('consent');
  return step === 'consent' ? (
    <ConsentStep bvnMasked={bvnMasked} onBack={onCancel} onApproved={() => setStep('selfie')} />
  ) : (
    <SelfieStep onBack={() => setStep('consent')} onDone={onDone} />
  );
}

function useMounted() {
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  return mounted;
}

function ConsentStep({
  bvnMasked,
  onBack,
  onApproved,
}: {
  bvnMasked: string;
  onBack: () => void;
  onApproved: () => void;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok'>('idle');
  const mounted = useMounted();
  const approve = async () => {
    setState('busy');
    await wait(1300);
    if (!mounted.current) return;
    setState('ok');
    await wait(700);
    if (mounted.current) onApproved();
  };
  return (
    <ObScreen
      onBack={state === 'idle' ? onBack : undefined}
      footer={
        <Button
          label={state === 'ok' ? 'Approved' : state === 'busy' ? 'Waiting for NIBSS…' : 'Approve with NIBSS'}
          onPress={approve}
          disabled={state !== 'idle'}
        />
      }
    >
      <Question
        title="Approve the BVN check"
        sub="NIBSS asks you to approve every BVN check. You'll get a code by text on the phone number linked to your BVN."
      />
      <View>
        <Point icon="bank" title={`BVN ${bvnMasked}`} sub="Checked through NIBSS" />
        <Point
          icon="eyeoff"
          title="Read once, not kept"
          sub="We keep only whether it matched your name and date of birth"
        />
      </View>
      {state === 'busy' ? (
        <Waiting busy title="Enter the NIBSS code" sub="In the NIBSS iGree screen that opened" />
      ) : null}
      {state === 'ok' ? <Confirmed title="Approved on NIBSS" sub="Continuing to your selfie" /> : null}
    </ObScreen>
  );
}

const GREEN = '#3DD68C';

/** .facecam.sdk: the provider's selfie screen, black, with the face oval and the shutter. */
function SelfieStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [state, setState] = useState<'idle' | 'checking' | 'ok'>('idle');
  const mounted = useMounted();
  const shoot = async () => {
    setState('checking');
    await wait(1500);
    if (!mounted.current) return;
    setState('ok');
    await wait(800);
    if (mounted.current) onDone();
  };
  const title =
    state === 'ok' ? 'Selfie matched' : state === 'checking' ? 'Blink, then turn your head slowly' : 'Take a selfie';
  const sub =
    state === 'idle'
      ? 'Fit your face in the oval. You will be asked to blink and turn your head.'
      : state === 'checking'
        ? 'Checking it is really you, then matching to your ID photo.'
        : 'Your selfie matches your ID photo.';
  return (
    <SafeAreaView style={styles.cam} edges={['top', 'bottom']}>
      <View style={styles.camHead}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={onBack}
          disabled={state !== 'idle'}
          style={[styles.ib, state !== 'idle' && { opacity: 0.4 }]}
        >
          <Icon name="back" size={24} color="#FFFFFF" />
        </Pressable>
        <View style={styles.badge}>
          <Icon name="shield" size={13} color="#D9D9D9" />
          <Text style={styles.badgeText}>Test provider</Text>
        </View>
      </View>
      <View style={{ alignItems: 'center', gap: 8 }} accessibilityLiveRegion="polite">
        <Text style={styles.camTitle} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.camSub}>{sub}</Text>
      </View>
      <View style={[styles.oval, state === 'ok' && { borderStyle: 'solid', borderColor: GREEN }]}>
        <Icon name="face" size={56} weight={1.4} color="#FFFFFF" />
      </View>
      <View style={styles.bottom}>
        {state === 'idle' ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Take selfie" onPress={shoot} style={styles.shutter}>
            <View style={styles.shutterDot} />
          </Pressable>
        ) : state === 'checking' ? (
          <ActivityIndicator color="#FFFFFF" accessibilityLabel="Checking" />
        ) : (
          <View style={styles.okDot}>
            <Icon name="check" size={30} weight={3} color="#03140A" />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cam: {
    flex: 1,
    backgroundColor: '#0B0F0D',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 32,
  },
  camHead: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingRight: 16,
  },
  ib: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  badgeText: { color: '#D9D9D9', fontSize: 12, fontFamily: fonts.semibold },
  camTitle: { color: '#FFFFFF', fontFamily: fonts.bold, fontSize: 22, lineHeight: 27, textAlign: 'center' },
  camSub: { color: '#BDBDBD', fontSize: 14.5, lineHeight: 20, maxWidth: 300, textAlign: 'center' },
  oval: {
    width: 232,
    height: 300,
    borderRadius: 150,
    borderWidth: 3,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: { height: 76, alignItems: 'center', justifyContent: 'center' },
  shutter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterDot: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFFFFF' },
  okDot: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
