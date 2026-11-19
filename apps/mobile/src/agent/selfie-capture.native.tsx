import { lazy, Suspense } from 'react';
import { requireOptionalNativeModule } from 'expo';
import { Connecting } from '@/ui/connecting';
import type { SelfieCaptureProps } from './selfie-capture.types';

/**
 * Smile ID's SDK is native code, in development and store builds of the agent app but not in Expo Go. It is
 * loaded only when there, and only when a selfie is taken.
 */
const available = requireOptionalNativeModule('UseSmileIDBridge') !== null;
export const selfieCaptureAvailable = () => available;

const SmileCapture = lazy(() => import('./smile-capture'));

export function SelfieCapture(props: SelfieCaptureProps) {
  return (
    <Suspense fallback={<Connecting />}>
      <SmileCapture {...props} />
    </Suspense>
  );
}
