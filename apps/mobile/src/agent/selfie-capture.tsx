import type { SelfieCaptureAdapter } from './selfie-capture.types';

/**
 * The web build has no selfie camera: providers' SDKs run only in the phone apps (docs/security-plan.md, I2).
 * The phone apps load selfie-capture.native.tsx instead.
 */
export const captureFor = (_provider: string): SelfieCaptureAdapter | null => null;
