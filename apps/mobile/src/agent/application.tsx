import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, StyleSheet, View } from 'react-native';
import { useSession } from '../auth/session';
import { errorMessage } from '../api/client';
import { useColors } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { Text } from '../ui/kit';
import { Icon } from '../ui/parts';
import type { IdType } from '@jiffo/shared';

export type ApplicationStatus = 'draft' | 'checking' | 'approved' | 'review' | 'rejected';
export type CheckOutcome = 'passed' | 'failed' | 'review';

export interface Application {
  status: ApplicationStatus;
  steps: { basics: boolean; identity: boolean; address: boolean; bank: boolean; prefs: boolean; learn: boolean };
  /** Started with the provider, and its result not back yet. */
  identityChecking: boolean;
  /**
   * How the identity check runs: "numbers" asks for the NIN and BVN here and then runs the provider's SDK;
   * "hosted" opens the provider's own page, which asks for everything itself.
   */
  identityFlow: 'numbers' | 'hosted';
  /** The IDs the agent can verify with now (those admin accepts that the provider checks). */
  idTypes: Array<{ key: IdType; name: string }>;
  /** Their BVN is checked as well. */
  withBvn: boolean;
  /** The agent picks the ID on the provider's page rather than in the app. */
  idChosenOnPage: boolean;
  /** The ID the current or last check used. */
  identityIdType: IdType | null;
  stateCode: string | null;
  stateName: string | null;
  waitlisted: boolean;
  area: string | null;
  address: string | null;
  emergency: { name: string; phone: string | null; relationship: string | null } | null;
  legalName: string | null;
  checks: Array<{ key: string; outcome: CheckOutcome; note?: string; label: string }>;
  submittedAt: string | null;
  decisionNote: string | null;
  /** The identity provider's name, when admin has set one. */
  provider: string | null;
  reviewHours: number;
}

/** The words for each check not back yet. */
const PENDING_LABELS: Record<string, string> = {
  nin: 'NIN matches your details',
  bvn: 'BVN matches your details',
  drivers_licence: "Driver's licence matches your details",
  voters_card: "Voter's card matches your details",
  passport: 'Passport matches your details',
  selfie: 'Selfie matches your ID photo',
  age: 'Age 18 or older',
  name: 'Your name matches your ID',
  address: 'Address confirmed',
  bank: 'Bank account name matches your ID',
};

/** The checks in the order the checking screen lists them: the agent's ID first, then their BVN if asked. */
export function checkOrder(app: Pick<Application, 'identityIdType' | 'withBvn' | 'checks'>): Array<[string, string]> {
  const id = app.identityIdType ?? 'nin';
  const bvn = id !== 'bvn' && (app.withBvn || app.checks.some((c) => c.key === 'bvn'));
  const keys = [id, ...(bvn ? ['bvn'] : []), 'selfie', 'age', 'name', 'address', 'bank'];
  return keys.map((key) => [key, PENDING_LABELS[key] ?? key]);
}

/** The provider's name in a sentence, for when admin hasn't named one yet. */
export const providerName = (app: Pick<Application, 'provider'> | null) => app?.provider ?? 'our identity provider';
/** The same, to start a sentence with. */
export const ProviderName = (app: Pick<Application, 'provider'> | null) => {
  const name = providerName(app);
  return name.charAt(0).toUpperCase() + name.slice(1);
};

interface ApplicationValue {
  app: Application | null;
  error: string | null;
  reload: () => Promise<Application | null>;
  /** For screens that get the application back from a save. */
  setApp: (app: Application) => void;
}

const ApplicationContext = createContext<ApplicationValue | null>(null);

/**
 * How often the app asks again while something is being decided: the checks after submitting, an identity
 * result not back yet, or support looking at an application in review. The API asks the provider less often.
 */
const pollEvery = (app: Application | null) =>
  !app
    ? null
    : app.status === 'checking'
      ? 5_000
      : app.status === 'draft' && app.identityChecking
        ? 10_000
        : app.status === 'review'
          ? 30_000
          : null;

/**
 * The agent's application, for the gate in front of the board and for the application screens. Loaded on
 * sign-in, retried until it arrives, and asked about again while the checks run.
 */
