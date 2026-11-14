import { providerFetch } from './provider-fetch';
import { Logger } from '@nestjs/common';
import { africasTalkingCheck, africasTalkingVoice, e164Digits, PROVIDER_TIMEOUT_MS } from './africastalking';
import { randomUUID } from 'node:crypto';

/**
 * Masked calls between a customer and their agent. The provider rings the caller's phone and, when they
 * answer, connects them to the other person; each sees only the provider's number. Calls aren't recorded.
 * A call-back on the phone network, rather than a call over data, works on any phone and a weak connection.
 */
export interface CallsAdapter {
  readonly name: string;
  /** Rings `from`, then connects them to `to`. Both are E.164 numbers. */
  bridge(input: { reference: string; from: string; to: string }): Promise<{ providerRef: string }>;
  /**
   * For providers that ask what to do once the caller answers (Africa's Talking calls our callback): the
   * answer that connects the call to `to`. Providers told everything up front (Twilio) don't have this.
   */
  connect?(to: string | null): { contentType: string; body: string };
}

export const CALLS = Symbol('CALLS');

/** "+234 ••• ••• 1902": enough to tell numbers apart in a log, without writing them down. */
const masked = (phone: string) => `${phone.slice(0, 4)} ••• ••• ${phone.slice(-4)}`;

/** For development and tests: no phone rings. The latest calls are kept so tests can see them. */
export class FakeCallsAdapter implements CallsAdapter {
  readonly name = 'fake';
  private readonly logger = new Logger('FakeCalls');
  readonly calls: Array<{ reference: string; from: string; to: string }> = [];

  async bridge(input: { reference: string; from: string; to: string }) {
    this.calls.push(input);
    if (this.calls.length > 100) this.calls.shift();
    this.logger.log(`Call ${input.reference}: ringing ${masked(input.from)}, then ${masked(input.to)}`);
    return { providerRef: `fake_call_${randomUUID()}` };
  }
}

/** Until a provider is set up: every call is refused with a message the apps can show. */
export class UnconfiguredCallsAdapter implements CallsAdapter {
  /** The apps hide the call button when the provider is this one. */
  readonly name = 'none';
  bridge(): Promise<never> {
    return Promise.reject(new CallsUnavailable());
  }
}

export class CallsUnavailable extends Error {
  constructor() {
    super('No calls provider is set up');
  }
}

/** A calls provider refused or failed a request. */
export class CallsProviderError extends Error {}

/**
 * Africa's Talking Voice. We ask it to ring the caller from Jiffo's Africa's Talking number; when they
 * answer, it calls our callback (set on that number in their dashboard), which answers with a Dial to the
 * other person, shown Jiffo's number. Recording is off.
 */
export class AfricasTalkingCallsAdapter implements CallsAdapter {
  readonly name = 'africastalking';

  constructor(
    private readonly username: string,
    private readonly apiKey: string,
    /** Jiffo's voice number with Africa's Talking, in +234… form. */
    private readonly phoneNumber: string,
    private readonly fetchImpl: typeof fetch = providerFetch,
  ) {}

  async bridge(input: { reference: string; from: string; to: string }) {
    const res = await request(this.fetchImpl, "Africa's Talking", `${africasTalkingVoice(this.username)}/call`, {
      method: 'POST',
      headers: { apikey: this.apiKey, accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        username: this.username,
        from: this.phoneNumber,
        to: input.from,
        clientRequestId: input.reference,
      }),
    });
    const json = (await res.json().catch(() => null)) as {
      entries?: Array<{ status?: string; sessionId?: string; errorMessage?: string }>;
      errorMessage?: string;
    } | null;
    const entry = json?.entries?.[0];
    if (!res.ok || !entry?.sessionId || entry.status !== 'Queued') {
      throw new CallsProviderError(
        `Africa's Talking didn't place the call: ${entry?.errorMessage ?? json?.errorMessage ?? res.status}`,
      );
    }
    return { providerRef: entry.sessionId };
  }

  /** With no one to connect (an unknown or ended call), the caller hears why and the call ends. */
  connect(to: string | null) {
    const action = to
      ? `<Dial phoneNumbers="${e164Digits(to)}" callerId="${e164Digits(this.phoneNumber)}" record="false"/>`
      : '<Say>Sorry, this call can no longer be connected. Please use the chat in the Jiffo app.</Say>';
    return {
      contentType: 'application/xml',
      body: `<?xml version="1.0" encoding="UTF-8"?><Response>${action}</Response>`,
    };
  }

  check() {
    return africasTalkingCheck(this.username, this.apiKey, this.fetchImpl);
  }
}

/**
 * Twilio Programmable Voice. One request rings the caller from Jiffo's Twilio number and carries the
 * instructions for when they answer: dial the other person, showing Jiffo's number, without recording.
 */
export class TwilioCallsAdapter implements CallsAdapter {
  readonly name = 'twilio';

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    /** Jiffo's Twilio number, in +… form. */
    private readonly fromNumber: string,
    private readonly fetchImpl: typeof fetch = providerFetch,
  ) {}

  private auth() {
    return `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64')}`;
  }

  async bridge(input: { reference: string; from: string; to: string }) {
    const twiml = `<Response><Dial callerId="${e164Digits(this.fromNumber)}" record="do-not-record"><Number>${e164Digits(input.to)}</Number></Dial></Response>`;
    const res = await request(
      this.fetchImpl,
      'Twilio',
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Calls.json`,
      {
        method: 'POST',
        headers: { authorization: this.auth(), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: input.from, From: this.fromNumber, Twiml: twiml }),
      },
    );
    const json = (await res.json().catch(() => null)) as { sid?: string; message?: string } | null;
    if (!res.ok || !json?.sid)
      throw new CallsProviderError(`Twilio didn't place the call: ${json?.message ?? res.status}`);
    return { providerRef: json.sid };
  }

  /** For the panel's Test button: the account exists and is active. Rings no one. */
  async check() {
    const res = await this.fetchImpl(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}.json`,
      { headers: { authorization: this.auth() }, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) },
    );
    const json = (await res.json().catch(() => null)) as { status?: string; message?: string } | null;
    if (!res.ok) throw new Error(`Twilio answered ${res.status}: ${json?.message ?? 'no details'}`);
    if (json?.status !== 'active') throw new Error(`The Twilio account is ${json?.status ?? 'not active'}`);
    return 'Connected. The account is active.';
  }
}

/** A request to a calls provider, with a time limit; no answer at all is the provider failing too. */
async function request(fetchImpl: typeof fetch, who: string, url: string, init: RequestInit) {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS) });
  } catch (error) {
    throw new CallsProviderError(`${who} didn't answer: ${(error as Error).message}`);
  }
}
