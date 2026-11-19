import { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/nav';
import { ApiError, errorMessage } from '@/api/client';
import { useResource } from '@/api/useResource';
import { useSession } from '@/auth/session';
import {
  canSign,
  canUseBiometrics,
  forgetPin,
  moneyRequest,
  rememberPin,
  setUpPhone,
  type SecurityStatus,
} from '@/auth/device-security';
import { moneyErrorMessage } from '@/auth/use-money-action';
import { space } from '@/theme/tokens';
import { Button, Field, Screen, Text } from '@/ui/kit';
import { Chip, Row } from '@/ui/parts';

const digits = (t: string) => t.replace(/\D/g, '').slice(0, 4);

/**
 * The app PIN that withdrawals and bank changes need (docs/security-plan.md, A7): create it, change it with
 * the current one, or set a new one just after signing in again when it's forgotten or locked.
 */
export default function PinScreen() {
  const { api, signOut } = useSession();
  const { next, reset } = useLocalSearchParams<{ next?: string; reset?: string }>();
  const status = useResource<SecurityStatus>('/v1/me/security');
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [biometrics, setBiometrics] = useState(canUseBiometrics());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signInAgain, setSignInAgain] = useState(false);
  // Changing needs the current PIN; a forgotten or locked one is set again after a fresh sign-in.
  const changing = !!status.data?.hasPin && !status.data.pinLocked && !reset;

  const save = async () => {
    setError(null);
    if (pin !== again) return setError("The two PINs don't match");
    if (!canSign()) return setError('This needs the Jiffo Agent app from the App Store or Google Play.');
    setBusy(true);
    try {
      if (!status.data?.deviceKey && (await setUpPhone(api)) === 'sign_in_again') {
        setSignInAgain(true);
        return;
      }
      const res = await moneyRequest<{ withdrawalsHeldUntil: string | null }>(
        api,
        'PUT',
        '/v1/me/pin',
        changing ? { pin, currentPin: current } : { pin },
        '',
      );
      if (biometrics) await rememberPin(pin);
      else await forgetPin();
      if (res.withdrawalsHeldUntil) {
        const message =
          'For your safety, withdrawals are paused for 48 hours after a PIN change. You can keep working as usual.';
        if (Platform.OS === 'web') window.alert(message);
        else Alert.alert('PIN changed', message);
      }
      if (next) router.replace(next as never);
      else goBack();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'sign_in_again') setSignInAgain(true);
      else setError(moneyErrorMessage(e, errorMessage));
    } finally {
      setBusy(false);
    }
  };

  if (signInAgain) {
    return (
      <Screen footer={<Button label="Sign out" onPress={() => void signOut()} />}>
        <Text variant="title">Sign in again to set a new PIN</Text>
        <Text tone="ink2">
          For your safety, a forgotten or locked PIN is set again only just after signing in on this phone. Sign out,
          sign in with the code we text you, then set your new PIN straight away. Withdrawals pause for 48 hours after.
        </Text>
      </Screen>
    );
  }

  const ready = pin.length === 4 && again.length === 4 && (!changing || current.length === 4);
  return (
    <Screen footer={<Button label="Save PIN" onPress={save} disabled={!ready} loading={busy} />}>
      <Text variant="title">
        {changing ? 'Change your app PIN' : status.data?.hasPin ? 'Set a new app PIN' : 'Create your app PIN'}
      </Text>
      <Text tone="ink2">
        You enter it to withdraw or change your bank account. Choose 4 digits that are hard to guess, and never share
        them.
      </Text>
      <View style={{ gap: space.md }}>
        {changing ? (
          <Field
            label="Current PIN"
            value={current}
            onChangeText={(t) => setCurrent(digits(t))}
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
          />
        ) : null}
        <Field
          label="New PIN"
          value={pin}
          onChangeText={(t) => setPin(digits(t))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
        />
        <Field
          label="New PIN again"
          value={again}
          onChangeText={(t) => setAgain(digits(t))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
          error={error}
        />
      </View>
      {canUseBiometrics() ? (
        <Row
          icon="lock"
          title="Use fingerprint or face"
          subtitle="Instead of typing your PIN on this phone"
          right={
            <Chip label={biometrics ? 'On' : 'Off'} selected={biometrics} onPress={() => setBiometrics((on) => !on)} />
          }
        />
      ) : null}
      {status.data?.hasPin && changing ? (
        <Button label="Forgot your PIN?" kind="plain" onPress={() => router.setParams({ reset: '1' })} />
      ) : null}
    </Screen>
  );
}
