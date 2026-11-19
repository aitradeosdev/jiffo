import { Platform } from 'react-native';
import { usePreventScreenCapture } from 'expo-screen-capture';

/**
 * No screenshots or screen recording while the screen is open (docs/security-plan.md, A9): money, ID or a
 * PIN on screen. The web build has nothing to block, so it does nothing there.
 */
export const useNoScreenCapture: (key: string) => void =
  Platform.OS === 'web' ? () => undefined : usePreventScreenCapture;
