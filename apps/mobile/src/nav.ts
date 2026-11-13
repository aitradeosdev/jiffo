import { router } from 'expo-router';

/** Back to the previous screen, or home when the screen was opened directly (a link, a notification). */
export function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/home');
}
