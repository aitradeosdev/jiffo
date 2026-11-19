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
