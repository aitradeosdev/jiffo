import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useSession } from '../auth/session';

/**
 * Registers this phone for push after sign-in. The backend sends through FCM, which takes the Android
 * device token directly. iOS needs FCM's iOS SDK (or an APNs adapter on the server) before its tokens
 * can be used, so iOS registration waits for that decision.
 */
export function usePushRegistration() {
  const { status, api } = useSession();
  useEffect(() => {
    if (status !== 'signedIn' || Platform.OS !== 'android' || !Device.isDevice) return;
    const send = (token: unknown) => {
      if (typeof token === 'string') api.put('/v1/devices/current/push-token', { token }).catch(() => undefined);
    };
    (async () => {
      const { status: permission } = await Notifications.requestPermissionsAsync();
      if (permission !== 'granted') return;
      send((await Notifications.getDevicePushTokenAsync()).data);
    })().catch(() => undefined);
    // FCM can rotate the token while the app runs; the server must always have the current one.
    const subscription = Notifications.addPushTokenListener((token) => send(token.data));
    return () => subscription.remove();
  }, [status, api]);
}
