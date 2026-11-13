import { createHmac } from 'node:crypto';
import { safeEqual } from '../common/crypto';
import {
  headerOf,
  type AddressResult,
  type CheckOutcome,
  type Headers,
  type IdentityAdapter,
  type IdentityPerson,
  type IdentityResult,
} from './identity';

/** What a provider adapter needs from the API around it. */
export interface ProviderContext {
  /** The API's public address, for callbacks and pages. */
  publicApiUrl: string;
  /** Signs a short text with a key only the API holds, for links it hands out. */
  sign(text: string): string;
}

/** How long a request to an identity provider may take. */
const TIMEOUT_MS = 20_000;

/** An identity provider refused or failed a request. */
export class IdentityProviderError extends Error {}

/** Where the provider's page sends the agent when they finish: back into the agent app. */
export const identityDoneUrl = (ctx: ProviderContext) => `${ctx.publicApiUrl}/v1/identity/done`;

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

const overall = (checks: IdentityResult['checks']): CheckOutcome =>
  checks.some((c) => c.outcome === 'failed')
    ? 'failed'
    : checks.some((c) => c.outcome === 'review')
      ? 'review'
      : 'passed';

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
  partner_params?: { user_id?: string; job_id?: string; reference?: string };
  id_fields?: {
    first_name?: string;
    other_names?: string;
    last_name?: string;
    full_name?: string;
    date_of_birth?: string;
    id_number?: string;
  } | null;
}

export class SmileIdIdentityAdapter implements IdentityAdapter {
  readonly name = 'smileid';
  readonly flow = 'hosted' as const;
  private readonly base: string;

  constructor(
    private readonly partnerId: string,
    private readonly apiKey: string,
    sandbox: boolean,
    /** Jiffo's privacy notice, which Smile ID shows the agent before they agree. */
    private readonly privacyPolicyUrl: string,
    private readonly ctx: ProviderContext,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = sandbox ? 'https://testapi.smileidentity.com' : 'https://api.smileidentity.com';
  }

