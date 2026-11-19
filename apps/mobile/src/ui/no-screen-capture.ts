import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from 'expo-screen-capture';

/*
 * No screenshots or screen recording while money, ID or a PIN is on screen (docs/security-plan.md, A9). The
 * web build has nothing to block. Each screen has its own key, so one leaving doesn't unblock another.
 */

const native = Platform.OS !== 'web';

/** Blocks capture until `allowScreenCapture` with the same key. */
export const blockScreenCapture = (key: string) =>
  native ? preventScreenCaptureAsync(key).catch(() => undefined) : Promise.resolve();
export const allowScreenCapture = (key: string) =>
  native ? allowScreenCaptureAsync(key).catch(() => undefined) : Promise.resolve();

/**
 * Blocks capture while this screen is in front, and while `enabled`. Tabs and screens underneath stay
 * mounted, so it follows focus rather than mounting.
 */
export function useNoScreenCapture(key: string, enabled = true) {
  useFocusEffect(
    useCallback(() => {
      if (!enabled) return undefined;
      void blockScreenCapture(key);
      return () => {
        void allowScreenCapture(key);
      };
    }, [key, enabled]),
  );
}
