import { Redirect, Stack } from 'expo-router';
import { useSession } from '@/auth/session';

/** Sign-in screens. Someone already signed in goes straight to the app. */
export default function AuthLayout() {
  const { status } = useSession();
  if (status === 'signedIn') return <Redirect href="/home" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
