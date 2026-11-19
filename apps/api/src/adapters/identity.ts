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
}

/** passed, failed, or retry: unclear, to be taken again without counting as a failure. */
export interface SelfieResult {
  status: 'pending' | 'done';
  outcome?: 'passed' | 'failed' | 'retry';
  note?: string;
}

/**
 * What the agent app's copy of the provider's SDK needs to take a selfie for one check: whose enrolled face
 * it is compared with, our reference for the check, and for Smile ID a short-lived token Smile ID issued for
 * that person and that product only.
 */
export interface SelfieSession {
  enrolledId: string;
  reference: string;
  token?: string;
  partnerId?: string;
  sandbox?: boolean;
  /** Jiffo's privacy notice, which the app shows before the selfie, as the notice the agent agrees to. */
  privacyPolicyUrl?: string;
}

/** A selfie verdict the provider sent to its webhook, confirmed with it: for which enrolled person. */
export interface SelfieVerdict extends SelfieResult {
  enrolledId: string;
  /** The provider's id for the job, used once. */
  jobId: string;
  /** When the provider says the job was made, to refuse one older than the check. */
  createdAt?: Date;
}

/** A signed result from a provider's webhook: an identity check's, or an agent's selfie check's. */
export type ParsedWebhook =
  | { kind?: 'identity'; reference: string; result: IdentityResult; replayKey?: string }
  /** A selfie check's verdict: for our check's reference, or with none, for the person it names. */
  | { kind: 'selfie'; reference: string | null; verdict: SelfieVerdict; replayKey?: string };

export interface AddressResult {
  status: 'pending' | 'done';
  outcome?: CheckOutcome;
  note?: string;
}

export interface IdentityAdapter {
  readonly name: string;
  /**
   * How the person takes part. "numbers": the app asks for the ID number and runs the provider's screens
   * (the development stand-in). "hosted": the provider's own web page asks for everything, and the app opens
   * it at `url`.
   */
  readonly flow: 'numbers' | 'hosted';
  /** The IDs it checks, each with a selfie matched to the ID's photo (from the shared catalogue). */
  readonly idTypes: readonly IdType[];
  /** Whether it can check a BVN in the same check as another ID. */
  readonly bvnAlongside: boolean;
  /** Starts the identity check under our reference. The numbers come only in the "numbers" flow. */
  startIdentity(input: {
    person: IdentityPerson;
    reference: string;
    request: IdentityRequest;
    idNumber?: string;
    bvn?: string;
  }): Promise<{ reference: string; sdkToken?: string; url?: string }>;
  identityResult(reference: string): Promise<IdentityResult>;
  /** Starts the address check, or hands it to our team for a provider that doesn't check addresses. */
  startAddress(input: { person: IdentityPerson; address: string; state: string }): Promise<{ reference: string }>;
  addressResult(reference: string): Promise<AddressResult>;
  /**
   * Starts an agent's selfie check, taken in the agent app with the provider's own SDK and compared with the
   * face the provider kept from the person's first check (docs/security-plan.md, I2, I8). `enrolledId` is
   * that first check's reference. Only a provider that keeps the face has it: Smile ID.
   */
  startSelfie?(input: { enrolledId: string; reference: string }): Promise<SelfieSession>;
  /**
   * A selfie check's verdict, for a provider that gives it when asked. Smile ID's comes only to its webhook,
   * which says what kind of job it was; its status API doesn't, so it isn't asked.
   */
  selfieResult?(input: { enrolledId: string; reference: string }): Promise<SelfieResult>;
  /**
   * A job's verdict asked of the provider, for one its webhook already showed to be a selfie check of the
   * right kind but still running then. Null when the provider doesn't know the job.
   */
  selfieJob?(jobId: string): Promise<SelfieVerdict | null>;
  /**
   * A result the provider sent us, once its signature shows it came from them; null when it doesn't. May ask
   * the provider to confirm it, and throws IdentityProviderError when it can't, so the provider sends it again.
   */
  /**
   * A signed result from the provider. A provider whose signature doesn't cover the body gives a replay key
   * (its signature and the job), so the API can make sure it never vouches for a second, different body.
   */
  parseWebhook?(rawBody: Buffer, headers: Headers): Promise<ParsedWebhook | null>;
}

/** References say whose check it is: customers' start with cid-, agents' with jid-. */
export const REFERENCE_PREFIX = { customer: 'cid', agent: 'jid' } as const;
/** An agent's selfie check, after their identity check. */
export const SELFIE_PREFIX = 'sel';

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

  /** The verdicts the next selfie checks get, in order; passed once these run out. */
  readonly selfieOutcomes: Array<'passed' | 'failed' | 'retry'> = [];

  async startSelfie(input: { enrolledId: string; reference: string }): Promise<SelfieSession> {
    return { enrolledId: input.enrolledId, reference: input.reference };
  }

  async selfieResult(): Promise<SelfieResult> {
    return { status: 'done', outcome: this.selfieOutcomes.shift() ?? 'passed' };
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

/**
 * Identity providers Jiffo used to support. Only Smile ID can re-check a selfie against the face it kept, so it
 * is the only one now (docs/security-plan.md, I8).
 */
export const RETIRED_IDENTITY_PROVIDERS: readonly string[] = ['dojah', 'youverify'];

/**
 * Finishes what was left running with a retired provider, which can't be asked any more: an identity check ends
 * as failed, so the person checks again with the provider in use, and an address goes to our team, as Smile
 * ID's do. Nothing new starts with it.
 */
export class RetiredIdentityAdapter implements IdentityAdapter {
  readonly flow = 'hosted' as const;
  readonly idTypes: readonly IdType[] = [];
  readonly bvnAlongside = false;
  constructor(readonly name: string) {}
  startIdentity(): Promise<never> {
    return Promise.reject(new IdentityUnavailable());
  }
  async identityResult(): Promise<IdentityResult> {
    return {
      status: 'done',
      outcome: 'failed',
      checks: [
        { key: 'selfie', outcome: 'failed', note: 'Checked with a service Jiffo no longer uses. Check your ID again.' },
      ],
    };
  }
  startAddress(): Promise<never> {
    return Promise.reject(new IdentityUnavailable());
  }
  async addressResult(): Promise<AddressResult> {
    return { status: 'done', outcome: 'review', note: 'Our team confirms the address at review' };
  }
}

export class IdentityUnavailable extends Error {
  constructor() {
    super('No identity provider is set up');
  }
}
