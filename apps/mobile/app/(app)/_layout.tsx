import { Redirect, Stack, usePathname } from 'expo-router';
import { useSession } from '@/auth/session';
import { Connecting } from '@/ui/connecting';
import { DraftProvider } from '@/errands/draft';

/** Everything behind sign-in. A signed-out visitor goes to the welcome screen; a nameless account to the name step. */
export default function AppLayout() {
  const { status, user } = useSession();
  const path = usePathname();
  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  // Signed in but the profile hasn't loaded (offline at launch): wait, so the name step is never skipped.
  if (!user) return <Connecting />;
  if (!user.firstName && path !== '/name') return <Redirect href="/name" />;
  return (
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
}
