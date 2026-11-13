import { useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, router, useFocusEffect, type Href } from 'expo-router';
import { agentTierLabel, holdsEarnings, type AgentTier } from '@jiffo/shared';
import { useSession } from '@/auth/session';
import { errorMessage } from '@/api/client';
import { useCountryConfig } from '@/api/useCountryConfig';
import { useResource } from '@/api/useResource';
import { CheckList, ProviderName, providerName, useApplication, type Application } from '@/agent/application';
import { useColors } from '@/theme/theme';
import { fonts } from '@/theme/tokens';
import { Connecting } from '@/ui/connecting';
import { Button, Text } from '@/ui/kit';
import { ObScreen, Question } from '@/ui/onboarding';
import { Badge, Icon, IconCircle, List, Row } from '@/ui/parts';

type StepKey = 'identity' | 'address' | 'bank' | 'prefs' | 'learn';

/** The checklist after the basics, as in the prototype, and where each step is done. */
const STEPS: Array<{ key: StepKey; title: string; sub: (app: Application) => string; icon: string; href: Href }> = [
  {
    key: 'identity',
    title: 'Identity',
    sub: (app) => `NIN, BVN and a selfie, checked by ${providerName(app)}`,
    icon: 'shield',
    href: '/apply/identity',
  },
  {
    key: 'address',
    title: 'Address and emergency contact',
    sub: (app) => `Confirmed by ${providerName(app)}, plus who to call`,
    icon: 'home',
    href: '/apply/address',
  },
  { key: 'bank', title: 'Payout account', sub: () => 'In your own name', icon: 'bank', href: '/payout-account' },
  {
    key: 'prefs',
    title: 'Errand preferences',
    sub: () => 'Categories and purchase errands',
    icon: 'tune',
    href: '/preferences?apply=1',
  },
  {
    key: 'learn',
    title: 'How errands work',
    sub: () => 'Four short screens and the agent terms',
    icon: 'info',
    href: '/apply/learn',
  },
];

/** The agent's application: the checklist while it is a draft, then where the checks have got to. */
export default function Apply() {
  const { app, reload } = useApplication();
  // Steps such as the bank account are saved on their own screens: look again on coming back.
  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  if (!app) return <Connecting />;
  if (app.status === 'draft' && !app.steps.basics) return <Redirect href="/apply/basics" />;
  if (app.status === 'draft' && app.waitlisted) return <Waitlist app={app} />;
  switch (app.status) {
    case 'draft':
      return <Checklist app={app} />;
    case 'checking':
      return <Checking app={app} />;
    case 'approved':
      return <Approved />;
    case 'review':
      return <Review app={app} />;
    default:
      return <Declined app={app} />;
  }
}

