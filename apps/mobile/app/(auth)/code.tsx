import { useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/auth/session';
import { ApiError, errorMessage } from '@/api/client';
import { formatE164 } from '@/auth/phone';
import { Button, Field, Screen, Text } from '@/ui/kit';

/** 75 → "1:15". */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export default function Code() {
  const {
    phone = '',
    prefix = '',
    resend = '60',
  } = useLocalSearchParams<{ phone: string; prefix: string; resend: string }>();
  const { verifyCode, requestCode } = useSession();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(Number(resend) || 60);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [left]);

  async function verify(value: string) {
    setBusy(true);
    setError(null);
    try {
      const user = await verifyCode(phone, value);
      router.replace(user.firstName ? '/home' : '/name');
    } catch (e) {
      const err = e as ApiError;
      const attemptsLeft = err.details.attemptsLeft;
      setError(
        typeof attemptsLeft === 'number' && attemptsLeft > 0
          ? `${err.message}. ${attemptsLeft} tries left.`
          : err.message,
      );
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  async function sendAgain() {
    setError(null);
    try {
      const sent = await requestCode(phone);
      setLeft(sent.resendInSeconds);
    } catch (e) {
      if (e instanceof ApiError && typeof e.details.retryAfterSeconds === 'number')
        setLeft(e.details.retryAfterSeconds);
      setError(errorMessage(e));
    }
  }

  return (
    <Screen
      footer={
        <Button
          kind="secondary"
          label={left > 0 ? `Resend code in ${clock(left)}` : 'Resend code'}
          disabled={left > 0 || busy}
          onPress={sendAgain}
        />
      }
    >
      <Text variant="title">Enter the 6-digit code</Text>
      <Text tone="ink2">
        Sent by text to {formatE164(phone, prefix)}.{' '}
        <Text tone="brand" variant="label" onPress={() => router.back()} accessibilityRole="link">
          Change number
        </Text>
      </Text>
      <Field
        label="6-digit code"
        value={code}
        onChangeText={(t) => {
          const digits = t.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (digits.length === 6) verify(digits);
        }}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        editable={!busy}
        error={error}
        style={{ letterSpacing: 8, fontSize: 24 }}
      />
      {busy ? (
        <Text tone="ink3" accessibilityLiveRegion="polite">
          Checking the code…
        </Text>
      ) : null}
    </Screen>
  );
}
