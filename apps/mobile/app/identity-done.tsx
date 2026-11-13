import { useEffect } from 'react';
import { router } from 'expo-router';
import { VARIANT } from '@/config';

/**
 * Where an identity provider's page sends the person back to (jiffo://identity-done or
 * jiffo-agent://identity-done, from the API's identity/done page). The identity screen that opened the page
 * is still underneath and takes it from there, so this only steps back to it; opened on its own, it goes to
 * that screen.
 */
export default function IdentityDone() {
  useEffect(() => {
    if (router.canGoBack()) router.back();
    else router.replace(VARIANT === 'agent' ? '/apply/identity' : '/verify');
  }, []);
  return null;
}
