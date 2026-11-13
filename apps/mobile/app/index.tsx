import { Redirect } from 'expo-router';
import { useSession } from '@/auth/session';

/** Sends people to sign-in, the name step, or the app. */
export default function Index() {
  const { status, user } = useSession();
  if (status === 'loading') return null;
  if (status === 'signedOut') return <Redirect href="/welcome" />;
  if (user && !user.firstName) return <Redirect href="/name" />;
  return <Redirect href="/home" />;
}
