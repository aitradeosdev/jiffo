import { createHash } from 'node:crypto';
import { signedPayload } from '../auth/device-security.service';

/**
 * An app attestation's verdict (docs/security-plan.md, MB3):
 * - trusted: our store app on a genuine phone;
 * - doubtful: probably ours, but on a rooted phone or an emulator, or unchecked (the provider didn't answer);
 *   it asks for extra checks rather than refusing;
 * - failed: not our app, a changed one, or evidence for another request;
 * - missing: the request carried none;
 * - unavailable: not set up here for that platform.
 */
export type Verdict = 'trusted' | 'doubtful' | 'failed' | 'missing' | 'unavailable';

export interface AttestationCheck {
  verdict: Verdict;
  reasons: string[];
}

/** Where attestation is asked for. */
export const ATTEST_PURPOSES = ['sign_in', 'withdrawal', 'payout_account', 'go_online'] as const;
export type AttestPurpose = (typeof ATTEST_PURPOSES)[number];

/** The headers an attested request carries. */
export const ATTEST_HEADERS = {
  nonce: 'x-jiffo-attest-nonce',
  /** Android: the Play Integrity token. iOS: the App Attest assertion, base64. */
  token: 'x-jiffo-attest',
  /** iOS: the attested key's id, base64. */
  keyId: 'x-jiffo-attest-key',
} as const;

export interface AttestEvidence {
  nonce?: string;
  token?: string;
  keyId?: string;
}

/**
 * What an attestation covers: the server's single-use code, the method and path, and the body's hash, as a
 * signed money request does. As hex for Play Integrity's request hash; the raw bytes for App Attest.
 */
export function attestedHash(nonce: string, method: string, path: string, body: Buffer | string | undefined) {
  return createHash('sha256')
    .update(signedPayload(nonce, method, path, body))
    .digest();
}
