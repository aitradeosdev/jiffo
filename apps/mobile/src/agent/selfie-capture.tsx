import type { SelfieCaptureProps } from './selfie-capture.types';

/**
 * The web build has no selfie camera: Smile ID's SDK runs only in the phone apps (docs/security-plan.md, I2).
 * The phone apps load selfie-capture.native.tsx instead.
 */
export const selfieCaptureAvailable = () => false;

export function SelfieCapture(_: SelfieCaptureProps) {
  return null;
}
