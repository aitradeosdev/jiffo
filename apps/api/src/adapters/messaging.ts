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
