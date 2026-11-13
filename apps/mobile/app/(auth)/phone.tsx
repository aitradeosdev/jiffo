import { useState } from 'react';
import { router } from 'expo-router';
import { useSession } from '@/auth/session';
import { useCountryConfig } from '@/api/useCountryConfig';
import { formatNational, nationalDigits, plausibleNumber, toE164 } from '@/auth/phone';
import { ApiError, errorMessage } from '@/api/client';
import { Button, Field, Screen, Text } from '@/ui/kit';

export default function Phone() {
  const { requestCode } = useSession();
  const { config, error: configError } = useCountryConfig();
  const prefix = config?.country.phonePrefix;
  const [digits, setDigits] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ready = !!prefix && plausibleNumber(digits);

  async function send() {
    if (!prefix) return;
    setBusy(true);
    setError(null);
    const phone = toE164(prefix, digits);
    try {
      const sent = await requestCode(phone);
      router.push({ pathname: '/code', params: { phone: sent.phone, prefix, resend: String(sent.resendInSeconds) } });
    } catch (e) {
      // A code was sent moments ago: go and enter it rather than stopping here.
      if (e instanceof ApiError && e.code === 'otp_resend_wait') {
        router.push({
          pathname: '/code',
          params: { phone, prefix, resend: String(e.details.retryAfterSeconds ?? 60) },
        });
      } else setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button label="Send code" onPress={send} disabled={!ready} loading={busy} />}>
      <Text variant="title">What's your number?</Text>
      <Field
        label="Phone number"
        prefix={prefix ?? '…'}
        value={formatNational(digits)}
        onChangeText={(t) => setDigits(nationalDigits(t, prefix ?? ''))}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        placeholder="803 123 4567"
        autoFocus
        error={error ?? (prefix ? null : configError)}
        onSubmitEditing={() => ready && send()}
      />
      <Text variant="small" tone="ink3">
        We'll text you a 6-digit code. Standard rates may apply.
      </Text>
    </Screen>
  );
}
