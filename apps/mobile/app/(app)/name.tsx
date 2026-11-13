import { useState } from 'react';
import { router } from 'expo-router';
import { useSession } from '@/auth/session';
import { VARIANT } from '@/config';
import { errorMessage } from '@/api/client';
import { StyleSheet, View } from 'react-native';
import { Button, Text } from '@/ui/kit';
import { ObScreen, Question, TextBox } from '@/ui/onboarding';

export default function Name() {
  const { updateProfile, user } = useSession();
  const [first, setFirst] = useState(user?.firstName ?? '');
  const [last, setLast] = useState(user?.lastName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const emailOk = email.trim() === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = first.trim().length > 0 && last.trim().length > 0 && emailOk;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateProfile({
        firstName: first.trim(),
        lastName: last.trim(),
        // Clearing a saved email removes it.
        ...(email.trim() ? { email: email.trim() } : user?.email ? { email: null } : {}),
      });
      router.replace('/home');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ObScreen progress={0.75} footer={<Button label="Continue" onPress={save} disabled={!ready} loading={busy} />}>
      <Question
        title="What's your name?"
        sub={
          VARIANT === 'agent'
            ? 'Use the name on your ID and bank account. Payouts only go to an account in this name.'
            : 'Agents see your first name when they take your errand.'
        }
      />
      <View style={styles.pair}>
        <TextBox
          accessibilityLabel="First name"
          style={{ flex: 1 }}
          placeholder="First name"
          value={first}
          onChangeText={setFirst}
          autoComplete="given-name"
          textContentType="givenName"
          autoFocus
        />
        <TextBox
          accessibilityLabel="Last name"
          style={{ flex: 1 }}
          placeholder="Last name"
          value={last}
          onChangeText={setLast}
          autoComplete="family-name"
          textContentType="familyName"
        />
      </View>
      <View style={{ gap: 6 }}>
        <Text variant="small" tone="ink3">
          Email (optional)
        </Text>
        <TextBox
          accessibilityLabel="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
          onSubmitEditing={() => ready && save()}
          invalid={!emailOk}
        />
        <Text variant="note" tone={emailOk ? 'ink3' : 'danger'} accessibilityLiveRegion="polite">
          {emailOk
            ? 'For receipts. No marketing unless you ask for it.'
            : 'Check the email address, or leave it empty.'}
        </Text>
      </View>
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
    </ObScreen>
  );
}

const styles = StyleSheet.create({
  pair: { flexDirection: 'row', gap: 8 },
});
