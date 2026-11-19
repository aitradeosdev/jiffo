import type { ApiClient } from '../api/client';

/** The headers a signed money request carries (docs/security-plan.md, A3, A7), as the API reads them. */
export const SIGNED_HEADERS = { nonce: 'x-jiffo-nonce', signature: 'x-jiffo-signature', pin: 'x-jiffo-pin' } as const;

/**
 * What the phone signs: the server's single-use code, the method, the path and a hash of the body, one per
 * line, exactly as the API builds it (apps/api/src/auth/device-security.service.ts, signedPayload).
 */
export async function signedPayload(
  nonce: string,
  method: string,
  path: string,
  body: string,
  sha256Hex: (text: string) => Promise<string>,
) {
  return [nonce, method.toUpperCase(), path, await sha256Hex(body)].join('\n');
}

export interface SigningDeps {
  api: Pick<ApiClient, 'post' | 'withHeaders'>;
  /** Signs with the phone's own key: ECDSA P-256 SHA-256, base64 DER. */
  sign(text: string): Promise<string>;
  sha256Hex(text: string): Promise<string>;
  /** The app check's headers for this request (MB3), when the server asks for one. */
  attest?(method: 'POST' | 'PUT', path: string, body: unknown): Promise<Record<string, string>>;
}

/**
 * A money request: a fresh single-use code from the server, signed by the phone's key over this request, with
 * the app PIN. The body is serialised once here and again by the client the same way, so the hash matches.
 */
export async function signedRequest<T>(
  deps: SigningDeps,
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  pin: string,
): Promise<T> {
  const { nonce } = await deps.api.post<{ nonce: string }>('/v1/devices/current/challenge');
  const signature = await deps.sign(await signedPayload(nonce, method, path, JSON.stringify(body), deps.sha256Hex));
  const checked = deps.attest ? await deps.attest(method, path, body) : {};
  return deps.api.withHeaders<T>(method, path, body, {
    ...checked,
    [SIGNED_HEADERS.nonce]: nonce,
    [SIGNED_HEADERS.signature]: signature,
    ...(pin ? { [SIGNED_HEADERS.pin]: pin } : {}),
  });
}
