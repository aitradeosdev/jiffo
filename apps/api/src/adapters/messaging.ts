import { Logger } from '@nestjs/common';
import { unavailable } from '../common/errors';

/** SMS and one-time codes. Each provider (Termii, Africa's Talking, ...) is one implementation. */
export interface MessagingAdapter {
  readonly name: string;
  sendOtp(phone: string, code: string, ttlSeconds: number): Promise<void>;
}

export const MESSAGING = Symbol('MESSAGING');

const otpText = (code: string, ttlSeconds: number) =>
  `Your Jiffo code is ${code}. It expires in ${Math.round(ttlSeconds / 60)} minutes. Never share it with anyone.`;

/** Development only: prints the code to the server log. */
export class ConsoleMessagingAdapter implements MessagingAdapter {
  readonly name = 'console';
  private readonly logger = new Logger('Messaging');
  async sendOtp(phone: string, code: string, ttlSeconds: number) {
    this.logger.log(`OTP for ${phone}: ${code} (valid ${ttlSeconds}s)`);
  }
}

/** Tests: keeps the codes in memory so a test can read them back. */
export class MemoryMessagingAdapter implements MessagingAdapter {
  readonly name = 'memory';
  readonly sent: Array<{ phone: string; code: string }> = [];
  async sendOtp(phone: string, code: string) {
    this.sent.push({ phone, code });
  }
  lastCodeFor(phone: string): string | undefined {
    return [...this.sent].reverse().find((m) => m.phone === phone)?.code;
  }
}

/** Termii SMS on the DND route, so codes reach numbers with do-not-disturb switched on. */
export class TermiiMessagingAdapter implements MessagingAdapter {
  readonly name = 'termii';
  constructor(
    private readonly apiKey: string,
    private readonly senderId: string,
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async sendOtp(phone: string, code: string, ttlSeconds: number) {
    const res = await this.fetchImpl(`${this.baseUrl}/api/sms/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        api_key: this.apiKey,
        to: phone.replace(/^\+/, ''),
        from: this.senderId,
        sms: otpText(code, ttlSeconds),
        type: 'plain',
        channel: 'dnd',
      }),
    });
    if (!res.ok) throw unavailable('sms_failed', 'We could not send the code. Try again in a moment.');
  }

  /** For the panel's Test button: the key works, and how much credit is left. Sends nothing. */
  async check() {
    const res = await this.fetchImpl(`${this.baseUrl}/api/get-balance?api_key=${encodeURIComponent(this.apiKey)}`);
    const body = (await res.json().catch(() => null)) as {
      balance?: number;
      currency?: string;
      message?: string;
    } | null;
    if (!res.ok) throw new Error(`Termii answered ${res.status}: ${body?.message ?? 'no details'}`);
    return `Connected. Balance: ${body?.balance ?? '?'} ${body?.currency ?? ''}`.trim();
  }
}

/** Statuses Africa's Talking gives a recipient whose message it accepted: processed, sent, queued. */
const AT_ACCEPTED = new Set([100, 101, 102]);

/**
 * Africa's Talking SMS (https://api.africastalking.com/version1/messaging). The username "sandbox" uses
 * their sandbox. The sender ID is optional: without one, their shared short code sends.
 */
export class AfricasTalkingMessagingAdapter implements MessagingAdapter {
  readonly name = 'africastalking';
  private readonly base: string;

  constructor(
    private readonly username: string,
    private readonly apiKey: string,
    private readonly senderId?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base =
      username.toLowerCase() === 'sandbox'
        ? 'https://api.sandbox.africastalking.com'
        : 'https://api.africastalking.com';
  }

  private headers() {
    return { apikey: this.apiKey, accept: 'application/json' };
  }

  async sendOtp(phone: string, code: string, ttlSeconds: number) {
    const body = new URLSearchParams({
      username: this.username,
      to: phone,
      message: otpText(code, ttlSeconds),
      bulkSMSMode: '1',
      ...(this.senderId ? { from: this.senderId } : {}),
    });
    const res = await this.fetchImpl(`${this.base}/version1/messaging`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/x-www-form-urlencoded' },
      body,
    }).catch(() => null);
    const json = res
      ? ((await res.json().catch(() => null)) as {
          SMSMessageData?: { Recipients?: Array<{ statusCode?: number; status?: string }> };
        } | null)
      : null;
    const recipient = json?.SMSMessageData?.Recipients?.[0];
    if (!res || res.status !== 201 || !recipient || !AT_ACCEPTED.has(Number(recipient.statusCode))) {
      throw unavailable('sms_failed', 'We could not send the code. Try again in a moment.');
    }
  }

  /** For the panel's Test button: the account and its balance. Sends nothing. */
  async check() {
    const res = await this.fetchImpl(`${this.base}/version1/user?username=${encodeURIComponent(this.username)}`, {
      headers: this.headers(),
    });
    const body = (await res.json().catch(() => null)) as { UserData?: { balance?: string } } | null;
    if (!res.ok) throw new Error(`Africa's Talking answered ${res.status}`);
    return `Connected. Balance: ${body?.UserData?.balance ?? 'not shown'}`;
  }
}
