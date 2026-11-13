import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { goBack } from '@/nav';
import * as Clipboard from 'expo-clipboard';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useCountryConfig } from '@/api/useCountryConfig';
import { naira, parseNaira } from '@/money';
import { useColors } from '@/theme/theme';
import { fonts, space } from '@/theme/tokens';
import { Button, Field, Screen, Text } from '@/ui/kit';
import { Chip, Icon } from '@/ui/parts';

interface Deposit {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  expired: boolean;
  amountKobo: number;
  paidKobo: number | null;
  accountNumber: string;
  accountName: string;
  bankName: string;
  expiresAt: string;
}

const PRESETS = [200_000, 500_000, 1_000_000, 2_000_000];
const POLL_MS = 8_000;

/** Add money: choose an amount, transfer it to a one-time account number, and wait for it to land. */
export default function TopUp() {
  const c = useColors();
  const { amount } = useLocalSearchParams<{ amount?: string }>();
  const { api } = useSession();
  const { config } = useCountryConfig();
  const min = config?.settings.wallet.minDepositKobo ?? 10_000;
  const max = config?.settings.wallet.maxDepositKobo ?? null;
  const suggested = amount ? Math.max(Number(amount), min) : null;
  const [text, setText] = useState(suggested ? String(Math.ceil(suggested / 100)) : '');
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const kobo = parseNaira(text);
  const valid = kobo !== null && kobo >= min && (max === null || kobo <= max);

  // While the account number is open, check every few seconds whether the transfer has landed.
  useEffect(() => {
    if (!deposit || deposit.status !== 'pending') return;
    const timer = setInterval(async () => {
      try {
        setDeposit(await api.get<Deposit>(`/v1/wallet/deposits/${deposit.id}`));
      } catch {
        // Keep showing the account number; the next check may get through.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [api, deposit]);

  const start = async () => {
    if (!kobo) return;
    setBusy(true);
    setError(null);
    try {
      setDeposit(await api.post<Deposit>('/v1/wallet/deposits', { amountKobo: kobo }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (deposit?.status === 'succeeded') {
    return (
      <Screen footer={<Button label="Done" onPress={() => goBack()} />}>
        <View style={styles.hero}>
          <View style={[styles.tick, { backgroundColor: c.brand2 }]}>
            <Icon name="check" size={36} weight={2.8} color={c.onBrand} />
          </View>
          <Text variant="title" accessibilityRole="header" accessibilityLiveRegion="polite">
            {naira(deposit.paidKobo ?? deposit.amountKobo)} received
          </Text>
          <Text variant="sub" tone="ink3" style={{ textAlign: 'center' }}>
            It&apos;s in your wallet and ready for your next errand.
          </Text>
        </View>
      </Screen>
    );
  }

  if (deposit) {
    const copy = async () => {
      await Clipboard.setStringAsync(deposit.accountNumber);
      setCopied(true);
    };
    const until = new Date(deposit.expiresAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    return (
      <Screen footer={<Button kind="secondary" label="I'll do it later" onPress={() => goBack()} />}>
        <View style={{ gap: 6 }}>
          <Text variant="heading" accessibilityRole="header" style={styles.h2}>
            Transfer {naira(deposit.amountKobo)}
          </Text>
          <Text variant="sub" tone="ink3">
            From any bank app, to this account number made for this top-up, so we know the money is from you.
          </Text>
        </View>
        <View style={[styles.acctbig, { backgroundColor: c.surface2 }]}>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            <Text style={[styles.acctSmall, { color: c.ink3 }]}>{deposit.bankName} · account number</Text>
            <Text
              style={styles.acctNumber}
              accessibilityLabel={`Account number ${deposit.accountNumber.split('').join(' ')}`}
            >
              {deposit.accountNumber.replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3')}
            </Text>
            <Text style={[styles.acctSmall, { color: c.ink3 }]}>{deposit.accountName}</Text>
          </View>
          <Button
            kind="secondary"
            small
            label={copied ? 'Copied' : 'Copy'}
            icon={<Icon name={copied ? 'check' : 'copy'} size={16} />}
            onPress={copy}
            style={{ backgroundColor: c.surface }}
          />
        </View>
        <View style={styles.steps}>
          {[
            `Open your bank app and send exactly ${naira(deposit.amountKobo)} to the account above.`,
            "It usually shows here within a minute. We'll update this screen when it lands.",
            deposit.expired
              ? 'This account number has expired. If you already sent the money, it will still reach your wallet.'
              : `This account number is for this top-up only, open until ${until}.`,
          ].map((line, i) => (
            <View key={i} style={styles.step}>
              <Text style={[styles.stepNum, { color: c.ink2 }]}>{i + 1}.</Text>
              <Text
                style={[styles.stepText, { color: i === 2 && deposit.expired ? c.danger : c.ink2 }]}
                accessibilityLiveRegion={i === 2 ? 'polite' : undefined}
              >
                {line}
              </Text>
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label="Get account number" onPress={start} disabled={!valid} loading={busy} />}>
      <View style={{ gap: 6 }}>
        <Text variant="heading" accessibilityRole="header" style={styles.h2}>
          {suggested ? `Add ${naira(suggested)} to continue` : 'Add money'}
        </Text>
        <Text variant="sub" tone="ink3">
          Pay by bank transfer from any bank app. Your balance is for errands only.
        </Text>
      </View>
      <Field
        label="Amount"
        prefix="₦"
        value={text}
        onChangeText={(t) => setText(t.replace(/[^\d.,]/g, ''))}
        keyboardType="decimal-pad"
        placeholder="5,000"
        autoFocus
        error={error ?? (text && !valid ? `Enter ${naira(min)} or more${max ? `, up to ${naira(max)}` : ''}` : null)}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {PRESETS.map((p) => (
          <Chip key={p} label={naira(p)} selected={kobo === p} onPress={() => setText(String(p / 100))} />
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  h2: { fontSize: 22, lineHeight: 26 },
  hero: { alignItems: 'center', gap: 10, paddingTop: 40 },
  tick: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  acctbig: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14 },
  acctSmall: { fontFamily: fonts.semibold, fontSize: 13 },
  acctNumber: {
    fontFamily: fonts.extrabold,
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: 0.9,
    fontVariant: ['tabular-nums'],
  },
  steps: { gap: 8, paddingLeft: 4 },
  step: { flexDirection: 'row', gap: 8 },
  stepNum: { fontSize: 14.5, lineHeight: 21, width: 16 },
  stepText: { flex: 1, fontSize: 14.5, lineHeight: 21 },
});
