import { useState } from 'react';
import { router } from 'expo-router';
import { useSession } from '@/auth/session';
import { VARIANT } from '@/config';
import { ApiError } from '@/api/client';
import { Button, Field, Screen, Text } from '@/ui/kit';

export default function Name() {
  const { updateProfile, user } = useSession();
  const [first, setFirst] = useState(user?.firstName ?? '');
  const [last, setLast] = useState(user?.lastName ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = first.trim().length > 0 && last.trim().length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateProfile({ firstName: first.trim(), lastName: last.trim() });
      router.replace('/home');
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button label="Continue" onPress={save} disabled={!ready} loading={busy} />}>
      <Text variant="title">What's your name?</Text>
      <Text tone="ink2">
        {VARIANT === 'agent'
          ? 'Use the name on your ID and bank account. Payouts only go to an account in this name.'
          : 'Agents see your first name when they take your errand.'}
      </Text>
      <Field
        label="First name"
        value={first}
        onChangeText={setFirst}
        autoComplete="given-name"
        textContentType="givenName"
        autoFocus
      />
      <Field
        label="Last name"
        value={last}
        onChangeText={setLast}
        autoComplete="family-name"
        textContentType="familyName"
        error={error}
        onSubmitEditing={() => ready && save()}
      />
    </Screen>
  );
}
