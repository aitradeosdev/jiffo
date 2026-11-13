import { useState } from 'react';
import { router } from 'expo-router';
import { useSession } from '@/auth/session';
import { formatNational, looksLikeMobile, nationalDigits, toE164 } from '@/auth/phone';
import { ApiError } from '@/api/client';
import { Button, Field, Screen, Text } from '@/ui/kit';

export default function Phone() {
  const { requestCode } = useSession();
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = looksLikeMobile(digits);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const sent = await requestCode(toE164(digits));
      router.push({ pathname: '/code', params: { phone: sent.phone, resend: String(sent.resendInSeconds) } });
    } catch (e) {
      const err = e as ApiError;
      // A code was sent moments ago: go and enter it rather than stopping here.
      if (err.code === 'otp_resend_wait') {
        router.push({
          pathname: '/code',
          params: { phone: toE164(digits), resend: String(err.details.retryAfterSeconds ?? 60) },
        });
      } else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button label="Send code" onPress={send} disabled={!ready} loading={busy} />}>
      <Text variant="title">What's your number?</Text>
      <Field
        label="Phone number"
        prefix="+234"
        value={formatNational(digits)}
        onChangeText={(t) => setDigits(nationalDigits(t))}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder="803 123 4567"
        autoFocus
        error={error}
        onSubmitEditing={() => ready && send()}
      />
      <Text variant="small" tone="ink3">
        We'll text you a 6-digit code. Standard rates may apply.
      </Text>
    </Screen>
  );
}
