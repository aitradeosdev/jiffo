import { randomUUID } from 'node:crypto';
import { ID_TYPE_KEYS, type IdType } from '@jiffo/shared';

/**
 * Identity checks for customers and agents, done by a provider that holds the documents. Jiffo never stores
 * an ID number, a document or a selfie: it starts a check, the person takes part on the provider's screens,
 * and Jiffo keeps only the result, the legal name, the date of birth and a fingerprint of the ID.
 */
export type CheckOutcome = 'passed' | 'failed' | 'review';

/**
 * One check's answer. "id" is the ID the person verifies with, whichever type it is; the API files it under
 * that type. "bvn" is a BVN checked alongside another ID, for agents.
 */
export type CheckKey = 'id' | 'bvn' | 'selfie';

export interface IdentityPerson {
  firstName: string;
  lastName: string;
  phone: string;
}

/** What a check is for: whose it is, the ID they verify with, and whether their BVN is checked as well. */
export interface IdentityRequest {
  role: 'customer' | 'agent';
  idType: IdType;
  withBvn: boolean;
}

export interface IdentityResult {
  status: 'pending' | 'done';
  /** Overall: passed only when every check passed. */
  outcome?: CheckOutcome;
  /** As on the ID's record. */
  legalName?: string;
  /** YYYY-MM-DD, as on the ID's record. */
  dateOfBirth?: string;
  checks: Array<{ key: CheckKey; outcome: CheckOutcome; note?: string }>;
  /**
   * The ID's number as the provider read it, for providers whose own page asks for it. Only ever turned into
   * the fingerprint that stops a second account on the same ID; never stored.
   */
  idNumber?: string;
  /** The ID the person used, from a provider whose page lets them choose (Dojah). */
  idType?: IdType;
}

export interface AddressResult {
  status: 'pending' | 'done';
  outcome?: CheckOutcome;
  note?: string;
}

/** What a page Jiffo serves for a provider sends back: the numbers the person typed, and the provider's session. */
export interface PageInput {
  idNumber: string;
  bvn?: string;
  session?: string;
  sessionSig?: string;
}

export interface IdentityAdapter {
  readonly name: string;
  /**
   * How the person takes part. "numbers": the app asks for the ID number and runs the provider's screens
   * (the development stand-in). "hosted": a web page (the provider's, or one Jiffo serves for it) asks for
   * everything, and the app opens it at `url`.
   */
  readonly flow: 'numbers' | 'hosted';
  /** The IDs it checks, each with a selfie matched to the ID's photo (from the shared catalogue). */
  readonly idTypes: readonly IdType[];
  /** Whether it can check a BVN in the same check as another ID. */
  readonly bvnAlongside: boolean;
  /** Whether the person picks their ID on the provider's page, as set up in its dashboard. */
  readonly idChosenOnPage: boolean;
  /** Starts the identity check under our reference. The numbers come only in the "numbers" flow. */
  startIdentity(input: {
    person: IdentityPerson;
    reference: string;
    request: IdentityRequest;
    idNumber?: string;
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
  /**
   * A signed result from the provider. A provider whose signature doesn't cover the body gives a replay key
   * (its signature and the job), so the API can make sure it never vouches for a second, different body.
   */
  parseWebhook?(
    rawBody: Buffer,
    headers: Headers,
  ): Promise<{ reference: string; result: IdentityResult; replayKey?: string } | null>;
  /** For providers whose widget runs in a page Jiffo serves: that page, for the check as started. */
  page?(reference: string, request: IdentityRequest): string | Promise<string>;
  /**
   * For a page Jiffo serves that sends what the person entered back to the API (Youverify's): runs the check
   * with it and gives the result. The numbers are passed on, never kept.
   */
  submitPage?(reference: string, request: IdentityRequest, input: PageInput): Promise<IdentityResult>;
}

/** References say whose check it is: customers' start with cid-, agents' with jid-. */
export const REFERENCE_PREFIX = { customer: 'cid', agent: 'jid' } as const;
export const referenceRole = (reference: string | undefined): 'customer' | 'agent' =>
  reference?.startsWith(`${REFERENCE_PREFIX.customer}-`) ? 'customer' : 'agent';

export type Headers = Record<string, string | string[] | undefined>;
export const headerOf = (headers: Headers, name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};

export const IDENTITY = Symbol('IDENTITY');

/**
 * For development and tests: checks finish at once. The ID number's last four characters pick the result, so
 * every path can be tried: 0000 fails the ID, 1111 sends the selfie to review, 2222 fails the selfie (the ID's
 * record is found), 1818 is someone under 18.
 * An address containing "unknown" goes to review.
 */
export class FakeIdentityAdapter implements IdentityAdapter {
  readonly name = 'fake';
  readonly flow = 'numbers' as const;
  readonly idTypes = ID_TYPE_KEYS;
  readonly bvnAlongside = true;
  readonly idChosenOnPage = false;
  private readonly identities = new Map<string, IdentityResult>();
  private readonly addresses = new Map<string, AddressResult>();

  async startIdentity(input: {
    person: IdentityPerson;
    reference: string;
    request: IdentityRequest;
    idNumber?: string;
    bvn?: string;
  }) {
    const reference = input.reference;
    const ending = (input.idNumber ?? '').slice(-4);
    const checks: IdentityResult['checks'] = [
      {
        key: 'id',
        outcome: ending === '0000' ? 'failed' : 'passed',
        note: ending === '0000' ? 'No record for this ID' : undefined,
      },
      ...(input.request.withBvn && input.request.idType !== 'bvn'
        ? [{ key: 'bvn' as const, outcome: 'passed' as const }]
        : []),
      {
        key: 'selfie',
        outcome: ending === '1111' ? 'review' : ending === '2222' ? 'failed' : 'passed',
        note:
          ending === '1111'
            ? 'Selfie did not clearly match the ID photo'
            : ending === '2222'
              ? "Selfie doesn't match the ID photo"
              : undefined,
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
  readonly idTypes: readonly IdType[] = [];
  readonly bvnAlongside = false;
  readonly idChosenOnPage = false;
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
