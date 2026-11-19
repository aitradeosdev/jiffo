import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ParsedWebhook } from '../src/adapters/identity';
import { isoDate, SmileIdIdentityAdapter } from '../src/adapters/identity-providers';

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
const ctx = { publicApiUrl: 'https://api.jiffo.test', production: false };
const person = { firstName: 'Tunde', lastName: 'Bakare', phone: '+2348031234567' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** An identity check's result from a parsed webhook. */
const resultOf = (parsed: ParsedWebhook | null) => (parsed && parsed.kind !== 'selfie' ? parsed.result : undefined);

describe('Smile ID', () => {
  const make = (impl: typeof fetch) =>
    new SmileIdIdentityAdapter('1234', 'smile-key', true, 'https://jiffo.test/privacy', ctx, impl);

  it('makes a single-use Smile Link for Biometric KYC with the NIN, coming back to the app', async () => {
    const { impl, calls } = fakeFetch(({ url }) =>
      url.endsWith('/v3/token')
        ? json({ token: 'jwt-1' })
        : json({ link: 'https://links.smile.test/abc', ref_id: 'r' }, 201),
    );
    const nin = { role: 'agent', idType: 'nin', withBvn: false } as const;
    expect(await make(impl).startIdentity({ person, reference: 'jid-1', request: nin })).toEqual({
      reference: 'jid-1',
      url: 'https://links.smile.test/abc',
    });
    expect(calls[0]!.url).toBe('https://testapi.smileidentity.com/v3/token');
    expect(calls[0]!.init.headers).toMatchObject({ 'smileid-partner-id': '1234', 'smileid-api-key': 'smile-key' });
    expect(calls[1]!.url).toBe('https://testapi.smileidentity.com/v3/smile_links');
    expect(calls[1]!.init.headers).toMatchObject({ 'SmileID-Partner-ID': '1234', 'SmileID-Token': 'jwt-1' });
    const form = calls[1]!.init.body as FormData;
    expect(JSON.parse(await (form.get('id_types') as Blob).text())).toEqual([
      { country: 'NG', id_type: 'NIN_V2', verification_method: 'biometric_kyc' },
    ]);
    expect(form.get('is_single_use')).toBe('true');
    expect(form.get('user_id')).toBe('jid-1');
    expect(form.get('callback_url')).toBe('https://api.jiffo.test/v1/webhooks/identity/smileid');
    expect(form.get('redirect_url')).toBe('https://api.jiffo.test/v1/identity/done?for=agent');
    expect(form.get('notice_privacy_policy_url')).toBe('https://jiffo.test/privacy');
  });

  it('leaves addresses to the team, without asking Smile ID', async () => {
    const { impl, calls } = fakeFetch(() => json({}));
    const smile = make(impl);
    expect(await smile.startAddress({ person })).toEqual({ reference: 'support:+2348031234567' });
    expect(await smile.addressResult()).toMatchObject({ status: 'done', outcome: 'review' });
    expect(calls).toHaveLength(0);
  });

  describe('results', () => {
    const fields = {
      first_name: 'Tunde',
      other_names: 'Ade',
      last_name: 'Bakare',
      date_of_birth: '1995-04-12',
      id_number: '12345678901',
    };
    const callback = (status: string, extra: object = {}) =>
      Buffer.from(JSON.stringify({ status, partner_params: { user_id: 'jid-1' }, id_fields: fields, ...extra }));
    const signed = (at = new Date()) => {
      const timestamp = at.toISOString();
      return {
        'response-timestamp': timestamp,
        'response-signature': createHmac('sha256', 'smile-key').update(`${timestamp}1234sid_request`).digest('base64'),
        'smileid-job-id': 'job_01',
      };
    };
    /** Smile ID's own answer for the job, whatever the callback's body says. */
    const withStatus = (job: object, status = 200) =>
      fakeFetch(({ url }) => (url.endsWith('/v3/token') ? json({ token: 'jwt-1' }) : json(job, status)));

    it('takes the verdict from their status API, for a callback signed with our key just now', async () => {
      const { impl, calls } = withStatus({ status: 'clear', job_id: 'job_01', user_id: 'jid-1' });
      expect(await make(impl).parseWebhook(callback('clear'), signed())).toEqual({
        reference: 'jid-1',
        result: {
          status: 'done',
          outcome: 'passed',
          legalName: 'TUNDE ADE BAKARE',
          dateOfBirth: '1995-04-12',
          checks: [
            { key: 'id', outcome: 'passed' },
            { key: 'selfie', outcome: 'passed' },
          ],
          idNumber: '12345678901',
        },
        // Given back so the API can refuse it, for this job, with any other body.
        replayKey: expect.stringMatching(/:job_01$/),
      });
      expect(calls[1]!.url).toBe('https://testapi.smileidentity.com/v3/status/job_01');
      expect(calls[1]!.init.headers).toMatchObject({ 'SmileID-Partner-ID': '1234', 'SmileID-Token': 'jwt-1' });
    });

    it("doesn't believe the body: the status API's verdict wins", async () => {
      const blocked = withStatus({ status: 'block', user_id: 'jid-1', message: 'Face did not match' });
      expect(resultOf(await make(blocked.impl).parseWebhook(callback('clear'), signed()))).toMatchObject({
        outcome: 'failed',
        checks: [{ key: 'id', outcome: 'failed', note: 'Face did not match' }, expect.anything()],
      });
      const look = withStatus({ status: 'attention', user_id: 'jid-1' });
      expect(resultOf(await make(look.impl).parseWebhook(callback('clear'), signed()))?.outcome).toBe('review');
      const running = withStatus({ status: 'processing', user_id: 'jid-1' }, 202);
      expect(resultOf(await make(running.impl).parseWebhook(callback('clear'), signed()))?.status).toBe('pending');
    });

    it('refuses forged, old or misdirected callbacks', async () => {
      const ok = withStatus({ status: 'clear', user_id: 'jid-1' });
      const smile = make(ok.impl);
      expect(await smile.parseWebhook(callback('clear'), { ...signed(), 'response-signature': 'forged' })).toBeNull();
      // A signature from an hour ago could be one seen before.
      expect(await smile.parseWebhook(callback('clear'), signed(new Date(Date.now() - 3_600_000)))).toBeNull();
      // A job of another check.
      const other = withStatus({ status: 'clear', user_id: 'jid-someone-else' });
      expect(await make(other.impl).parseWebhook(callback('clear'), signed())).toBeNull();
      const unknown = withStatus({ message: 'not found' }, 404);
      expect(await make(unknown.impl).parseWebhook(callback('clear'), signed())).toBeNull();
      // Smile ID out of reach: an error, so the callback is answered 503 and sent again.
      const down = withStatus({}, 500);
      await expect(make(down.impl).parseWebhook(callback('clear'), signed())).rejects.toThrow(/Smile ID/);
      // Older callbacks carry the signature in the body.
      const { 'response-timestamp': timestamp, 'response-signature': signature } = signed();
      expect(
        (await smile.parseWebhook(callback('clear', { timestamp, signature, job_id: 'job_01' }), {}))?.reference,
      ).toBe('jid-1');
    });
  });
});

describe('dates of birth', () => {
  it('are read in either order', () => {
    expect(isoDate('1995-04-12')).toBe('1995-04-12');
    expect(isoDate('12-04-1995')).toBe('1995-04-12');
    expect(isoDate('April')).toBeUndefined();
  });
});

describe('Smile ID selfie checks, for agents (I8)', () => {
  const make = (impl: typeof fetch) =>
    new SmileIdIdentityAdapter('1234', 'smile-key', true, 'https://jiffo.test/privacy', ctx, impl);
  const signed = () => {
    const timestamp = new Date().toISOString();
    return {
      'response-timestamp': timestamp,
      'response-signature': createHmac('sha256', 'smile-key').update(`${timestamp}1234sid_request`).digest('base64'),
      'smileid-job-id': 'job_01hx',
    };
  };
  const callback = (product: string, extra: object = {}) =>
    Buffer.from(
      JSON.stringify({
        product,
        status: 'clear',
        partner_params: { reference: 'sel-1', job_type: product === 'smart_selfie_authentication' ? 2 : 6 },
        ...extra,
      }),
    );
  const withStatus = (job: object, status = 200) =>
    fakeFetch(({ url }) => (url.endsWith('/v3/token') ? json({ token: 'jwt-1' }) : json(job, status)));

  it('gives the app a token only for this person and SmartSelfie Authentication, never a new enrolment', async () => {
    const { impl, calls } = fakeFetch(() => json({ token: 'jwt-scoped' }));
    expect(await make(impl).startSelfie({ enrolledId: 'jid-1', reference: 'sel-1' })).toEqual({
      enrolledId: 'jid-1',
      reference: 'sel-1',
      token: 'jwt-scoped',
      partnerId: '1234',
      sandbox: true,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://testapi.smileidentity.com/v3/token');
    const form = calls[0]!.init.body as FormData;
    expect(form.get('user_id')).toBe('jid-1');
    expect(form.get('product')).toBe('smart_selfie_authentication');
    expect(form.get('allow_new_enroll')).toBe('false');
    expect(form.get('use_enrolled_image')).toBeNull();
    expect(JSON.parse(await (form.get('partner_params') as Blob).text())).toEqual({ reference: 'sel-1' });
    expect(JSON.parse(await (form.get('payload') as Blob).text())).toEqual({
      callback_url: 'https://api.jiffo.test/v1/webhooks/identity/smileid',
    });
  });

  it("takes the selfie's verdict, person and time from the status API", async () => {
    const at = '2026-11-19T10:00:00Z';
    const clear = withStatus({ status: 'clear', user_id: 'jid-1', created_at: at });
    expect(await make(clear.impl).parseWebhook(callback('smart_selfie_authentication'), signed())).toEqual({
      kind: 'selfie',
      reference: 'sel-1',
      replayKey: expect.stringMatching(/:job_01hx$/),
      verdict: { status: 'done', outcome: 'passed', enrolledId: 'jid-1', jobId: 'job_01hx', createdAt: new Date(at) },
    });
    // The body said clear; Smile ID's own answer wins.
    const blocked = withStatus({ status: 'block', user_id: 'jid-1', message: 'Face did not match' });
    expect(await make(blocked.impl).parseWebhook(callback('smart_selfie_authentication'), signed())).toMatchObject({
      verdict: { outcome: 'failed', note: 'Face did not match' },
    });
    const unclear = withStatus({ status: 'error', user_id: 'jid-1' });
    expect(await make(unclear.impl).parseWebhook(callback('smart_selfie_authentication'), signed())).toMatchObject({
      verdict: { outcome: 'retry' },
    });
    const running = withStatus({ status: 'processing', user_id: 'jid-1' }, 202);
    expect(await make(running.impl).parseWebhook(callback('smart_selfie_authentication'), signed())).toMatchObject({
      verdict: { status: 'pending' },
    });
  });

  it('fails any other job run under the check, such as a compare of two photos the app chose', async () => {
    const clear = withStatus({ status: 'clear', user_id: 'jid-1' });
    expect(await make(clear.impl).parseWebhook(callback('smart_selfie_compare'), signed())).toMatchObject({
      kind: 'selfie',
      verdict: { status: 'done', outcome: 'failed' },
    });
    expect(
      await make(clear.impl).parseWebhook(
        callback('smart_selfie_authentication', { partner_params: { reference: 'sel-1', job_type: 4 } }),
        signed(),
      ),
    ).toMatchObject({ verdict: { outcome: 'failed' } });
    // Unsigned, it says nothing at all.
    expect(
      await make(clear.impl).parseWebhook(callback('smart_selfie_authentication'), {
        ...signed(),
        'response-signature': 'forged',
      }),
    ).toBeNull();
  });
});
