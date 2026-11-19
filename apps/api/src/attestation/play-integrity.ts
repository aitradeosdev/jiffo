import { GoogleServiceAuth, parseServiceAccount } from '../adapters/google-auth';
import { providerFetch } from '../adapters/provider-fetch';
import type { AppName } from '../db/schema';
import type { AttestationCheck } from './attestation.types';

const SCOPE = 'https://www.googleapis.com/auth/playintegrity';
/** A token's request is this fresh at most. */
const MAX_AGE_MS = 10 * 60_000;

/** Google couldn't be asked: the check is doubtful, never a reason to refuse everyone. */
export class PlayIntegrityUnavailable extends Error {}

interface Payload {
  requestDetails?: { requestPackageName?: string; requestHash?: string; timestampMillis?: string };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string; certificateSha256Digest?: string[] };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  accountDetails?: { appLicensingVerdict?: string };
}

/** A certificate digest as Play Console shows it (hex, with or without colons) or as Google sends it. */
const digestOf = (value: string) =>
  /^[0-9a-f:]+$/i.test(value) && value.replace(/:/g, '').length === 64
    ? Buffer.from(value.replace(/:/g, ''), 'hex').toString('base64url')
    : value.replace(/=+$/, '');

/**
 * Google Play Integrity, standard requests (docs/security-plan.md, MB3): the app asks Google for a token over
 * the hash of this request; Google decrypts it for us and says whether the app is ours as Play installed it,
 * on a genuine Android phone.
 */
export class PlayIntegrityVerifier {
  private readonly auth: GoogleServiceAuth;
  private readonly digests: string[];

  constructor(
    serviceAccountJson: string,
    /** Each app's package name. */
    private readonly packages: Readonly<Record<AppName, string>>,
    certDigests: readonly string[],
    private readonly fetchImpl: typeof fetch = providerFetch,
  ) {
    this.auth = new GoogleServiceAuth(
      parseServiceAccount(serviceAccountJson, 'PLAY_INTEGRITY_SERVICE_ACCOUNT_JSON'),
      SCOPE,
      fetchImpl,
    );
    this.digests = certDigests.map(digestOf);
  }

  /** The verdict on a token made for `requestHash` (hex), by `app`. */
  async verify(token: string, requestHash: string, app: AppName, now = Date.now()): Promise<AttestationCheck> {
    const packageName = this.packages[app];
    const payload = await this.decode(token, packageName);
    const reasons: string[] = [];
    const request = payload.requestDetails ?? {};
    const integrity = payload.appIntegrity ?? {};
    if (request.requestPackageName !== packageName) {
      return { verdict: 'failed', reasons: ['For another app'] };
    }
    if (request.requestHash !== requestHash) return { verdict: 'failed', reasons: ['For another request'] };
    const at = Number(request.timestampMillis);
    if (!Number.isFinite(at) || now - at > MAX_AGE_MS || at - now > 60_000) {
      return { verdict: 'failed', reasons: ['Too old'] };
    }
    if (integrity.appRecognitionVerdict === 'UNRECOGNIZED_VERSION') {
      return { verdict: 'failed', reasons: ['Not the app as Play installs it (changed or side-loaded)'] };
    }
    if (
      this.digests.length &&
      !(integrity.certificateSha256Digest ?? []).some((d) => this.digests.includes(digestOf(d)))
    ) {
      return { verdict: 'failed', reasons: ['Signed by someone else'] };
    }
    if (integrity.appRecognitionVerdict !== 'PLAY_RECOGNIZED') reasons.push("Play couldn't check the app");
    const device = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
    if (!device.includes('MEETS_DEVICE_INTEGRITY')) {
      reasons.push(
        device.includes('MEETS_VIRTUAL_INTEGRITY')
          ? 'An emulator'
          : device.includes('MEETS_BASIC_INTEGRITY')
            ? 'A rooted or changed phone'
            : 'Not a genuine Android phone',
      );
    }
    if (payload.accountDetails?.appLicensingVerdict === 'UNLICENSED') reasons.push('Not installed from Play');
    return reasons.length ? { verdict: 'doubtful', reasons } : { verdict: 'trusted', reasons: [] };
  }

  private async decode(token: string, packageName: string): Promise<Payload> {
    const url = `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${await this.auth.token()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ integrity_token: token }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new PlayIntegrityUnavailable(`Play Integrity didn't answer: ${String(error)}`);
    }
    // A token Google can't read is the app's fault, not Google's.
    if (res.status === 400) return {};
    if (!res.ok) throw new PlayIntegrityUnavailable(`Play Integrity answered ${res.status}`);
    const body = (await res.json().catch(() => null)) as { tokenPayloadExternal?: Payload } | null;
    return body?.tokenPayloadExternal ?? {};
  }
}
