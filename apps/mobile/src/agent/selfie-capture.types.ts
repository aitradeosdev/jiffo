import type { ComponentType } from 'react';
import type { SelfieSession } from './selfie';

/** How the provider's own selfie screens ended: the selfie sent, the agent leaving, or an error there. */
export type CaptureEnd = 'sent' | 'cancelled' | 'error';

export interface SelfieCaptureProps {
  session: SelfieSession;
  givenNames: string;
  lastName: string;
  /** When the agent agreed, on our screen before this one. */
  consentedAt: string;
  onEnd: (end: CaptureEnd) => void;
}

/**
 * One identity provider's selfie in the app, as the API has an adapter per provider: its own SDK's screens,
 * whether this build has that SDK, and whether the server's session has what it needs. Registered by the
 * provider's name, which the server sends with each check.
 */
export interface SelfieCaptureAdapter {
  available: () => boolean;
  ready: (session: SelfieSession) => boolean;
  Capture: ComponentType<SelfieCaptureProps>;
}

/** Providers whose verdict the server gives without a camera: the development one. */
export const DECIDED_BY_SERVER: readonly string[] = ['fake'];
