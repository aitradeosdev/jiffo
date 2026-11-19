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
  /** What the app found on the phone (MB4), comma-separated: one of RISK_SIGNALS each. */
  risk: 'x-jiffo-risk',
} as const;

/**
 * What the app looks for on the phone (docs/security-plan.md, MB4). It is the app's own word, so it adds to
 * Google's and Apple's checks rather than standing in for them: a changed app could leave it out.
 */
export const RISK_SIGNALS = ['rooted', 'emulator', 'hooking', 'debugger'] as const;
export type RiskSignal = (typeof RISK_SIGNALS)[number];
export const RISK_LABELS: Record<RiskSignal, string> = {
  rooted: 'A rooted or jailbroken phone',
  emulator: 'An emulator',
  hooking: 'A hooking tool such as Frida',
  debugger: 'A debugger attached',
};

/** The known signals in a header's comma-separated list, each once; anything else is dropped. */
export const riskSignalsOf = (header: string | undefined): RiskSignal[] =>
  [...new Set((header ?? '').split(',').map((s) => s.trim()))].filter((s): s is RiskSignal =>
    (RISK_SIGNALS as readonly string[]).includes(s),
  );

export interface AttestEvidence {
  nonce?: string;
  token?: string;
  keyId?: string;
  signals?: RiskSignal[];
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