function Checklist({ app }: { app: Application }) {
  const c = useColors();
  const { api, user, signOut } = useSession();
  const { setApp } = useApplication();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = STEPS.filter((s) => app.steps[s.key]).length;
  const all = done === STEPS.length;
  const next = STEPS.find((s) => !app.steps[s.key])?.key;
  const left = STEPS.length - done;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      setApp(await api.post<Application>('/v1/agent/application/submit'));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ObScreen
      onBack={() => router.push('/apply/basics')}
      footer={
        <View style={{ gap: 10 }}>
          {error ? (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label="Submit application" onPress={submit} disabled={!all} loading={busy} />
          <Text variant="note" tone="ink3" style={{ textAlign: 'center' }}>
            {all ? `${ProviderName(app)} runs the checks straight away.` : `${left} step${left > 1 ? 's' : ''} left`}
          </Text>
        </View>
      }
    >
      <View style={{ gap: 8 }}>
        <Text style={styles.cap} tone="ink3">
          {app.stateName} · {app.area}
        </Text>
        <Question
          title={`Welcome, ${user?.firstName ?? ''}`}
          sub="Finish these to start earning. We save as you go, so you can stop and come back."
        />
      </View>
      <View style={{ gap: 6 }}>
        <View style={styles.meterHead}>
          <Text variant="small" tone="ink2">
            Progress
          </Text>
          <Text variant="small" style={{ fontFamily: fonts.bold, fontVariant: ['tabular-nums'] }}>
            {done} of {STEPS.length} done
          </Text>
        </View>
        <View
          accessibilityRole="progressbar"
          accessibilityLabel="Application progress"
          accessibilityValue={{ min: 0, max: STEPS.length, now: done }}
          style={[styles.bar, { backgroundColor: c.surface3 }]}
        >
          <View style={[styles.barFill, { width: `${(done / STEPS.length) * 100}%`, backgroundColor: c.ink }]} />
        </View>
      </View>
      <List>
        {STEPS.map((s) => {
          const isDone = app.steps[s.key];
          return (
            <Row
              key={s.key}
              iconNode={
                <IconCircle
                  icon={isDone ? 'check' : s.icon}
                  tone={isDone ? 'brand' : s.key === next ? 'ink' : undefined}
                />
              }
              title={s.title}
              subtitle={
                isDone
                  ? 'Done'
                  : s.key === 'identity' && app.identityChecking
                    ? `Waiting for the result from ${providerName(app)}`
                    : s.sub(app)
              }
              subtitleLines={2}
              onPress={() => router.push(s.href)}
              right={
                <View style={styles.right}>
                  {s.key === next ? <Badge label="Next" /> : null}
                  <Icon name="chev" size={18} color={c.ink3} />
                </View>
              }
            />
          );
        })}
      </List>
      <Button kind="plain" small label="Sign out" onPress={() => void signOut()} style={{ alignSelf: 'center' }} />
    </ObScreen>
  );
}

function Checking({ app }: { app: Application }) {
  return (
    <ObScreen>
      <Question
        title="Checking your application"
        sub={`${ProviderName(app)} is running the checks. Usually under a minute; an address visit can take longer. You can leave the app, we'll let you know.`}
      />
      <CheckList app={app} />
    </ObScreen>
  );
}

interface Payout {
  bankName: string;
  accountNumber: string;
}

function Approved() {
  const { user } = useSession();
  const { config } = useCountryConfig();
  const profile = useResource<{ tier: AgentTier }>('/v1/agent/profile');
  const payout = useResource<Payout | null>('/v1/payout-account');
  const tier = profile.data?.tier;
  const holdHours = config?.settings.timers.bronzePayoutHoldHours;
  return (
    <ObScreen footer={<Button label="Start earning" onPress={() => router.replace('/home')} />}>
      <Hero tone="brand" icon="check" title={`You're approved, ${user?.firstName ?? ''}`}>
        Go online whenever you&apos;re ready.
      </Hero>
      <KeyValues
        rows={[
          ['Tier', tier ? agentTierLabel(tier) : '…'],
          [
            'Errand earnings',
            !tier ? '…' : holdsEarnings(tier) ? `Withdrawable after ${holdHours ?? 24} hours` : 'Withdrawable at once',
          ],
          ['Item money', 'Withdrawable at once'],
          ['Payout account', payout.data ? `${payout.data.bankName} •••• ${payout.data.accountNumber.slice(-4)}` : '…'],
        ]}
      />
    </ObScreen>
  );
}

function Review({ app }: { app: Application }) {
  const { signOut } = useSession();
  return (
    <ObScreen footer={<Button kind="secondary" label="Sign out" onPress={() => void signOut()} />}>
      <Hero tone="urgent" icon="clock" title="Your application is under review">
        Some checks need a closer look. Our team looks at the results, usually within {app.reviewHours} hours, and lets
        you know.
      </Hero>
      <CheckList app={app} />
    </ObScreen>
  );
}

function Declined({ app }: { app: Application }) {
  const { signOut } = useSession();
  return (
    <ObScreen footer={<Button kind="secondary" label="Sign out" onPress={() => void signOut()} />}>
      <Hero tone="urgent" icon="alert" title="We couldn't approve your application">
        Our team looked at the results of your checks.
      </Hero>
      {app.decisionNote ? (
        <View style={{ gap: 6 }}>
          <Text variant="sec">What our team said</Text>
          <Text tone="ink2">{app.decisionNote}</Text>
        </View>
      ) : null}
    </ObScreen>
  );
}

function Waitlist({ app }: { app: Application }) {
  return (
    <ObScreen
      onBack={() => router.push('/apply/basics')}
      footer={<Button label="Choose another state" onPress={() => router.push('/apply/basics')} />}
    >
      <Hero tone="urgent" icon="clock" title={`You're on the ${app.stateName} waitlist`}>
        We have enough agents in {app.stateName} for now. Your details stay saved, and you can send your application
        once sign-ups open there.
      </Hero>
    </ObScreen>
  );
}

/** .hero: the big round tick or clock, a headline and a line under it. */
function Hero({
  tone,
  icon,
  title,
  children,
}: {
  tone: 'brand' | 'urgent';
  icon: string;
  title: string;
  children: ReactNode;
}) {
  const c = useColors();
  return (
    <View style={styles.hero}>
      <View style={[styles.tick, { backgroundColor: tone === 'brand' ? c.brand2 : c.urgentSoft }]}>
        <Icon
          name={icon}
          size={34}
          weight={tone === 'brand' ? 3 : undefined}
          color={tone === 'brand' ? c.onBrand : c.urgent}
        />
      </View>
      <Text style={styles.heroTitle} accessibilityRole="header">
        {title}
      </Text>
      <Text variant="sub" tone="ink3" style={{ textAlign: 'center' }}>
        {children}
      </Text>
    </View>
  );
}

/** .kv: label on the left, value on the right, a hairline between rows. */
function KeyValues({ rows }: { rows: Array<[string, string]> }) {
  const c = useColors();
  return (
    <View>
      {rows.map(([k, v], i) => (
        <View
          key={k}
          style={[styles.kv, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: c.line }]}
        >
          <Text tone="ink3">{k}</Text>
          <Text variant="label" style={{ textAlign: 'right', flexShrink: 1, fontVariant: ['tabular-nums'] }}>
            {v}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  cap: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.72, textTransform: 'uppercase' },
  meterHead: { flexDirection: 'row', justifyContent: 'space-between' },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  hero: { alignItems: 'center', gap: 8, paddingTop: 8, paddingBottom: 4 },
  tick: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontFamily: fonts.bold, fontSize: 27, lineHeight: 31, letterSpacing: -0.54, textAlign: 'center' },
  kv: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 54 },
});