  private async token() {
    const res = await this.fetchImpl(`${this.base}/v3/token`, {
      method: 'POST',
      headers: { 'smileid-partner-id': this.partnerId, 'smileid-api-key': this.apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: Error) => {
      throw new IdentityProviderError(`Smile ID didn't answer: ${error.message}`);
    });
    const json = (await res.json().catch(() => null)) as { token?: string; message?: string } | null;
    if (!res.ok || !json?.token)
      throw new IdentityProviderError(`Smile ID refused the keys: ${json?.message ?? res.status}`);
    return json.token;
  }

  async startIdentity(input: { person: IdentityPerson; reference: string }) {
    const token = await this.token();
    const form = new FormData();
    const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' });
    form.append('id_types', json([{ country: 'NG', id_type: 'NIN_V2', verification_method: 'biometric_kyc' }]));
    form.append('name', 'Jiffo agent identity check');
    form.append('notice_privacy_policy_url', this.privacyPolicyUrl);
    form.append('is_single_use', 'true');
    form.append('callback_url', `${this.ctx.publicApiUrl}/v1/webhooks/identity/smileid`);
    form.append('redirect_url', identityDoneUrl(this.ctx));
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
  async parseWebhook(rawBody: Buffer, headers: Headers) {
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
      // One Biometric KYC answer covers both: the NIN record and the selfie against its photo.
      checks: [
        { key: 'nin', outcome, ...(note ? { note } : {}) },
        { key: 'selfie', outcome, ...(note ? { note } : {}) },
      ],
      idNumber: fields?.id_number,
    };
    return { reference, result };
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
    } | null;
    if (res.status === 202) return { status: 'processing', user_id: json?.user_id, message: json?.message };
    if (!res.ok || !json?.status)
      throw new IdentityProviderError(`Smile ID couldn't say how the check went: ${res.status}`);
    return json;
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

interface DojahVerification {
  reference_id?: string;
  verification_status?: string;
  data?: {
    government_data?: {
      status?: boolean;
      data?: {
        nin?: { entity?: DojahPerson } | null;
        bvn?: { entity?: DojahPerson } | null;
      };
    } | null;
    selfie?: { status?: boolean } | null;
  };
}
interface DojahPerson {
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  date_of_birth?: string;
  nin?: string;
}

/**
 * Dojah EasyOnboard. Its widget, set up in the Dojah dashboard with the government ID (NIN, and BVN if you
 * add it) and selfie steps, runs in a page this API serves; the result is read back by our reference, or
 * arrives by webhook signed with the webhook secret. Address checks are Dojah's agent visits.
 */
export class DojahIdentityAdapter implements IdentityAdapter {
  readonly name = 'dojah';
  readonly flow = 'hosted' as const;
  private readonly base: string;

  constructor(
    private readonly appId: string,
    private readonly secretKey: string,
    /** The public key, for the widget in the browser. */
    private readonly publicKey: string,
    private readonly widgetId: string,
    private readonly webhookSecret: string,
    sandbox: boolean,
    private readonly ctx: ProviderContext,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = sandbox ? 'https://sandbox.dojah.io' : 'https://api.dojah.io';
  }

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: T | null }> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: this.secretKey,
        AppId: this.appId,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: Error) => {
      throw new IdentityProviderError(`Dojah didn't answer: ${error.message}`);
    });
    return { status: res.status, json: (await res.json().catch(() => null)) as T | null };
  }

  /** The page the app opens: Jiffo's address, signed so only links the API made are served. */
  async startIdentity(input: { reference: string }) {
    const ref = encodeURIComponent(input.reference);
    return {
      reference: input.reference,
      url: `${this.ctx.publicApiUrl}/v1/identity/hosted/dojah?ref=${ref}&sig=${this.ctx.sign(`dojah:${input.reference}`)}`,
    };
  }

  /** The widget page, opened in the app's browser; when Dojah is done it goes back to the app. */
  page(reference: string) {
    const options = {
      app_id: this.appId,
      p_key: this.publicKey,
      type: 'custom',
      config: { widget_id: this.widgetId },
      reference_id: reference,
    };
    const done = identityDoneUrl(this.ctx);
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Identity check</title><script src="https://widget.dojah.io/widget.js"></script></head>
<body style="font-family:system-ui,sans-serif;padding:24px"><p>Opening the identity check…</p>
<script>
var options = ${JSON.stringify(options).replace(/</g, '\\u003c')};
options.onSuccess = function () { location.href = ${JSON.stringify(done)}; };
options.onClose = function () { location.href = ${JSON.stringify(done)}; };
options.onError = function () { location.href = ${JSON.stringify(done)}; };
var connect = new Connect(options);
connect.setup();
connect.open();
</script></body></html>`;
  }

  async identityResult(reference: string): Promise<IdentityResult> {
    const { status, json } = await this.call<{ entity?: DojahVerification } & DojahVerification>(
      'GET',
      `/api/v1/kyc/verification?reference_id=${encodeURIComponent(reference)}`,
    );
    if (status === 404) return { status: 'pending', checks: [] };
    if (status >= 400 || !json) throw new IdentityProviderError(`Dojah answered ${status}`);
    return this.toResult(json.entity ?? json);
  }

  /** Dojah's result as the core sees it. Completed means finished, not passed: each step is looked at. */
  private toResult(v: DojahVerification): IdentityResult {
    const state = v.verification_status;
    if (!state || state === 'Ongoing' || state === 'Pending') return { status: 'pending', checks: [] };
    if (state === 'Abandoned') {
      const note = 'The check was left before it finished';
      return {
        status: 'done',
        outcome: 'failed',
        checks: [
          { key: 'nin', outcome: 'failed', note },
          { key: 'selfie', outcome: 'failed', note },
        ],
      };
    }
    const gov = v.data?.government_data;
    const person = gov?.data?.nin?.entity ?? gov?.data?.bvn?.entity;
    const step = (ok: boolean | undefined, note: string) =>
      ok === true ? { outcome: 'passed' as const } : { outcome: 'review' as const, note };
    const checks: IdentityResult['checks'] = [
      { key: 'nin', ...step(gov?.status && !!gov.data?.nin, 'NIN not confirmed by Dojah') },
      { key: 'selfie', ...step(v.data?.selfie?.status, 'Selfie not confirmed by Dojah') },
    ];
    if (gov?.data?.bvn) checks.push({ key: 'bvn', ...step(gov.status, 'BVN not confirmed by Dojah') });
    const outcome = state === 'Completed' ? overall(checks) : 'review';
    return {
      status: 'done',
      outcome,
      legalName: legalNameOf([person?.first_name, person?.middle_name, person?.last_name]),
      dateOfBirth: isoDate(person?.date_of_birth),
      checks,
      idNumber: gov?.data?.nin?.entity?.nin,
    };
  }

  /** Signed as Dojah documents: hex HMAC-SHA256 of the raw body, keyed with the webhook secret. */
  async parseWebhook(rawBody: Buffer, headers: Headers) {
    const signature = headerOf(headers, 'x-dojah-signature');
    if (!signature || !this.webhookSecret) return null;
    const expected = createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
    if (!safeEqual(signature, expected)) return null;
    const body = JSON.parse(rawBody.toString('utf8')) as DojahVerification;
    if (!body.reference_id) return null;
    return { reference: body.reference_id, result: this.toResult(body) };
  }

  /** Dojah sends someone to the address. It needs the LGA; the agent's area stands in for it. */
  async startAddress(input: { person: IdentityPerson; address: string; state: string; area?: string }) {
    const local = input.person.phone.replace(/^\+234/, '0');
    const { status, json } = await this.call<{ entity?: { reference_id?: string }; error?: string }>(
      'POST',
      '/api/v1/kyc/address',
      {
        first_name: input.person.firstName,
        last_name: input.person.lastName,
        mobile: local,
        street: input.address,
        lga: input.area ?? input.state,
        state: input.state,
      },
    );
    const reference = json?.entity?.reference_id;
    if (status >= 400 || !reference)
      throw new IdentityProviderError(`Dojah didn't start the address check: ${json?.error ?? status}`);
    return { reference };
  }

  async addressResult(reference: string): Promise<AddressResult> {
    const { status, json } = await this.call<{ entity?: { status?: string } }>(
      'GET',
      `/api/v1/kyc/address?reference_id=${encodeURIComponent(reference)}`,
    );
    if (status >= 400 || !json?.entity?.status) throw new IdentityProviderError(`Dojah answered ${status}`);
    const state = json.entity.status;
    if (/^pending$/i.test(state)) return { status: 'pending' };
    if (/^(verified|successful|success)$/i.test(state)) return { status: 'done', outcome: 'passed' };
    // Any other answer from the visit: our team looks at it in Dojah's dashboard.
    return { status: 'done', outcome: 'review', note: `Dojah's visit: ${state}` };
  }

  /** For the panel's Test button: the wallet balance. Checks no one. */
  async check() {
    const { status, json } = await this.call<{ entity?: { wallet_balance?: string } }>('GET', '/api/v1/balance');
    if (status >= 400) throw new Error(`Dojah answered ${status}`);
    return `Connected. Balance: ₦${json?.entity?.wallet_balance ?? '?'}`;
  }
}
