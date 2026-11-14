import { GetAccountCommand, SendEmailCommand, SESv2Client } from '@aws-sdk/client-sesv2';
import { Logger } from '@nestjs/common';
import { providerFetch } from './provider-fetch';

/** One plain-text email. Plain text only: nothing a person typed can turn into markup in someone's inbox. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * Email, for the admin team: invites and access resets go only to the teammate's own address
 * (docs/security-plan.md, D3, finding 10). Each provider (Resend, Postmark, Amazon SES) is one implementation.
 */
export interface EmailAdapter {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

/** Development only: prints the email to the server log. */
export class ConsoleEmailAdapter implements EmailAdapter {
  readonly name = 'console';
  private readonly logger = new Logger('Email');
  async send(m: EmailMessage) {
    this.logger.log(`Email to ${m.to}: ${m.subject}\n${m.text}`);
  }
}

/** Tests: keeps the emails so a test can read them back. */
export class MemoryEmailAdapter implements EmailAdapter {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];
  /** Set by a test to make the next send fail with this error. */
  failNext: Error | null = null;
  async send(m: EmailMessage) {
    const fail = this.failNext;
    this.failNext = null;
    if (fail) throw fail;
    this.sent.push(m);
  }
  lastTo(to: string): EmailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to.toLowerCase());
  }
}

/** What a provider said when it refused, without echoing anything long. */
const refusal = async (name: string, res: Response) => {
  const body = (await res.json().catch(() => null)) as { message?: string; Message?: string } | null;
  const said = (body?.message ?? body?.Message ?? '').slice(0, 200);
  return new Error(`${name} refused the email (${res.status})${said ? `: ${said}` : ''}`);
};

export class ResendEmailAdapter implements EmailAdapter {
  readonly name = 'resend';
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = providerFetch,
  ) {}

  private headers() {
    return { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' };
  }

  async send(m: EmailMessage) {
    const res = await this.fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ from: this.from, to: [m.to], subject: m.subject, text: m.text }),
    });
    if (!res.ok) throw await refusal('Resend', res);
  }

  /** For the panel's Test button. A key that may only send can't list domains, which still proves it works. */
  async check() {
    const res = await this.fetchImpl('https://api.resend.com/domains', { headers: this.headers() });
    const body = (await res.json().catch(() => null)) as {
      data?: Array<{ name: string; status: string }>;
      name?: string;
    } | null;
    if (res.ok) {
      const domains = (body?.data ?? []).map((d) => `${d.name} (${d.status})`).join(', ');
      return `Connected. Domains: ${domains || 'none yet'}`;
    }
    if (body?.name === 'restricted_api_key') return 'Connected. This key can only send, which is all Jiffo needs.';
    throw new Error(`Resend refused the key (${res.status})`);
  }
}

export class PostmarkEmailAdapter implements EmailAdapter {
  readonly name = 'postmark';
  constructor(
    private readonly serverToken: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = providerFetch,
  ) {}

  private headers() {
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-postmark-server-token': this.serverToken,
    };
  }

  async send(m: EmailMessage) {
    const res = await this.fetchImpl('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        From: this.from,
        To: m.to,
        Subject: m.subject,
        TextBody: m.text,
        MessageStream: 'outbound',
      }),
    });
    if (!res.ok) throw await refusal('Postmark', res);
  }

  async check() {
    const res = await this.fetchImpl('https://api.postmarkapp.com/server', { headers: this.headers() });
    if (!res.ok) throw new Error(`Postmark refused the token (${res.status})`);
    const body = (await res.json().catch(() => null)) as { Name?: string } | null;
    return `Connected to the server "${body?.Name ?? '?'}"`;
  }
}

export class SesEmailAdapter implements EmailAdapter {
  readonly name = 'ses';
  private readonly ses: SESv2Client;
  constructor(
    region: string,
    credentials: { accessKeyId: string; secretAccessKey: string },
    private readonly from: string,
  ) {
    this.ses = new SESv2Client({
      region,
      credentials,
      // A timeout on every call, as for other providers (docs/security-plan.md, S9).
      requestHandler: { connectionTimeout: 5_000, requestTimeout: 20_000 },
    });
  }

  async send(m: EmailMessage) {
    await this.ses.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [m.to] },
        Content: {
          Simple: {
            Subject: { Data: m.subject, Charset: 'UTF-8' },
            Body: { Text: { Data: m.text, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  }

  async check() {
    const account = await this.ses.send(new GetAccountCommand({}));
    if (!account.SendingEnabled) return 'Connected, but sending is paused on this account';
    return account.ProductionAccessEnabled
      ? 'Connected. Sending is on.'
      : 'Connected. The account is in the SES sandbox: it can only send to addresses verified in SES.';
  }
}
