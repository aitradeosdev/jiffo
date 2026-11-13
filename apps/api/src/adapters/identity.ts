import { randomUUID } from 'node:crypto';

/**
 * Identity checks for agents, done by a provider (QoreID in the prototypes) that holds the documents. Jiffo
 * never stores a NIN, BVN or selfie: it starts a check, the app runs the provider's SDK for the parts that
 * need the person (the BVN approval with NIBSS and the selfie), and Jiffo keeps only the result, the legal
 * name and the date of birth.
 */
export type CheckOutcome = 'passed' | 'failed' | 'review';

export interface IdentityPerson {
  firstName: string;
  lastName: string;
  phone: string;
}

export interface IdentityResult {
  status: 'pending' | 'done';
  /** Overall: passed only when every check passed. */
  outcome?: CheckOutcome;
  /** As on the NIN record. */
  legalName?: string;
  /** YYYY-MM-DD, as on the NIN record. */
  dateOfBirth?: string;
  checks: Array<{ key: 'nin' | 'bvn' | 'selfie'; outcome: CheckOutcome; note?: string }>;
  /**
   * The NIN as the provider read it, for providers whose own page asks for it. Only ever turned into the
   * fingerprint that stops a second account on the same NIN; never stored.
   */
  idNumber?: string;
}

export interface AddressResult {
  status: 'pending' | 'done';
  outcome?: CheckOutcome;
  note?: string;
}

/** What a page Jiffo serves for a provider sends back: the NIN the agent typed, and the provider's session. */
export interface PageInput {
  nin: string;
  session?: string;
  sessionSig?: string;
}

export interface IdentityAdapter {
  readonly name: string;
  /**
   * How the agent takes part. "numbers": the app asks for the NIN and BVN and runs the provider's screens
   * (the development stand-in). "hosted": the provider's own web page asks for everything, and the app
   * opens it at `url`.
   */
  readonly flow: 'numbers' | 'hosted';
  /** Starts the identity checks under our reference. */
  startIdentity(input: {
    person: IdentityPerson;
    reference: string;
    nin?: string;
    bvn?: string;
  }): Promise<{ reference: string; sdkToken?: string; url?: string }>;
  identityResult(reference: string): Promise<IdentityResult>;
  /** Starts the address check; a provider may send someone to visit. */
  startAddress(input: {
    person: IdentityPerson;
    address: string;
    state: string;
    area?: string;
  }): Promise<{ reference: string }>;
  addressResult(reference: string): Promise<AddressResult>;
  /**
   * A result the provider sent us, once its signature shows it came from them; null when it doesn't. May ask
   * the provider to confirm it, and throws IdentityProviderError when it can't, so the provider sends it again.
   */
  parseWebhook?(rawBody: Buffer, headers: Headers): Promise<{ reference: string; result: IdentityResult } | null>;
  /** For providers whose widget runs in a page Jiffo serves: that page. */
  page?(reference: string): string | Promise<string>;
  /**
   * For a page Jiffo serves that sends what the agent entered back to the API (Youverify's): runs the check
   * with it and gives the result. The NIN is passed on, never kept.
   */
  submitPage?(reference: string, input: PageInput): Promise<IdentityResult>;
}

export type Headers = Record<string, string | string[] | undefined>;
export const headerOf = (headers: Headers, name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export const IDENTITY = Symbol('IDENTITY');

/**
 * For development and tests: checks finish at once. The NIN's last four digits pick the result, so every
 * path can be tried: 0000 fails the NIN, 1111 sends the selfie to review, 1818 is someone under 18.
 * An address containing "unknown" goes to review.
 */
export class FakeIdentityAdapter implements IdentityAdapter {
  readonly name = 'fake';
  readonly flow = 'numbers' as const;
  private readonly identities = new Map<string, IdentityResult>();
  private readonly addresses = new Map<string, AddressResult>();

  async startIdentity(input: { person: IdentityPerson; reference: string; nin?: string; bvn?: string }) {
    const reference = input.reference;
    const ending = (input.nin ?? '').slice(-4);
    const checks: IdentityResult['checks'] = [
      {
        key: 'nin',
        outcome: ending === '0000' ? 'failed' : 'passed',
        note: ending === '0000' ? 'No record for this NIN' : undefined,
      },
      { key: 'bvn', outcome: 'passed' },
      {
        key: 'selfie',
        outcome: ending === '1111' ? 'review' : 'passed',
        note: ending === '1111' ? 'Selfie did not clearly match the ID photo' : undefined,
      },
    ];
    const outcome: CheckOutcome = checks.some((c) => c.outcome === 'failed')
      ? 'failed'
      : checks.some((c) => c.outcome === 'review')
        ? 'review'
        : 'passed';
    this.identities.set(reference, {
      status: 'done',
      outcome,
      legalName: `${input.person.firstName} ${input.person.lastName}`.toUpperCase(),
      dateOfBirth:
        ending === '1818' ? new Date(Date.now() - 16 * 365.25 * 86_400_000).toISOString().slice(0, 10) : '1995-04-12',
      checks,
    });
    return { reference, sdkToken: `fake_sdk_${randomUUID()}` };
  }

  async identityResult(reference: string): Promise<IdentityResult> {
    return this.identities.get(reference) ?? { status: 'pending', checks: [] };
  }

  async startAddress(input: { person: IdentityPerson; address: string; state: string }) {
    const reference = `fake_addr_${randomUUID()}`;
    const unclear = /unknown/i.test(input.address);
    this.addresses.set(reference, {
      status: 'done',
      outcome: unclear ? 'review' : 'passed',
      note: unclear ? 'The address could not be confirmed' : undefined,
    });
    return { reference };
  }

  async addressResult(reference: string): Promise<AddressResult> {
    return this.addresses.get(reference) ?? { status: 'pending' };
  }
}

/**
 * What production gets until a real provider is set up: every check is refused, so no agent is ever approved
 * by the fake, and the rest of the API still runs.
 */
export class UnconfiguredIdentityAdapter implements IdentityAdapter {
  readonly name = 'none';
  readonly flow = 'numbers' as const;
  private refuse(): never {
    throw new IdentityUnavailable();
  }
  startIdentity(): Promise<never> {
    return Promise.resolve().then(() => this.refuse());
  }
  identityResult(): Promise<never> {
    return Promise.resolve().then(() => this.refuse());
  }
  startAddress(): Promise<never> {
    return Promise.resolve().then(() => this.refuse());
  }
  addressResult(): Promise<never> {
    return Promise.resolve().then(() => this.refuse());
  }
}

export class IdentityUnavailable extends Error {
  constructor() {
    super('No identity provider is set up');
  }
}
