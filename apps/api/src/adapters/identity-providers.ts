import { providerFetch } from './provider-fetch';
import { createHmac } from 'node:crypto';
import { safeEqual } from '../common/crypto';
import {
  headerOf,
  type AddressResult,
  type CheckOutcome,
  type Headers,
  type IdentityAdapter,
  type IdentityPerson,
  type IdentityRequest,
  type IdentityResult,
  type ParsedWebhook,
  type SelfieSession,
  SELFIE_PREFIX,
} from './identity';
import { providerInfo, type IdType } from '@jiffo/shared';

/** What a provider checks, from the shared catalogue the admin panel shows too. */
const capabilities = (key: string) => {
  const info = providerInfo('identity', key);
  return {
    idTypes: (info?.idTypes ?? []) as readonly IdType[],
    bvnAlongside: info?.bvnAlongside ?? false,
  };
};

/** What a provider adapter needs from the API around it. */
export interface ProviderContext {
  /** The API's public address, for callbacks and the page that sends the person back to their app. */
  publicApiUrl: string;
  /** Running in production, where providers' sandbox modes are refused. */
  production: boolean;
}

/** How long a request to an identity provider may take. */
const TIMEOUT_MS = 20_000;

/** An identity provider refused or failed a request. */
export class IdentityProviderError extends Error {}

/** Where the provider's page sends the person when they finish: back into their app. */
export const identityDoneUrl = (ctx: ProviderContext, role: IdentityRequest['role']) =>
  `${ctx.publicApiUrl}/v1/identity/done?for=${role}`;

/** A legal name in one form, whatever parts the provider gives. */
const legalNameOf = (parts: Array<string | null | undefined>) =>
  parts
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .toUpperCase() || undefined;

/** A date of birth as YYYY-MM-DD, from that form or DD-MM-YYYY; undefined when it can't be read. */
export function isoDate(text: string | null | undefined) {
  if (!text) return undefined;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{2})[-/](\d{2})[-/](\d{4})$/.exec(text.trim());
  return dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : undefined;
}

/** Addresses this provider doesn't check: support looks at them, with the rest of the application. */
const ADDRESS_BY_SUPPORT: AddressResult = {
  status: 'done',
  outcome: 'review',
  note: "This provider doesn't check addresses; our team does",
};

/** How old a Smile ID callback's signed timestamp may be. Their signature doesn't cover the body. */
const SMILE_CALLBACK_MAX_AGE_MS = 30 * 60_000;

/**
 * Smile ID (v3): Biometric KYC with the NIN, on a Smile Link: their hosted page asks for the NIN and takes
 * a selfie with a liveness check. The result arrives by webhook, and its verdict is confirmed with their
 * status API, which carries no names. They don't check addresses.
 */
interface SmileCallback {
  timestamp?: string;
  signature?: string;
  job_id?: string;
  /** On a SmartSelfie Authentication's callback, smart_selfie_authentication. */
  product?: string;
  partner_params?: { user_id?: string; job_id?: string; reference?: string; job_type?: number | string };
  id_fields?: {
    first_name?: string;
    other_names?: string;
    last_name?: string;
    full_name?: string;
    date_of_birth?: string;
    id_number?: string;
  } | null;
}

/** Each ID as Smile ID names it, and how it is checked: against the issuer's photo, or the document's. */
const SMILE_ID_TYPES: Record<IdType, { id_type: string; verification_method: string }> = {
  nin: { id_type: 'NIN_V2', verification_method: 'biometric_kyc' },
  bvn: { id_type: 'BVN', verification_method: 'biometric_kyc' },
  voters_card: { id_type: 'VOTER_ID', verification_method: 'biometric_kyc' },
  drivers_licence: { id_type: 'DRIVERS_LICENSE', verification_method: 'document_verification' },
  passport: { id_type: 'PASSPORT', verification_method: 'document_verification' },
};

export class SmileIdIdentityAdapter implements IdentityAdapter {
  readonly name = 'smileid';
  readonly flow = 'hosted' as const;
  readonly idTypes = capabilities('smileid').idTypes;
  readonly bvnAlongside = capabilities('smileid').bvnAlongside;
  private readonly base: string;

  constructor(
    private readonly partnerId: string,
    private readonly apiKey: string,
    sandbox: boolean,
    /** Jiffo's privacy notice, which Smile ID shows the agent before they agree. */
    private readonly privacyPolicyUrl: string,
    private readonly ctx: ProviderContext,
    private readonly fetchImpl: typeof fetch = providerFetch,
  ) {
    this.base = sandbox ? 'https://testapi.smileidentity.com' : 'https://api.smileidentity.com';
  }

