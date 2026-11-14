import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { goBack } from '@/nav';
import * as Clipboard from 'expo-clipboard';
import * as Crypto from 'expo-crypto';
import { useSession } from '@/auth/session';
import { ApiError, errorMessage } from '@/api/client';
import { useCustomerIdentity } from '@/identity/customer';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useResource } from '@/api/useResource';
import { useRealtimeEvent } from '@/realtime/realtime';
import { naira, parseNaira } from '@/money';
import { timeLabel } from '@/errands/when';
import { useColors } from '@/theme/theme';
import { fonts, space } from '@/theme/tokens';
import { Button, Field, Screen, Text } from '@/ui/kit';
import { Chip, Icon, List, Row } from '@/ui/parts';

interface Deposit {
  id: string;
  status: 'pending' | 'succeeded' | 'failed';
  method: 'one_time' | 'fixed';
  expired: boolean;
  amountKobo: number;
  paidKobo: number | null;
  accountNumber: string;
  accountName: string;
  bankName: string;
  expiresAt: string | null;
  completedAt: string | null;
}

/** The customer's own account number at the payments provider. */
interface FixedAccount {
  id: string;
  status: 'pending' | 'active' | 'failed';
  accountNumber: string | null;
  accountName: string | null;
  bankName: string | null;
  failureReason: string | null;
}

/** The ways to add money on offer (see GET /v1/wallet/top-up). */
interface TopUpOptions {
  oneTimeAccount: boolean;
  fixedAccount: { available: boolean; needs: 'nothing' | 'bvn' | 'bvn_and_bank'; account: FixedAccount | null };
}

interface Bank {
  code: string;
  name: string;
}

const PRESETS = [200_000, 500_000, 1_000_000, 2_000_000];
const POLL_MS = 8_000;
/** The own number's screen hears of transfers live; this check is only in case an event is missed. */
const OWN_POLL_MS = 20_000;

/**
 * Add money, by bank transfer: to the customer's own account number when they have one (any amount, any
 * time), or to a one-time account number made for an amount. Which ways are on offer is admin's choice.
 */
