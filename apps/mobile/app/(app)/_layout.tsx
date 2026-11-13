import { Redirect, Stack, usePathname } from 'expo-router';
import { useSession } from '@/auth/session';

/** Everything behind sign-in. A signed-out visitor goes to the welcome screen; a nameless account to the name step. */
export default function AppLayout() {
  const { status, user } = useSession();
  const path = usePathname();
  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  if (user && !user.firstName && path !== '/name') return <Redirect href="/name" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