  /** A v3 token: for our own calls, or with `scope` one limited to a person and a product, for the app's SDK. */
  private async token(scope?: FormData) {
    const res = await this.fetchImpl(`${this.base}/v3/token`, {
      method: 'POST',
      headers: { 'smileid-partner-id': this.partnerId, 'smileid-api-key': this.apiKey },
      ...(scope ? { body: scope } : {}),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: Error) => {
      throw new IdentityProviderError(`Smile ID didn't answer: ${error.message}`);
    });
    const json = (await res.json().catch(() => null)) as { token?: string; message?: string } | null;
    if (!res.ok || !json?.token)
      throw new IdentityProviderError(`Smile ID refused the keys: ${json?.message ?? res.status}`);
    return json.token;
  }

  async startIdentity(input: { person: IdentityPerson; reference: string; request: IdentityRequest }) {
    if (input.request.withBvn && input.request.idType !== 'bvn') {
      throw new IdentityProviderError("Smile ID can't check a BVN alongside another ID");
    }
    const token = await this.token();
    const form = new FormData();
    const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });
    // One ID per link: the one the person chose in the app, so the result is known to be for it.
    form.append('id_types', json([{ country: 'NG', ...SMILE_ID_TYPES[input.request.idType] }]));
    form.append('name', 'Jiffo identity check');
    form.append('notice_privacy_policy_url', this.privacyPolicyUrl);
    form.append('is_single_use', 'true');
    form.append('callback_url', `${this.ctx.publicApiUrl}/v1/webhooks/identity/smileid`);
    form.append('redirect_url', identityDoneUrl(this.ctx, input.request.role));
    form.append('user_id', input.reference);
    form.append('partner_params', json({ reference: input.reference }));
    const res = await this.fetchImpl(`${this.base}/v3/smile_links`, {
      method: 'POST',
      headers: { 'SmileID-Partner-ID': this.partnerId, 'SmileID-Token': token },
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: Error) => {
      throw new IdentityProviderError(`Smile ID didn't answer: ${error.message}`);
    });
    const body = (await res.json().catch(() => null)) as { link?: string; message?: string } | null;
    if (!res.ok || !body?.link)
      throw new IdentityProviderError(`Smile ID didn't make the link: ${body?.message ?? res.status}`);
    return { reference: input.reference, url: body.link };
  }

  /** Results come by webhook only; until one has, the check is still running. */
  async identityResult(): Promise<IdentityResult> {
    return { status: 'pending', checks: [] };
  }

  /**
   * Signed as Smile ID documents: base64 HMAC-SHA256, keyed with our API key, of the Response-Timestamp
   * header, our partner ID and "sid_request" (older callbacks carry the two in the body). That signature
   * covers no part of the body, so the timestamp must be recent, and the verdict is not taken from the body:
   * Smile ID's status API is asked for this job, which must belong to the same check. The legal name, date
   * of birth and NIN come from the body, as the status API doesn't give them.
   */
  async parseWebhook(rawBody: Buffer, headers: Headers): Promise<ParsedWebhook | null> {
    let body: SmileCallback;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as SmileCallback;
    } catch {
      return null;
    }
    const timestamp = headerOf(headers, 'response-timestamp') ?? body.timestamp;
    const signature = headerOf(headers, 'response-signature') ?? body.signature;
    if (!timestamp || !signature) return null;
    const expected = createHmac('sha256', this.apiKey)
      .update(`${timestamp}${this.partnerId}sid_request`)
      .digest('base64');
    if (!safeEqual(signature, expected)) return null;
    const signedAt = Date.parse(timestamp);
    if (!Number.isFinite(signedAt) || Math.abs(Date.now() - signedAt) > SMILE_CALLBACK_MAX_AGE_MS) return null;
    const reference = body.partner_params?.reference ?? body.partner_params?.user_id;
    const jobId = headerOf(headers, 'smileid-job-id') ?? body.job_id ?? body.partner_params?.job_id;
    if (!reference || !jobId || !/^[\w-]{1,100}$/.test(jobId)) return null;
    if (reference.startsWith(`${SELFIE_PREFIX}-`)) return this.selfieVerdict(body, reference, jobId, signature);

    const job = await this.jobStatus(jobId);
    if (!job || job.user_id !== reference) return null;
    if (job.status === 'processing') return { reference, result: { status: 'pending', checks: [] } as IdentityResult };
    // clear: passed. block: the ID or the face didn't match. error: the check couldn't be finished, and is
    // best done again. attention: a person should look.
    const outcome: CheckOutcome =
      job.status === 'clear' ? 'passed' : job.status === 'block' || job.status === 'error' ? 'failed' : 'review';
    const note = outcome === 'passed' ? undefined : (job.message ?? job.status);
    const fields = body.id_fields ?? undefined;
    const result: IdentityResult = {
      status: 'done',
      outcome,
      legalName:
        fields?.full_name?.toUpperCase() ?? legalNameOf([fields?.first_name, fields?.other_names, fields?.last_name]),
      dateOfBirth: isoDate(fields?.date_of_birth),
      // One answer covers both: the ID's record or document, and the selfie against its photo.
      checks: [
        { key: 'id', outcome, ...(note ? { note } : {}) },
        { key: 'selfie', outcome, ...(note ? { note } : {}) },
      ],
      idNumber: fields?.id_number,
    };
    // The signature covers only the timestamp, so the API accepts it, for this job, with this body only.
    return { reference, result, replayKey: `${signature}:${jobId}` };
  }

  /**
   * An agent's selfie check. The body names the product, which must be SmartSelfie Authentication: any other
   * job run under the check, such as a compare of two photos the app chose, says nothing about the face
   * Smile ID kept, so it fails. The verdict, the person and the job's time come from the status API.
   */
  private async selfieVerdict(
    body: SmileCallback,
    reference: string,
    jobId: string,
    signature: string,
  ): Promise<ParsedWebhook | null> {
    const job = await this.jobStatus(jobId);
    if (!job?.user_id) return null;
    const replayKey = `${signature}:${jobId}`;
    const createdAt = job.created_at ? new Date(job.created_at) : undefined;
    const base = { enrolledId: job.user_id, jobId, ...(createdAt && !isNaN(+createdAt) ? { createdAt } : {}) };
    const authentication =
      body.product === 'smart_selfie_authentication' &&
      (body.partner_params?.job_type === undefined || String(body.partner_params.job_type) === '2');
    if (!authentication) {
      const note = 'The selfie was not checked against your kept face';
      return { kind: 'selfie', reference, replayKey, verdict: { status: 'done', outcome: 'failed', note, ...base } };
    }
    if (job.status === 'processing')
      return { kind: 'selfie', reference, replayKey, verdict: { status: 'pending', ...base } };
    // clear: the face matched. block: it didn't. error or attention: unclear, so it's taken again.
    const outcome = job.status === 'clear' ? 'passed' : job.status === 'block' ? 'failed' : 'retry';
    const note = outcome === 'passed' ? undefined : (job.message ?? job.status);
    return {
      kind: 'selfie',
      reference,
      replayKey,
      verdict: { status: 'done', outcome, ...(note ? { note } : {}), ...base },
    };
  }

  /** A job's verdict from Smile ID itself; null when they don't know the job. */
  private async jobStatus(jobId: string) {
    const token = await this.token();
    const res = await this.fetchImpl(`${this.base}/v3/status/${encodeURIComponent(jobId)}`, {
      headers: { 'SmileID-Partner-ID': this.partnerId, 'SmileID-Token': token },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: Error) => {
      throw new IdentityProviderError(`Smile ID didn't answer: ${error.message}`);
    });
    if (res.status === 404) return null;
    const json = (await res.json().catch(() => null)) as {
      status?: string;
      user_id?: string;
      message?: string;
      created_at?: string;
    } | null;
    if (res.status === 202) return { ...json, status: 'processing' };
    if (!res.ok || !json?.status)
      throw new IdentityProviderError(`Smile ID couldn't say how the check went: ${res.status}`);
    return json;
  }

  /**
   * A SmartSelfie Authentication the agent app runs with Smile ID's SDK, against the face kept from the
   * agent's first check, whose reference is the enrolled user id (docs/security-plan.md, I2, I8). The SDK
   * needs a token, which reaches the phone, so it is one Smile ID limits to that person and that product,
   * for 15 minutes. It never allows a new enrolment: without that, Smile ID never replaces the kept face. The
   * callback address and our reference are fixed in it, and the verdict comes to the webhook.
   */
  async startSelfie(input: { enrolledId: string; reference: string }): Promise<SelfieSession> {
    const scope = new FormData();
    const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });
    scope.append('user_id', input.enrolledId);
    scope.append('product', 'smart_selfie_authentication');
    scope.append('partner_params', json({ reference: input.reference }));
    scope.append('payload', json({ callback_url: `${this.ctx.publicApiUrl}/v1/webhooks/identity/smileid` }));
    const token = await this.token(scope);
    return {
      enrolledId: input.enrolledId,
      reference: input.reference,
      token,
      partnerId: this.partnerId,
      sandbox: this.base.includes('testapi'),
    };
  }

  async startAddress(input: { person: IdentityPerson }) {
    return { reference: `support:${input.person.phone}` };
  }

  async addressResult(): Promise<AddressResult> {
    return ADDRESS_BY_SUPPORT;
  }

  /** For the panel's Test button: the keys get a token. */
  async check() {
    await this.token();
    return 'Connected. Smile ID accepted the keys.';
  }
}