export default function TopUp() {
  const c = useColors();
  const { amount } = useLocalSearchParams<{ amount?: string }>();
  const { api } = useSession();
  const { config } = useCountryConfig();
  const min = config?.settings.wallet.minDepositKobo ?? 10_000;
  const max = config?.settings.wallet.maxDepositKobo ?? null;
  // Whole naira, as in the amount field.
  const suggested = amount ? Math.ceil(Math.max(Number(amount), min) / 100) * 100 : null;
  const [text, setText] = useState(suggested ? String(suggested / 100) : '');
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Which number was copied, so another one on screen later never shows as copied.
  const [copied, setCopied] = useState<string | null>(null);
  const { identity, error: identityError } = useCustomerIdentity();
  const options = useResource<TopUpOptions>('/v1/wallet/top-up');
  // The one-time flow even though the customer has their own number, or the form to get one.
  const [mode, setMode] = useState<'auto' | 'one_time' | 'fixed_form'>('auto');
  const [received, setReceived] = useState<Deposit | null>(null);
  // Top-ups already there when the own number showed: any other that lands is new. Ids, not the time, so a
  // phone clock that is off doesn't matter.
  const known = useRef<Set<string> | null>(null);
  const kobo = parseNaira(text);
  // One key per amount: a repeated tap, or a retry after a lost answer, opens one top-up.
  const requestId = useMemo(() => Crypto.randomUUID(), [kobo]);
  const valid = kobo !== null && kobo >= min && (max === null || kobo <= max);
  const fixed = options.data?.fixedAccount;
  const own = fixed?.account ?? null;
  // Without the options (they couldn't be loaded), the one-time flow shows and the API still decides.
  const oneTime = options.data?.oneTimeAccount ?? true;
  const offered = !!fixed?.available && (!own || own.status === 'failed');

  const ownStatus = own?.status;
  const watching = !deposit && !received && mode === 'auto';
  const setOptions = options.setData;

  /** Looks for a transfer into the own number that landed since it showed. */
  const checkLanded = useCallback(async () => {
    const list = await api.get<Deposit[]>('/v1/wallet/deposits');
    if (!known.current) {
      known.current = new Set(list.map((d) => d.id));
      return;
    }
    const landed = list.find((d) => d.method === 'fixed' && d.status === 'succeeded' && !known.current!.has(d.id));
    if (landed) setReceived(landed);
  }, [api]);

  // While the own number is on screen, or being issued: what changed, from the live event, else a slower check.
  useEffect(() => {
    if (!watching || (ownStatus !== 'active' && ownStatus !== 'pending')) return;
    const check = async () => {
      try {
        if (ownStatus === 'pending') setOptions(await api.get<TopUpOptions>('/v1/wallet/top-up'));
        else await checkLanded();
      } catch {
        // The next check may get through.
      }
    };
    if (ownStatus === 'active' && !known.current) check();
    const timer = setInterval(check, ownStatus === 'pending' ? POLL_MS : OWN_POLL_MS);
    return () => clearInterval(timer);
  }, [api, watching, ownStatus, setOptions, checkLanded]);

  useRealtimeEvent<{ reason?: string; depositId?: string }>('wallet.updated', (event) => {
    // The own number is ready.
    if (event.reason === 'fixed_account') options.reloadSoon();
    // A top-up landed: the one-time one on screen, or a transfer into the own number.
    if (event.depositId && deposit?.id === event.depositId) {
      api.get<Deposit>(`/v1/wallet/deposits/${event.depositId}`).then(setDeposit, () => undefined);
    } else if (event.depositId && watching && ownStatus === 'active') {
      checkLanded().catch(() => undefined);
    }
  });

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
      setDeposit(await api.post<Deposit>('/v1/wallet/deposits', { amountKobo: kobo, requestId }));
    } catch (e) {
      // Money comes in only from verified customers: the check comes first.
      if (e instanceof ApiError && e.code === 'identity_required') {
        router.push('/verify');
        return;
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  // Money comes in only from verified customers: said before an amount is chosen. Until the check's status
  // is known nothing is asked (if it can't be loaded, the form shows and the API still says).
  if (!identity && !identityError && !deposit) {
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: 48 }} />
      </Screen>
    );
  }
  if (identity && identity.status !== 'verified' && !deposit) {
    const checking = identity.status === 'checking' || identity.status === 'review';
    return (
      <Screen
        footer={
          <Button label={checking ? 'See your check' : 'Verify your ID'} onPress={() => router.push('/verify')} />
        }
      >
        <View style={styles.hero}>
          <Icon name="verified" size={40} color={c.brand} />
          <Text variant="title" accessibilityRole="header">
            {checking ? "We're checking your ID" : 'Verify your ID first'}
          </Text>
          <Text variant="sub" tone="ink3" style={{ textAlign: 'center' }}>
            {checking
              ? 'You can add money once your ID is checked.'
              : 'Every customer is verified before adding money. It takes a couple of minutes.'}
          </Text>
        </View>
      </Screen>
    );
  }

  if (!options.data && options.loading && !deposit) {
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: 48 }} />
      </Screen>
    );
  }

  // A top-up landed: the one-time one, or a transfer into the own number.
  const landed = received ?? (deposit?.status === 'succeeded' ? deposit : null);
  if (landed) {
    return (
      <Screen footer={<Button label="Done" onPress={() => goBack()} />}>
        <View style={styles.hero}>
          <View style={[styles.tick, { backgroundColor: c.brand2 }]}>
            <Icon name="check" size={36} weight={2.8} color={c.onBrand} />
          </View>
          <Text variant="title" accessibilityRole="header" accessibilityLiveRegion="polite">
            {naira(landed.paidKobo ?? landed.amountKobo)} received
          </Text>
          <Text variant="sub" tone="ink3" style={{ textAlign: 'center' }}>
            It&apos;s in your wallet and ready for your next errand.
          </Text>
        </View>
      </Screen>
    );
  }

  if (deposit) {
    const until = deposit.expiresAt ? timeLabel(new Date(deposit.expiresAt)) : '';
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
        <AccountCard
          number={deposit.accountNumber}
          bank={deposit.bankName}
          name={deposit.accountName}
          copied={copied === deposit.accountNumber}
          onCopied={() => setCopied(deposit.accountNumber)}
        />
        <Steps
          lines={[
            `Open your bank app and send exactly ${naira(deposit.amountKobo)} to the account above.`,
            "It usually shows here within a minute. We'll update this screen when it lands.",
            deposit.expired
              ? 'This account number has expired. If you already sent the money, it will still reach your wallet.'
              : `This account number is for this top-up only, open until ${until}.`,
          ]}
          live={2}
          alert={deposit.expired ? 2 : undefined}
        />
      </Screen>
    );
  }

  // The customer's own number: any amount, any time.
  if (mode === 'auto' && own?.status === 'active' && own.accountNumber) {
    return (
      <Screen
        footer={
          <View style={{ gap: 8 }}>
            <Button label="Done" onPress={() => goBack()} />
            {oneTime ? (
              <Button kind="plain" label="Use a one-time account number instead" onPress={() => setMode('one_time')} />
            ) : null}
          </View>
        }
      >
        <View style={{ gap: 6 }}>
          <Text variant="heading" accessibilityRole="header" style={styles.h2}>
            {suggested ? `Add ${naira(suggested)} to continue` : 'Add money'}
          </Text>
          <Text variant="sub" tone="ink3">
            Send any amount from any bank app to your own account number. Your balance is for errands only.
          </Text>
        </View>
        <AccountCard
          number={own.accountNumber}
          bank={own.bankName ?? 'Bank'}
          name={own.accountName ?? ''}
          copied={copied === own.accountNumber}
          onCopied={() => setCopied(own.accountNumber)}
        />
        <Steps
          lines={[
            suggested
              ? `Open your bank app and send ${naira(suggested)} or more to the account above.`
              : 'Open your bank app and send any amount to the account above.',
            "It usually lands within a minute. We'll update this screen when it does.",
            'This account number is yours to keep. Use it whenever you want to add money.',
          ]}
        />
      </Screen>
    );
  }

  // Being issued: the provider is checking the customer's details.
  if (mode === 'auto' && own?.status === 'pending') {
    return (
      <Screen
        footer={
          <View style={{ gap: 8 }}>
            {oneTime ? (
              <Button label="Use a one-time account number meanwhile" onPress={() => setMode('one_time')} />
            ) : null}
            <Button kind={oneTime ? 'plain' : 'primary'} label="Later" onPress={() => goBack()} />
          </View>
        }
      >
        <View style={styles.hero}>
          <Icon name="clock" size={40} color={c.brand} />
          <Text variant="title" accessibilityRole="header">
            Getting your account number
          </Text>
          <Text variant="sub" tone="ink3" style={{ textAlign: 'center' }} accessibilityLiveRegion="polite">
            The bank is checking your details, usually within minutes. We&apos;ll tell you when it&apos;s ready.
          </Text>
        </View>
      </Screen>
    );
  }

  if (fixed && offered && (mode === 'fixed_form' || (!oneTime && mode === 'auto'))) {
    return (
      <FixedAccountForm
        needs={fixed.needs}
        failure={own?.status === 'failed' ? own.failureReason : null}
        onBack={oneTime ? () => setMode('auto') : undefined}
        onIssued={(account) => {
          options.setData({ ...options.data!, fixedAccount: { ...fixed, account } });
          setMode('auto');
        }}
      />
    );
  }

  return (
    <Screen
      footer={
        <View style={{ gap: 8 }}>
          <Button
            label={offered || own ? 'Get a one-time account number' : 'Get account number'}
            onPress={start}
            disabled={!valid}
            loading={busy}
          />
          {mode === 'one_time' && own?.status !== 'failed' ? (
            <Button kind="plain" label="Back to your own account number" onPress={() => setMode('auto')} />
          ) : null}
        </View>
      }
    >
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
      {offered && mode !== 'one_time' ? (
        <List>
          <Row
            icon="bank"
            title="Get your own account number"
            subtitle={
              own?.status === 'failed'
                ? "We couldn't issue it last time. Try again."
                : 'Send any amount, any time, without asking for a new number'
            }
            subtitleLines={2}
            right={<Icon name="chev" size={18} />}
            onPress={() => setMode('fixed_form')}
          />
        </List>
      ) : null}
    </Screen>
  );
}

