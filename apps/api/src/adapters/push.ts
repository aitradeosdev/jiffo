import { Logger } from '@nestjs/common';
import { importPKCS8, SignJWT } from 'jose';

export interface PushNotification {
  title: string;
  body: string;
  /** String values only: both FCM and APNs deliver data as strings. */
  data?: Record<string, string>;
}

export interface PushResult {
  /** Tokens the provider says are dead (app removed, token rotated). They are cleared from the device. */
  invalidTokens: string[];
}

/** Push notifications. FCM covers Android and iOS; another provider is one more implementation. */
export interface PushAdapter {
  readonly name: string;
  send(tokens: string[], notification: PushNotification): Promise<PushResult>;
}

export const PUSH = Symbol('PUSH');

export class ConsolePushAdapter implements PushAdapter {
  readonly name = 'console';
  private readonly logger = new Logger('Push');
  async send(tokens: string[], n: PushNotification) {
    this.logger.log(`Push to ${tokens.length} device(s): ${n.title} — ${n.body}`);
    return { invalidTokens: [] };
  }
}

export class MemoryPushAdapter implements PushAdapter {
  readonly name = 'memory';
  readonly sent: Array<{ token: string } & PushNotification> = [];
  /** Tokens to report as dead, for tests of token clean-up. */
  readonly dead = new Set<string>();
  async send(tokens: string[], n: PushNotification) {
    for (const token of tokens) this.sent.push({ token, ...n });
    return { invalidTokens: tokens.filter((t) => this.dead.has(t)) };
  }
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** Firebase Cloud Messaging, HTTP v1 API, authenticated with a service account. */
export class FcmPushAdapter implements PushAdapter {
  readonly name = 'fcm';
  private readonly account: ServiceAccount;
  private accessToken: { value: string; expiresAt: number } | null = null;
  private readonly logger = new Logger('FcmPush');

  constructor(
    serviceAccountJson: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const parsed = JSON.parse(serviceAccountJson) as Partial<ServiceAccount>;
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
      throw new Error('FCM_SERVICE_ACCOUNT_JSON must include project_id, client_email and private_key');
    }
    this.account = parsed as ServiceAccount;
  }

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) return this.accessToken.value;
    const key = await importPKCS8(this.account.private_key, 'RS256');
    const assertion = await new SignJWT({ scope: FCM_SCOPE })
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
    if (!res.ok) throw new Error(`FCM auth failed with ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.accessToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  async send(tokens: string[], n: PushNotification): Promise<PushResult> {
    if (tokens.length === 0) return { invalidTokens: [] };
    const accessToken = await this.token();
    const url = `https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`;
    const invalidTokens: string[] = [];

    await Promise.all(
      tokens.map(async (token) => {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: n.title, body: n.body },
              data: n.data ?? {},
              android: { priority: 'high' },
              apns: { headers: { 'apns-priority': '10' } },
            },
          }),
        });
        if (res.ok) return;
        const detail = await res.text();
        if (
          res.status === 404 ||
          detail.includes('UNREGISTERED') ||
          detail.includes('registration-token-not-registered')
        ) {
          invalidTokens.push(token);
        } else {
          this.logger.warn(`FCM send failed with ${res.status}: ${detail.slice(0, 200)}`);
        }
      }),
    );
    return { invalidTokens };
  }
}
