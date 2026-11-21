import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { useSession } from '../auth/session';
import { VARIANT } from '../config';
import { isOfferPush, isPushForOffer } from '../agent/offer';

/** Android's channel for offers (docs/matching.md, M6): the server sends them to it, so they ring through. */
export const OFFERS_CHANNEL = 'offers';

// While the app is open, an offer rings and opens its own screen (AgentOffersProvider), so no banner is shown
// over it; other pushes stay as before, not shown while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const offer = isOfferPush(notification.request.content.data);
    return { shouldShowBanner: false, shouldShowList: offer, shouldPlaySound: offer, shouldSetBadge: false };
  },
});

/**
 * Registers this phone for push after sign-in. The backend sends through FCM, which takes the Android
 * device token directly. iOS needs FCM's iOS SDK (or an APNs adapter on the server) before its tokens
 * can be used, so iOS registration waits for that decision.
 */
export function usePushRegistration() {
  const { status, api } = useSession();
  // The offers channel exists before any offer can arrive: one sent to a channel the phone doesn't have yet
  // lands in the default one, which may not ring.
  useEffect(() => {
    if (VARIANT !== 'agent' || Platform.OS !== 'android') return;
    Notifications.setNotificationChannelAsync(OFFERS_CHANNEL, {
      name: 'Errand offers',
      description: 'Urgent errands offered to you. They ring, and you have seconds to answer.',
      importance: Notifications.AndroidImportance.MAX,
      sound: 'default',
      enableVibrate: true,
      vibrationPattern: [0, 500, 250, 500],
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    }).catch(() => undefined);
  }, []);
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

/**
 * Calls the handler with a push's data when one arrives while the app is open, and when the person taps one,
 * the one that opened the app included. Each push is handled once.
 */
export function usePushData(handler: (data: Record<string, unknown>, how: 'arrived' | 'tapped') => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const seen = new Set<string>();
    const handle = (n: Notifications.Notification, how: 'arrived' | 'tapped') => {
      const key = `${how}:${n.request.identifier}`;
      if (seen.has(key)) return;
      seen.add(key);
      latest.current((n.request.content.data ?? {}) as Record<string, unknown>, how);
    };
    const arrived = Notifications.addNotificationReceivedListener((n) => handle(n, 'arrived'));
    const tapped = Notifications.addNotificationResponseReceivedListener((r) => handle(r.notification, 'tapped'));
    Notifications.getLastNotificationResponseAsync()
      .then((r) => r && handle(r.notification, 'tapped'))
      .catch(() => undefined);
    return () => {
      arrived.remove();
      tapped.remove();
    };
  }, []);
}

/** Takes an offer's push off the phone once the offer is answered or has ended. */
export async function dismissOfferPush(offerId: string) {
  if (Platform.OS === 'web') return;
  const shown = await Notifications.getPresentedNotificationsAsync().catch(() => []);
  for (const n of shown) {
    if (isPushForOffer({ identifier: n.request.identifier, data: n.request.content.data }, offerId)) {
      await Notifications.dismissNotificationAsync(n.request.identifier).catch(() => undefined);
    }
  }
}
