import type { ReactNode } from 'react';
import { Redirect, Stack, usePathname } from 'expo-router';
import { useSession } from '@/auth/session';
import { Connecting } from '@/ui/connecting';
import { DraftProvider } from '@/errands/draft';
import { AgentPresenceProvider } from '@/agent/presence';
import { ApplicationProvider, useApplication } from '@/agent/application';
import { VARIANT } from '@/config';

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
  const { app } = useApplication();
  const path = usePathname();
  // The name step comes first and needs nothing from the application.
  if (!app) return path === '/name' ? children : <Connecting />;
  const applying = APPLYING.some((p) => path === p || path.startsWith(`${p}/`));
  if (app.status !== 'approved' && !applying) return <Redirect href="/apply" />;
  return children;
}
