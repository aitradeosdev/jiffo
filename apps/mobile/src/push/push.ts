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
    (async () => {
      const { status: permission } = await Notifications.requestPermissionsAsync();
      if (permission !== 'granted') return;
      const { data } = await Notifications.getDevicePushTokenAsync();
      if (typeof data === 'string') await api.put('/v1/devices/current/push-token', { token: data });
    })().catch(() => undefined);
  }, [status, api]);
}
