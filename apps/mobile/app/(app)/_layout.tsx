import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Redirect, Stack, usePathname } from 'expo-router';
import { useSession } from '@/auth/session';
import { Connecting } from '@/ui/connecting';
import { DraftProvider } from '@/errands/draft';
import { AgentPresenceProvider } from '@/agent/presence';
import { ApplicationProvider, useApplication } from '@/agent/application';
import { VARIANT } from '@/config';
import { Button } from '@/ui/kit';
import { ObScreen, Question } from '@/ui/onboarding';

/** Screens an agent uses while applying: the application itself, and the steps it shares with the app. */
const APPLYING = ['/apply', '/name', '/payout-account', '/preferences'];

/** Everything behind sign-in. A signed-out visitor goes to the welcome screen; a nameless account to the name step. */
export default function AppLayout() {
  const { status, user } = useSession();
  const path = usePathname();
  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  // Signed in but the profile hasn't loaded (offline at launch): wait, so the name step is never skipped.
  if (!user) return <Connecting />;
  if (!user.firstName && path !== '/name') return <Redirect href="/name" />;
  const app = (
    <DraftProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="place" options={{ presentation: 'modal' }} />
        <Stack.Screen name="category" options={{ presentation: 'modal' }} />
        <Stack.Screen name="when" options={{ presentation: 'modal' }} />
        <Stack.Screen name="topup" options={{ presentation: 'modal' }} />
        <Stack.Screen name="withdraw" options={{ presentation: 'modal' }} />
        <Stack.Screen name="payout-account" options={{ presentation: 'modal' }} />
      </Stack>
    </DraftProvider>
  );
  // The agent app knows whether its agent is online and where they are, for the board and errands, and
  // keeps agents on their application until it is approved.
  return VARIANT === 'agent' ? (
    <ApplicationProvider>
      <ApplicationGate>
        <AgentPresenceProvider>{app}</AgentPresenceProvider>
      </ApplicationGate>
    </ApplicationProvider>
  ) : (
    app
  );
}

/** An agent whose application isn't approved sees the application, not the board. */
function ApplicationGate({ children }: { children: ReactNode }) {
  const { app, error, reload } = useApplication();
  const path = usePathname();
  // The name step comes first and needs nothing from the application.
  if (!app && path === '/name') return children;
  if (!app) return error ? <ApplicationError message={error} retry={reload} /> : <Connecting />;
  const applying = APPLYING.some((p) => path === p || path.startsWith(`${p}/`));
  if (app.status !== 'approved' && !applying) return <Redirect href="/apply" />;
  return children;
}

/** The application couldn't be loaded: say why, and offer to try again or sign out. It keeps retrying too. */
function ApplicationError({ message, retry }: { message: string; retry: () => Promise<unknown> }) {
  const { signOut } = useSession();
  const [busy, setBusy] = useState(false);
  return (
    <ObScreen
      footer={
        <View style={{ gap: 8 }}>
          <Button
            label="Try again"
            loading={busy}
            onPress={async () => {
              setBusy(true);
              await retry();
              setBusy(false);
            }}
          />
          <Button kind="secondary" label="Sign out" onPress={() => void signOut()} />
        </View>
      }
    >
      <Question title="We couldn't load your application" sub={message} />
    </ObScreen>
  );
}
