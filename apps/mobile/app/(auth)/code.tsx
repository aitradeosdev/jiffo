import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/auth/session';
import { ApiError, errorMessage } from '@/api/client';
import { formatE164 } from '@/auth/phone';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { noWebOutline, Text } from '@/ui/kit';
import { List, Row } from '@/ui/parts';
import { ObScreen, Question } from '@/ui/onboarding';

/** 75 → "1:15". */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

export default function Code() {
  const c = useColors();
  const input = useRef<ComponentRef<typeof TextInput>>(null);
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
    <ObScreen onBack={() => router.back()} progress={0.5}>
      <Question
        title="Enter the 6-digit code"
        sub={
          <>
            Sent by text to {formatE164(phone, prefix)}.{' '}
            <Text
              variant="sub"
              style={{ fontFamily: fonts.bold, textDecorationLine: 'underline' }}
              onPress={() => router.back()}
              accessibilityRole="link"
            >
              Change number
            </Text>
          </>
        }
      />
      <Pressable
        onPress={() => input.current?.focus()}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={styles.otp}>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const on = i === Math.min(code.length, 5) && !busy;
            return (
              <View
                key={i}
                style={[
                  styles.cell,
                  { backgroundColor: on ? c.surface : c.surface2, borderColor: on ? c.ink : 'transparent' },
                ]}
              >
                <Text style={styles.digit}>{code[i] ?? ''}</Text>
              </View>
            );
          })}
        </View>
      </Pressable>
      {/* One real input under the boxes, so paste and the phone's code autofill work. */}
      <TextInput
        ref={input}
        accessibilityLabel="6-digit code"
        value={code}
        onChangeText={(t) => {
          const digits = t.replace(/\D/g, '').slice(0, 6);
          setCode(digits);
          if (digits.length === 6) void verify(digits);
        }}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        autoFocus
        editable={!busy}
        caretHidden
        style={[styles.hidden, noWebOutline]}
      />
      {busy ? (
        <Text tone="ink3" accessibilityLiveRegion="polite">
          Checking the code…
        </Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      <List>
        <Row
          icon="history"
          title="Resend code by text"
          subtitle={left > 0 ? `Available in ${clock(left)}` : 'Send a new code now'}
          onPress={left > 0 || busy ? undefined : sendAgain}
        />
      </List>
    </ObScreen>
  );
}

const styles = StyleSheet.create({
  otp: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, height: 60, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  digit: { fontFamily: fonts.extrabold, fontSize: 26, fontVariant: ['tabular-nums'] },
  // Kept on screen (not display: none) so it can take focus; too small to see.
  hidden: { position: 'absolute', width: 1, height: 1, opacity: 0 },
});
