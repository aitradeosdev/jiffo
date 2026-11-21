import { providerFetch } from './provider-fetch';
import { Logger } from '@nestjs/common';
import { GoogleServiceAuth, parseServiceAccount, type ServiceAccount } from './google-auth';

export interface PushNotification {
  title: string;
  body: string;
  /** String values only: both FCM and APNs deliver data as strings. */
  data?: Record<string, string>;
  /**
   * An offer to answer within seconds (docs/matching.md, M6): it rings, on Android's offers channel with sound
   * and as a time-sensitive alert with sound on iPhone, so it gets through even with the app closed.
   */
  ring?: boolean;
  /**
   * Names the push on Android, so the app can find it in the tray and take it off (an offer once it has ended),
   * also when the phone showed it with the app in the background and none of its data is left to go by.
   */
  tag?: string;
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

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** Firebase Cloud Messaging, HTTP v1 API, authenticated with a service account. */
export class FcmPushAdapter implements PushAdapter {
  readonly name = 'fcm';
  private readonly account: ServiceAccount;
  private readonly auth: GoogleServiceAuth;
  private readonly logger = new Logger('FcmPush');

  constructor(
    serviceAccountJson: string,
    private readonly fetchImpl: typeof fetch = providerFetch,
  ) {
    this.account = parseServiceAccount(serviceAccountJson, 'FCM_SERVICE_ACCOUNT_JSON');
    this.auth = new GoogleServiceAuth(this.account, FCM_SCOPE, fetchImpl);
  }

  /** For the panel's Test button: the key signs in to Google. */
  async check() {
    await this.token();
    return `Signed in to the Firebase project ${this.account.project_id}`;
  }

  private token(): Promise<string> {
    return this.auth.token();
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
              android: {
                priority: 'high',
                ...(n.ring || n.tag
                  ? {
                      notification: {
                        ...(n.ring ? { channel_id: 'offers', sound: 'default' } : {}),
                        ...(n.tag ? { tag: n.tag } : {}),
                      },
                    }
                  : {}),
              },
              apns: {
                headers: { 'apns-priority': '10' },
                ...(n.ring ? { payload: { aps: { sound: 'default', 'interruption-level': 'time-sensitive' } } } : {}),
              },
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