export function ApplicationProvider({ children }: { children: ReactNode }) {
  const { api } = useSession();
  const [app, setApp] = useState<Application | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);

  const reload = useCallback(async () => {
    try {
      const next = await api.get<Application>('/v1/agent/application');
      if (live.current) {
        setApp(next);
        setError(null);
      }
      return next;
    } catch (e) {
      if (live.current) setError(errorMessage(e));
      return null;
    }
  }, [api]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    // Its own flag, so a loop from an earlier run of this effect stops even if a newer one has started.
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    (async () => {
      for (let attempt = 0; !stopped; attempt += 1) {
        if (await reload()) return;
        if (stopped) return;
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, Math.min(30_000, 2_000 * 2 ** attempt));
        });
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [reload]);

  const every = pollEvery(app);
  useEffect(() => {
    if (!every) return;
    const timer = setInterval(() => void reload(), every);
    return () => clearInterval(timer);
  }, [every, reload]);

  // Back in the app after a while (a text or a notification about the decision): look again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void reload();
    });
    return () => sub.remove();
  }, [reload]);

  return <ApplicationContext.Provider value={{ app, error, reload, setApp }}>{children}</ApplicationContext.Provider>;
}

export function useApplication() {
  const value = useContext(ApplicationContext);
  if (!value) throw new Error('useApplication needs ApplicationProvider');
  return value;
}

/** The application in the agent app, and null in the customer app, for screens both apps share. */
export const useOptionalApplication = () => useContext(ApplicationContext)?.app ?? null;

type CheckState = 'done' | 'warn' | 'now' | 'waiting';

/** .ckl: the checks, ticked when passed, flagged when they need a look, a spinner on the one running. */
export function CheckList({ app }: { app: Application }) {
  const c = useColors();
  const byKey = new Map(app.checks.map((ch) => [ch.key, ch]));
  const running = app.status === 'checking';
  const order = checkOrder(app);
  const firstMissing = order.findIndex(([key]) => !byKey.has(key));
  const rows: Array<{ key: string; label: string; state: CheckState; note?: string }> = [
    ...order.map(([key, label], i) => {
      const check = byKey.get(key);
      const state: CheckState = check
        ? check.outcome === 'passed'
          ? 'done'
          : 'warn'
        : running && i === firstMissing
          ? 'now'
          : 'waiting';
      return { key, label: check?.label ?? label, state, note: check?.outcome === 'passed' ? undefined : check?.note };
    }),
    // Results the app has no row for, such as a second account on the same NIN.
    ...app.checks
      .filter((ch) => !order.some(([key]) => key === ch.key))
      .map((ch) => ({
        key: ch.key,
        label: ch.label,
        state: (ch.outcome === 'passed' ? 'done' : 'warn') as CheckState,
        note: ch.note,
      })),
  ];
  return (
    <View accessibilityRole="list">
      {rows.map((row, i) => (
        <View
          key={row.key}
          accessible
          accessibilityLabel={`${row.label}: ${
            { done: 'passed', warn: 'needs a closer look', now: 'checking', waiting: 'waiting' }[row.state]
          }`}
          style={[styles.ck, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: c.line }]}
        >
          <View
            style={[
              styles.ckd,
              {
                backgroundColor: row.state === 'done' ? c.brand2 : row.state === 'warn' ? c.urgentSoft : c.surface2,
              },
            ]}
          >
            {row.state === 'done' ? (
              <Icon name="check" size={14} weight={3} color={c.onBrand} />
            ) : row.state === 'warn' ? (
              <Icon name="alert" size={14} weight={2.4} color={c.urgent} />
            ) : row.state === 'now' ? (
              <ActivityIndicator size="small" color={c.ink} />
            ) : null}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text
              style={[
                styles.ckText,
                { color: row.state === 'warn' ? c.urgent : row.state === 'waiting' ? c.ink3 : c.ink },
              ]}
            >
              {row.label}
            </Text>
            {row.note && row.state === 'warn' ? (
              <Text variant="note" tone="ink3">
                {row.note}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ck: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingVertical: 8 },
  ckd: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  ckText: { fontFamily: fonts.semibold, fontSize: 15.5, lineHeight: 20 },
});
