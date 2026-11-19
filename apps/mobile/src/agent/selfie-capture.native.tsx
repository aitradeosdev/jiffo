import { lazy, Suspense } from 'react';
import { requireOptionalNativeModule } from 'expo';
import { Connecting } from '@/ui/connecting';
import type { SelfieCaptureAdapter, SelfieCaptureProps } from './selfie-capture.types';

/**
 * Smile ID's SDK is native code, in development and store builds of the agent app but not in Expo Go. It is
 * loaded only when there, and only when a selfie is taken.
 */
const smileIdBuilt = requireOptionalNativeModule('UseSmileIDBridge') !== null;
const SmileCapture = lazy(() => import('./smile-capture'));

const smileid: SelfieCaptureAdapter = {
  available: () => smileIdBuilt,
  // The token for this check, and the partner and notice the SDK refuses to start without.
  ready: (s) => !!s.token && !!s.partnerId && !!s.privacyPolicyUrl,
  Capture: (props: SelfieCaptureProps) => (
    <Suspense fallback={<Connecting />}>
      <SmileCapture {...props} />
    </Suspense>
  ),
};

/** Each provider's selfie, by the name the server gives it. Another provider is added here, as on the API. */
const CAPTURES: Record<string, SelfieCaptureAdapter> = { smileid };

export const captureFor = (provider: string): SelfieCaptureAdapter | null => CAPTURES[provider] ?? null;
