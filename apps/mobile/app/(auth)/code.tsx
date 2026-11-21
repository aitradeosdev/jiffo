import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { wholeNumber } from '@/links';
import { useSession } from '@/auth/session';
import { ApiError, errorMessage } from '@/api/client';
import { formatE164 } from '@/auth/phone';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { noWebOutline, Text } from '@/ui/kit';
import { List, Row } from '@/ui/parts';
import { ObScreen, Question } from '@/ui/onboarding';
import { NEVER_ASK } from '@/safety/never-ask';

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
  const { verifyCode, requestCode, testCodeFor } = useSession();
  // Where sign-in codes are in Test, no text was sent: the code is shown at the bottom instead.
  const testCode = testCodeFor(phone);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [left, setLeft] = useState(wholeNumber(resend, { max: 3600 }) ?? 60);

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
      // The input was read-only while checking, which closes the keyboard: bring it back to retry.
      setTimeout(() => input.current?.focus(), 50);
    } finally {
      setBusy(false);
    }
  }

  /** Back to the number, even when this screen was opened directly (a reload on the web). */
  function changeNumber() {
    if (router.canGoBack()) router.back();
    else router.replace('/phone');
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

  // Pinned to the bottom, above the keyboard, so it's in view while the code is typed.
  const testBox = testCode ? (
    <View style={[styles.test, { backgroundColor: c.surface2 }]} accessibilityLiveRegion="polite">
      <Text variant="small" tone="ink3">
        Test mode: no text was sent. Your code is
      </Text>
      <Text style={styles.testCode} accessibilityLabel={`Your code is ${testCode.split('').join(' ')}`}>
        {testCode}
      </Text>
      <Text
        variant="sub"
        style={{ fontFamily: fonts.bold, textDecorationLine: 'underline' }}
        onPress={() => {
          if (busy) return;
          setCode(testCode);
          void verify(testCode);
        }}
        accessibilityRole="button"
      >
        Use this code
      </Text>
    </View>
  ) : null;

  return (
    <ObScreen onBack={changeNumber} progress={0.5} footer={testBox}>
      <Question
        title="Enter the 6-digit code"
        sub={
          <>
            {testCode ? 'For' : 'Sent by text to'} {formatE164(phone, prefix)}.{' '}
            <Text
              variant="sub"
              style={{ fontFamily: fonts.bold, textDecorationLine: 'underline' }}
              onPress={changeNumber}
              accessibilityRole="link"
            >
              Change number
            </Text>
          </>
        }
      />
      {/*
        One real input laid over the six boxes: it takes taps, paste, the phone's code autofill and the
        screen reader, while the boxes underneath only draw the digits.
      */}
      <View>
        <View style={styles.otp} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
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
          style={[StyleSheet.absoluteFill, styles.overlay, noWebOutline]}
        />
      </View>
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
      <Text variant="small" tone="ink3">
        {NEVER_ASK.code}
      </Text>
      <List>
        <Row
          icon="history"
          title={testCode ? 'Get a new code' : 'Resend code by text'}
          subtitle={left > 0 ? `Available in ${clock(left)}` : 'Send a new code now'}
          onPress={sendAgain}
          disabled={left > 0 || busy}
        />
      </List>
    </ObScreen>
  );
}

const styles = StyleSheet.create({
  otp: { flexDirection: 'row', gap: 8 },
  cell: { flex: 1, height: 60, borderRadius: 10, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  digit: { fontFamily: fonts.extrabold, fontSize: 26, fontVariant: ['tabular-nums'] },
  test: { borderRadius: 12, padding: 14, gap: 4, alignItems: 'center' },
  testCode: { fontFamily: fonts.extrabold, fontSize: 24, letterSpacing: 4, fontVariant: ['tabular-nums'] },
  // Over the boxes, there for taps and screen readers, with its own text and caret invisible.
  overlay: { color: 'transparent', backgroundColor: 'transparent', fontSize: 16 },
});
