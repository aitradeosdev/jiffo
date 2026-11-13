import { createHmac, randomUUID } from 'node:crypto';
import { safeEqual } from '../common/crypto';
import {
  headerOf,
  type AddressResult,
  type CheckOutcome,
  type Headers,
  type IdentityAdapter,
  type IdentityPerson,
  type IdentityResult,
  type PageInput,
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

/** What the agent sent from a provider's page can't be used; the message says what to do. */
export class IdentityPageError extends Error {}

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

/** Youverify's liveness check for the browser, pinned, and checked against this hash when it loads. */
const YOUVERIFY_LIVENESS_SCRIPT = {
  src: 'https://unpkg.com/youverify-liveness-web@1.2.3/dist/index.umd.cjs',
  integrity: 'sha384-EYCLcgCiqUaHbqIIrBh8NRWMvGeQpV2WRaX0eJ5gneRwqGt+mpp+H0WwljtXMMgd',
};
/** How long a liveness session lasts once the page is open (Youverify allows up to 10 minutes). */
const YOUVERIFY_SESSION_SECONDS = 600;

interface YouverifyNin {
  status?: string;
  reason?: string | null;
  selfieValidation?: boolean;
  /** Where some of Youverify's answers put the face match instead. */
  validations?: { selfie?: { selfieVerification?: { match?: boolean } } };
  firstName?: string;
  middleName?: string;
  lastName?: string;
  dateOfBirth?: string;
  idNumber?: string;
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Youverify: their liveness check in a page Jiffo serves, then their NIN check with face match. The page
 * asks for the NIN and runs the liveness check, and sends the NIN and the liveness session to the API. The
 * API asks Youverify for that session's result and passes Youverify's own link to the selfie into the NIN
 * check, so the selfie never passes through Jiffo. They don't check addresses here: their visits need the
 * address in parts (building number, street, landmark) the app doesn't ask for, so the team checks them.
 */
export class YouverifyIdentityAdapter implements IdentityAdapter {
  readonly name = 'youverify';
  readonly flow = 'hosted' as const;
  private readonly base: string;

  constructor(
    private readonly secretKey: string,
    /** The public merchant key, for starting liveness sessions; Youverify makes it public by design. */
    private readonly publicMerchantKey: string,
    private readonly sandbox: boolean,
    private readonly ctx: ProviderContext,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.base = sandbox ? 'https://api.sandbox.youverify.co' : 'https://api.youverify.co';
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method,
      headers: { token: this.secretKey, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch((error: Error) => {
      throw new IdentityProviderError(`Youverify didn't answer: ${error.message}`);
    });
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; message?: string } | null;
    // A refusal can come with a 200 too, such as an empty wallet: success false.
    if (!res.ok || !json || json.success === false) {
      throw new IdentityProviderError(`Youverify answered ${res.status}: ${json?.message ?? ''}`);
    }
    return json.data as T;
  }

  /** The page the app opens: Jiffo's address, signed so only links the API made are served. */
  async startIdentity(input: { reference: string }) {
    const ref = encodeURIComponent(input.reference);
    return {
      reference: input.reference,
      url: `${this.ctx.publicApiUrl}/v1/identity/hosted/youverify?ref=${ref}&sig=${this.ctx.sign(`youverify:${input.reference}`)}`,
    };
  }

  /** A liveness session for one page: its id, and a token for the browser to start it with. */
  private async newSession(reference: string) {
    const session = await this.call<{ sessionId?: string }>('POST', '/v2/api/identity/sdk/session/generate', {
      publicMerchantID: this.publicMerchantKey,
      ttlSeconds: YOUVERIFY_SESSION_SECONDS,
      metadata: { reference },
    });
    const token = await this.call<{ authToken?: string }>('POST', '/v2/api/identity/sdk/liveness/token', {
      publicMerchantID: this.publicMerchantKey,
      deviceCorrelationId: randomUUID(),
    });
    if (!session?.sessionId || !token?.authToken) throw new IdentityProviderError("Youverify didn't start a session");
    return { sessionId: session.sessionId, sessionToken: token.authToken };
  }

  /**
   * The page: the NIN, then Youverify's liveness check. On success it sends the NIN and the session (signed
   * by the API, so only a session started here counts), never the selfie the check hands back to the page.
   */
  async page(reference: string) {
    const { sessionId, sessionToken } = await this.newSession(reference);
    const options = {
      sessionId,
      sessionToken,
      // Tags the result with Jiffo's account, so the API finds it by session afterwards.
      publicKey: this.publicMerchantKey,
      sandboxEnvironment: this.sandbox,
      // The SDK won't start without at least one task.
      tasks: [{ id: 'complete-the-circle' }],
      branding: { name: 'Jiffo' },
    };
    const submit = {
      url: `${this.ctx.publicApiUrl}/v1/identity/hosted/youverify/submit`,
      ref: reference,
      sig: this.ctx.sign(`youverify:${reference}`),
      session: sessionId,
      sessionSig: this.ctx.sign(`youverify-session:${reference}:${sessionId}`),
      done: identityDoneUrl(this.ctx),
    };
    const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Check your identity</title>
<style>
body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px;background:#fff;color:#0b0b0b}
h1{font-size:28px;line-height:1.15;margin:24px 0 8px}p{color:#555;line-height:1.45;margin:8px 0}
label{display:block;font-weight:600;margin:28px 0 8px}
input{width:100%;box-sizing:border-box;font-size:20px;letter-spacing:2px;padding:14px;border:1px solid #ccc;border-radius:12px;background:inherit;color:inherit}
button{width:100%;margin-top:24px;padding:16px;font-size:17px;font-weight:600;border:0;border-radius:14px;background:#0b0b0b;color:#fff}
button:disabled{opacity:.4}.note{font-size:13px;color:#777}.error{color:#c0262d;min-height:1em}
@media (prefers-color-scheme:dark){body{background:#0b0b0b;color:#f2f2f2}p{color:#aaa}input{border-color:#333}button{background:#f2f2f2;color:#0b0b0b}}
</style></head>
<body>
<h1>Check your identity</h1>
<p>Enter your NIN, then take a selfie. Youverify checks them with NIMC.</p>
<label for="nin">National Identification Number</label>
<input id="nin" inputmode="numeric" autocomplete="off" placeholder="11 digits">
<p class="note">On your NIN slip or card, or dial *346# to see it.</p>
<p class="note">By continuing you agree to Youverify checking your NIN with NIMC and taking a selfie to match your ID photo.</p>
<p id="error" class="error" role="alert"></p>
<button id="go" disabled>Take selfie</button>
<script src="${escapeHtml(YOUVERIFY_LIVENESS_SCRIPT.src)}" integrity="${YOUVERIFY_LIVENESS_SCRIPT.integrity}" crossorigin="anonymous"></script>
<script>
var options = ${json(options)};
var submit = ${json(submit)};
var nin = document.getElementById('nin'), go = document.getElementById('go'), error = document.getElementById('error');
var say = function (text) { error.textContent = text; };
// After a liveness check passed, the button sends the result again rather than starting another check.
var passed = false;
nin.addEventListener('input', function () {
  nin.value = nin.value.replace(/[^0-9]/g, '').slice(0, 11);
  go.disabled = nin.value.length !== 11;
});
if (window.YouverifyLiveness && YouverifyLiveness.preload) YouverifyLiveness.preload();
var send = function () {
  go.disabled = true; nin.disabled = true; say('Checking…');
  var timeout = window.AbortSignal && AbortSignal.timeout ? AbortSignal.timeout(90000) : undefined;
  fetch(submit.url, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: timeout, body: JSON.stringify({
    ref: submit.ref, sig: submit.sig, nin: nin.value, session: submit.session, sessionSig: submit.sessionSig
  }) }).then(function (res) {
    if (res.ok) { location.href = submit.done; return; }
    return res.json().catch(function () { return null; }).then(function (body) {
      var problem = body && body.error;
      if (problem && problem.code === 'identity_changed') { location.href = submit.done; return; }
      // A NIN typed wrong: the selfie check still stands, so the agent corrects it and sends again.
      if (problem && problem.code === 'invalid_nin') nin.disabled = false;
      say((problem && problem.message) || "That didn't go through. Send it again.");
      go.disabled = false;
    });
  }).catch(function () { say("That didn't go through. Check your connection and send it again."); go.disabled = false; });
};
options.onSuccess = function () {
  // The selfie stays with Youverify: only the NIN and the session go to Jiffo.
  passed = true; go.textContent = 'Send again'; send();
};
options.onFailure = function (data) {
  var key = data && data.error && data.error.key;
  // A session that ran out: the page starts a new one.
  if (key === 'invalid_or_expired_session' || key === 'session_token_error') { location.reload(); return; }
  say("The selfie check didn't pass. Tap Take selfie to try again, in good light, facing the camera.");
  go.dataset.fresh = 'reload';
};
go.addEventListener('click', function () {
  if (passed) { send(); return; }
  // A new try after a failed check needs a new session, which a reload starts.
  if (go.dataset.fresh === 'reload') { location.reload(); return; }
  if (!window.YouverifyLiveness) { say("The selfie check couldn't load. Check your connection and try again."); return; }
  say('');
  Promise.resolve()
    .then(function () { return new YouverifyLiveness(options).start(); })
    .catch(function () { say("The selfie check couldn't start. Try again."); });
});
</script></body></html>`;
  }

  /** Results come from the page; until it has sent one, the check is still running. */
  async identityResult(): Promise<IdentityResult> {
    return { status: 'pending', checks: [] };
  }

  /** The liveness result for a session, asked of Youverify a few times while it settles. */
  private async liveness(sessionId: string) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const found = await this.call<{ docs?: Array<{ sessionId?: string; passed?: boolean; faceImage?: string }> }>(
        'GET',
        `/v2/api/identity/liveness?sessionId=${encodeURIComponent(sessionId)}&limit=1`,
      );
      const doc = found?.docs?.find((d) => d.sessionId === sessionId);
      if (doc) return doc;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    throw new IdentityProviderError('Youverify has no selfie check for this session yet');
  }

  async submitPage(reference: string, input: PageInput): Promise<IdentityResult> {
    const session = input.session ?? '';
    const expected = this.ctx.sign(`youverify-session:${reference}:${session}`);
    if (!session || !input.sessionSig || !safeEqual(input.sessionSig, expected)) {
      throw new IdentityPageError('This selfie check was started elsewhere. Start again.');
    }
    const live = await this.liveness(session);
    if (!live.passed || !live.faceImage) {
      return {
        status: 'done',
        outcome: 'failed',
        checks: [
          { key: 'selfie', outcome: 'failed', note: "The liveness check didn't pass" },
          { key: 'nin', outcome: 'review', note: 'Not checked, as the liveness check failed' },
        ],
      };
    }
    // Youverify's own link to the selfie, from their liveness check: Jiffo never fetches it.
    const nin = await this.call<YouverifyNin>('POST', '/v2/api/identity/ng/nin', {
      id: input.nin,
      isSubjectConsent: true,
      validations: { selfie: { image: live.faceImage } },
    });
    const found = nin?.status === 'found';
    const ninCheck: IdentityResult['checks'][number] = found
      ? { key: 'nin', outcome: 'passed' }
      : nin?.status === 'not_found'
        ? { key: 'nin', outcome: 'failed', note: 'No NIN record found' }
        : { key: 'nin', outcome: 'review', note: `NIMC answered: ${nin?.reason ?? nin?.status ?? 'nothing'}` };
    const matched = nin?.selfieValidation === true || nin?.validations?.selfie?.selfieVerification?.match === true;
    const selfieCheck: IdentityResult['checks'][number] = !found
      ? {
          key: 'selfie',
          outcome: 'review',
          note:
            nin?.status === 'not_found'
              ? 'Not compared, as the NIN record was not found'
              : "Not compared, as NIMC didn't answer",
        }
      : matched
        ? { key: 'selfie', outcome: 'passed' }
        : { key: 'selfie', outcome: 'review', note: "Youverify didn't match the selfie to the NIN photo" };
    const checks = [ninCheck, selfieCheck];
    return {
      status: 'done',
      outcome: overall(checks),
      legalName: found ? legalNameOf([nin.firstName, nin.middleName, nin.lastName]) : undefined,
      dateOfBirth: found ? isoDate(nin.dateOfBirth) : undefined,
      checks,
      idNumber: found ? (nin.idNumber ?? input.nin) : undefined,
    };
  }

  async startAddress(input: { person: IdentityPerson }) {
    return { reference: `support:${input.person.phone}` };
  }

  async addressResult(): Promise<AddressResult> {
    return ADDRESS_BY_SUPPORT;
  }

  /** For the panel's Test button: the secret key reads Youverify's list of states. */
  async check() {
    await this.call('GET', '/v2/api/states');
    return 'Connected. Youverify accepted the secret key.';
  }
}
