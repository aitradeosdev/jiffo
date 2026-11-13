import { useState } from 'react';
import { router } from 'expo-router';
import { useSession } from '@/auth/session';
import { useCountryConfig } from '@/api/useCountryConfig';
import { formatNational, nationalDigits, plausibleNumber, toE164 } from '@/auth/phone';
import { ApiError, errorMessage } from '@/api/client';
import { StyleSheet, View } from 'react-native';
import { COUNTRY } from '@/config';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Button, Text } from '@/ui/kit';
import { Flag, ObScreen, Question, TextBox } from '@/ui/onboarding';

export default function Phone() {
  const c = useColors();
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
    <ObScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
      progress={0.25}
      footer={<Button label="Continue" onPress={send} disabled={!ready} loading={busy} />}
    >
      <Question
        title="What's your phone number?"
        sub="We'll text you a 6-digit code to check it's yours. Standard rates may apply."
      />
      <View style={styles.row}>
        <View style={[styles.ccode, { backgroundColor: c.surface2 }]}>
          <Flag country={COUNTRY} />
          <Text style={styles.ccText}>{prefix ?? '…'}</Text>
        </View>
        <TextBox
          accessibilityLabel="Phone number"
          style={{ flex: 1 }}
          invalid={!!error}
          value={formatNational(digits)}
          onChangeText={(t) => setDigits(nationalDigits(t, prefix ?? ''))}
          keyboardType="phone-pad"
          autoComplete="tel"
          textContentType="telephoneNumber"
          placeholder="803 123 4567"
          autoFocus
          onSubmitEditing={() => ready && send()}
        />
      </View>
      {(error ?? (prefix ? null : configError)) ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error ?? configError}
        </Text>
      ) : null}
    </ObScreen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8 },
  ccode: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 54, paddingHorizontal: 12, borderRadius: 10 },
  ccText: { fontFamily: fonts.semibold, fontSize: 16 },
});