/** An account number to transfer to, large, with a copy button. */
function AccountCard({
  number,
  bank,
  name,
  copied,
  onCopied,
}: {
  number: string;
  bank: string;
  name: string;
  copied: boolean;
  onCopied: () => void;
}) {
  const c = useColors();
  const copy = async () => {
    await Clipboard.setStringAsync(number);
    onCopied();
  };
  return (
    <View style={[styles.acctbig, { backgroundColor: c.surface2 }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Text style={[styles.acctSmall, { color: c.ink3 }]}>{bank} · account number</Text>
        <Text style={styles.acctNumber} accessibilityLabel={`Account number ${number.split('').join(' ')}`}>
          {number.replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3')}
        </Text>
        <Text style={[styles.acctSmall, { color: c.ink3 }]}>{name}</Text>
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
  );
}

/** Numbered steps. `live` is read out when it changes; `alert` is shown as a warning. */
function Steps({ lines, live, alert }: { lines: string[]; live?: number; alert?: number }) {
  const c = useColors();
  return (
    <View style={styles.steps}>
      {lines.map((line, i) => (
        <View key={i} style={styles.step}>
          <Text style={[styles.stepNum, { color: c.ink2 }]}>{i + 1}.</Text>
          <Text
            style={[styles.stepText, { color: i === alert ? c.danger : c.ink2 }]}
            accessibilityLiveRegion={i === live ? 'polite' : undefined}
          >
            {line}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Asks for what the payments provider needs to issue the customer's own account number: their BVN, and with
 * some providers a bank account in their name, which it checks first. Passed on, never kept by Jiffo.
 */
function FixedAccountForm({
  needs,
  failure,
  onBack,
  onIssued,
}: {
  needs: TopUpOptions['fixedAccount']['needs'];
  failure: string | null;
  onBack?: () => void;
  onIssued: (account: FixedAccount) => void;
}) {
  const { api } = useSession();
  const withBank = needs === 'bvn_and_bank';
  const banks = useResource<Bank[]>(withBank ? '/v1/banks' : null);
  const [bvn, setBvn] = useState('');
  const [bank, setBank] = useState<Bank | null>(null);
  const [search, setSearch] = useState('');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = useMemo(
    () => (banks.data ?? []).filter((b) => b.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8),
    [banks.data, search],
  );
  const ready = (needs === 'nothing' || bvn.length === 11) && (!withBank || (!!bank && number.length === 10));

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const account = await api.post<FixedAccount>('/v1/wallet/fixed-account', {
        ...(needs === 'nothing' ? {} : { bvn }),
        ...(withBank && bank ? { bankCode: bank.code, accountNumber: number } : {}),
      });
      if (account.status === 'failed') setError(account.failureReason ?? "We couldn't issue it. Check the numbers.");
      else onIssued(account);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={{ gap: 8 }}>
          <Button label="Get my account number" onPress={submit} disabled={!ready} loading={busy} />
          <Button kind="plain" label={onBack ? 'Back' : 'Later'} onPress={onBack ?? (() => goBack())} />
        </View>
      }
    >
      <View style={{ gap: 6 }}>
        <Text variant="heading" accessibilityRole="header" style={styles.h2}>
          Get your own account number
        </Text>
        <Text variant="sub" tone="ink3">
          Send any amount, any time, from any bank app. It&apos;s yours to keep, so there&apos;s no new number each
          time.
        </Text>
      </View>
      {needs === 'nothing' ? null : (
        <Field
          label="Your BVN"
          value={bvn}
          onChangeText={(t) => setBvn(t.replace(/\D/g, '').slice(0, 11))}
          keyboardType="number-pad"
          maxLength={11}
          placeholder="11 digits"
          error={withBank ? null : (error ?? failure)}
        />
      )}
      {withBank ? (
        <>
          <Text variant="note" tone="ink3">
            And a bank account in your name, so the bank can check it&apos;s you.
          </Text>
          {bank ? (
            <Row
              icon="bank"
              title={bank.name}
              subtitle="Bank"
              right={<Icon name="check" />}
              onPress={() => setBank(null)}
            />
          ) : (
            <View>
              <Field label="Bank" value={search} onChangeText={setSearch} placeholder="Search banks" />
              {banks.loading && !banks.data ? <ActivityIndicator /> : null}
              {banks.error && !banks.data ? (
                <View style={{ gap: 8, alignItems: 'flex-start' }}>
                  <Text variant="note" tone="danger">
                    Couldn&apos;t load the list of banks. Check your connection.
                  </Text>
                  <Button kind="secondary" small label="Try again" onPress={banks.reload} />
                </View>
              ) : null}
              {matches.map((b) => (
                <Row key={b.code} icon="bank" title={b.name} onPress={() => setBank(b)} />
              ))}
            </View>
          )}
          <Field
            label="Account number"
            value={number}
            onChangeText={(t) => setNumber(t.replace(/\D/g, '').slice(0, 10))}
            keyboardType="number-pad"
            maxLength={10}
            error={error ?? failure}
          />
        </>
      ) : null}
      {needs === 'nothing' && (error ?? failure) ? (
        <Text variant="note" tone="danger">
          {error ?? failure}
        </Text>
      ) : null}
      {needs === 'nothing' ? null : (
        <Text variant="note" tone="ink3">
          Your BVN goes to our payments provider to issue the account. Jiffo doesn&apos;t keep it, and it doesn&apos;t
          give anyone access to your bank account.
        </Text>
      )}
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
