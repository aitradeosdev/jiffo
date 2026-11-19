import { importPKCS8, SignJWT } from 'jose';
import { providerFetch } from './provider-fetch';

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** A Google service account's JSON key, checked for what signing in needs. */
export function parseServiceAccount(json: string, name: string): ServiceAccount {
  const parsed = JSON.parse(json) as Partial<ServiceAccount>;
  if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
    throw new Error(`${name} must include project_id, client_email and private_key`);
  }
  return parsed as ServiceAccount;
}

/**
 * Signs in to Google as a service account for one scope (OAuth 2.0 JWT bearer), keeping the access token
 * until a minute before it expires. Used for Firebase push and Play Integrity.
 */
export class GoogleServiceAuth {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    readonly account: ServiceAccount,
    private readonly scope: string,
    private readonly fetchImpl: typeof fetch = providerFetch,
  ) {}

  async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const key = await importPKCS8(this.account.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: this.scope })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.account.client_email)
      .setAudience(GOOGLE_TOKEN_URL)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    const res = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    });
    if (!res.ok) throw new Error(`Google sign-in failed with ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }
}
