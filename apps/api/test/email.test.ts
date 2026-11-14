import { describe, expect, it } from 'vitest';
import {
  ConsoleEmailAdapter,
  MemoryEmailAdapter,
  PostmarkEmailAdapter,
  ResendEmailAdapter,
} from '../src/adapters/email';
import { testEmail } from '../src/admin/providers-admin.service';
import { StaffMail } from '../src/admin/staff-mail';
import { loadConfig } from '../src/config/app-config';
import { envAdapters } from '../src/providers/env-adapters';
import { NotConfiguredEmail } from '../src/providers/not-configured';
import type { ProvidersService } from '../src/providers/providers.service';
import { BUILDERS, sender } from '../src/providers/builders';

type Call = { url: string; init: RequestInit };
function fakeFetch(respond: (call: Call) => Response) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL, init: RequestInit = {}) => {
    const call = { url: String(url), init };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { impl, calls };
}
const message = { to: 'ada@jiffoapp.com', subject: 'Your invite to Jiffo Admin', text: 'Hi Ada,\nhttps://x/invite#t' };
const ctx = { production: true } as never;

describe('email adapters', () => {
  it('sends through Resend as plain text, to the one address', async () => {
    const { impl, calls } = fakeFetch(() => Response.json({ id: 'em_1' }));
    await new ResendEmailAdapter('re_key', 'Jiffo <team@jiffoapp.com>', impl).send(message);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      from: 'Jiffo <team@jiffoapp.com>',
      to: ['ada@jiffoapp.com'],
      subject: message.subject,
      text: message.text,
    });
  });

  it('sends through Postmark on the transactional stream', async () => {
    const { impl, calls } = fakeFetch(() => Response.json({ ErrorCode: 0, Message: 'OK' }));
    await new PostmarkEmailAdapter('pm_token', 'team@jiffoapp.com', impl).send(message);
    expect(calls[0]!.url).toBe('https://api.postmarkapp.com/email');
    expect((calls[0]!.init.headers as Record<string, string>)['x-postmark-server-token']).toBe('pm_token');
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      From: 'team@jiffoapp.com',
      To: 'ada@jiffoapp.com',
      TextBody: message.text,
      MessageStream: 'outbound',
    });
  });

  it('says what the provider refused, without the link', async () => {
    const { impl } = fakeFetch(() => Response.json({ message: 'The from domain is not verified' }, { status: 403 }));
    const sending = new ResendEmailAdapter('re_key', 'team@jiffoapp.com', impl).send(message);
    await expect(sending).rejects.toThrow('Resend refused the email (403): The from domain is not verified');
    await expect(sending).rejects.not.toThrow(/invite#/);
  });

  it('treats a sending-only Resend key as working', async () => {
    const { impl } = fakeFetch(() =>
      Response.json({ name: 'restricted_api_key', message: 'This API key is restricted' }, { status: 401 }),
    );
    await expect(new ResendEmailAdapter('re_key', 'team@jiffoapp.com', impl).check()).resolves.toMatch(/can only send/);
    const { impl: bad } = fakeFetch(() => Response.json({ name: 'validation_error' }, { status: 401 }));
    await expect(new ResendEmailAdapter('re_key', 'team@jiffoapp.com', bad).check()).rejects.toThrow(/refused the key/);
  });
});

describe('email provider settings', () => {
  it('takes a sender as an address, or a name and an address, on one line', () => {
    expect(sender(' team@jiffoapp.com ')).toBe('team@jiffoapp.com');
    expect(sender('Jiffo <team@jiffoapp.com>')).toBe('Jiffo <team@jiffoapp.com>');
    for (const bad of [
      '',
      'jiffo',
      'team@jiffoapp.com\r\nBcc: someone@elsewhere.test',
      'Jiffo <team@jiffoapp.com>\nBcc: x@y.z',
      'a@b.c, other@elsewhere.test',
      'Jiffo <team@jiffoapp.com',
    ]) {
      expect(() => sender(bad), bad).toThrow(/Send from/);
    }
  });

  it('builds each provider from the panel, and checks the SES region', () => {
    expect(BUILDERS.email.resend!({ apiKey: 'k', from: 'team@jiffoapp.com' }, ctx).name).toBe('resend');
    expect(BUILDERS.email.postmark!({ serverToken: 't', from: 'team@jiffoapp.com' }, ctx).name).toBe('postmark');
    const ses = { accessKeyId: 'AK', secretAccessKey: 'S', from: 'team@jiffoapp.com' };
    expect(BUILDERS.email.ses!({ ...ses, region: 'eu-west-1' }, ctx).name).toBe('ses');
    for (const region of ['evil.example.com', 'eu-west-1.evil', 'eu west 1', '']) {
      expect(() => BUILDERS.email.ses!({ ...ses, region }, ctx), region).toThrow(/AWS region/);
    }
  });
});

describe('staff email', () => {
  const providers = (over: Partial<Record<'activeProvider' | 'fromSettings' | 'current', unknown>>) =>
    ({
      activeProvider: () => null,
      fromSettings: () => null,
      current: () => new MemoryEmailAdapter(),
      ...over,
    }) as unknown as ProvidersService;

  /** The error code ready() refuses with, or null when it gives an adapter. */
  const refusal = (mail: StaffMail) => {
    try {
      mail.ready();
      return null;
    } catch (error) {
      return (error as { getResponse(): { error: { code: string } } }).getResponse().error.code;
    }
  };

  it("says email isn't set up before anything is saved", () => {
    expect(refusal(new StaffMail(providers({ current: () => new NotConfiguredEmail() })))).toBe('email_not_configured');
  });

  it("never falls back to the stand-in when the provider switched on can't be loaded", () => {
    const current = () => new ConsoleEmailAdapter();
    const broken = new StaffMail(providers({ activeProvider: () => 'resend', fromSettings: () => null, current }));
    expect(refusal(broken)).toBe('email_failed');
    const resend = new ResendEmailAdapter('k', 'team@jiffoapp.com');
    const working = new StaffMail(providers({ activeProvider: () => 'resend', fromSettings: () => resend, current }));
    expect(working.ready()).toBe(resend);
  });

  it('sends a test email to whoever presses Test, proving the sender works', async () => {
    const memory = new MemoryEmailAdapter();
    await expect(testEmail(memory, 'owner@jiffoapp.com')).resolves.toMatch(/sent to owner@jiffoapp.com/);
    expect(memory.lastTo('owner@jiffoapp.com')?.subject).toBe('Jiffo Admin: email test');
    memory.failNext = new Error('Resend refused the email (403): domain not verified');
    await expect(testEmail(memory, 'owner@jiffoapp.com')).rejects.toThrow(/domain not verified/);
  });

  it('can send nothing outside production, for shared servers such as staging', () => {
    const base = {
      DATABASE_URL: 'postgres://x',
      JWT_SECRET: 'a'.repeat(64),
      OTP_SECRET: 'b'.repeat(64),
      PIN_KEY: 'c'.repeat(64),
    };
    expect(envAdapters(loadConfig({ ...base, EMAIL_PROVIDER: 'none' })).email).toBeInstanceOf(NotConfiguredEmail);
    expect(envAdapters(loadConfig(base)).email).toBeInstanceOf(ConsoleEmailAdapter);
  });
});
