import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DojahIdentityAdapter,
  IdentityPageError,
  isoDate,
  SmileIdIdentityAdapter,
  YouverifyIdentityAdapter,
} from '../src/adapters/identity-providers';

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
const ctx = { publicApiUrl: 'https://api.jiffo.test', sign: (text: string) => `sig(${text})` };
const person = { firstName: 'Tunde', lastName: 'Bakare', phone: '+2348031234567' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Smile ID', () => {
  const make = (impl: typeof fetch) =>
    new SmileIdIdentityAdapter('1234', 'smile-key', true, 'https://jiffo.test/privacy', ctx, impl);

  it('makes a single-use Smile Link for Biometric KYC with the NIN, coming back to the app', async () => {
    const { impl, calls } = fakeFetch(({ url }) =>
      url.endsWith('/v3/token')
        ? json({ token: 'jwt-1' })
        : json({ link: 'https://links.smile.test/abc', ref_id: 'r' }, 201),
    );
    const nin = { idType: 'nin', withBvn: false } as const;
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
      });
      expect(calls[1]!.url).toBe('https://testapi.smileidentity.com/v3/status/job_01');
      expect(calls[1]!.init.headers).toMatchObject({ 'SmileID-Partner-ID': '1234', 'SmileID-Token': 'jwt-1' });
    });

    it("doesn't believe the body: the status API's verdict wins", async () => {
      const blocked = withStatus({ status: 'block', user_id: 'jid-1', message: 'Face did not match' });
      expect((await make(blocked.impl).parseWebhook(callback('clear'), signed()))?.result).toMatchObject({
        outcome: 'failed',
        checks: [{ key: 'id', outcome: 'failed', note: 'Face did not match' }, expect.anything()],
      });
      const look = withStatus({ status: 'attention', user_id: 'jid-1' });
      expect((await make(look.impl).parseWebhook(callback('clear'), signed()))?.result.outcome).toBe('review');
      const running = withStatus({ status: 'processing', user_id: 'jid-1' }, 202);
      expect((await make(running.impl).parseWebhook(callback('clear'), signed()))?.result.status).toBe('pending');
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

describe('Dojah', () => {
  const make = (impl: typeof fetch) =>
    new DojahIdentityAdapter('app-1', 'sk-dojah', 'pk-dojah', 'widget-1', 'hook-secret', 'widget-c', false, ctx, impl);
  const completed = {
    reference_id: 'jid-3',
    verification_status: 'Completed',
    data: {
      government_data: {
        status: true,
        data: {
          nin: {
            entity: {
              first_name: 'Tunde',
              middle_name: 'Ade',
              last_name: 'Bakare',
              date_of_birth: '12-04-1995',
              nin: '12345678901',
            },
          },
        },
      },
      selfie: { status: true },
    },
  };

  it('opens a signed page on our side that runs the widget for this reference', async () => {
    const dojah = make(fakeFetch(() => json({})).impl);
    expect((await dojah.startIdentity({ reference: 'jid-3' })).url).toBe(
      'https://api.jiffo.test/v1/identity/hosted/dojah?ref=jid-3&sig=sig(dojah:jid-3)',
    );
    const page = dojah.page('jid-3');
    expect(page).toContain('https://api.jiffo.test/v1/identity/done?for=agent');
    // Customers get their own flow: the NIN or BVN and a selfie, no document.
    const forCustomer = dojah.page('cid-3');
    expect(forCustomer).toContain('"widget_id":"widget-c"');
    expect(forCustomer).toContain('https://api.jiffo.test/v1/identity/done?for=customer');
    expect(page).toContain('https://widget.dojah.io/widget.js');
    expect(page).toContain('"widget_id":"widget-1"');
    expect(page).toContain('"reference_id":"jid-3"');
    expect(page).not.toContain('sk-dojah');
  });

  it('reads the result by our reference, looking at each step', async () => {
    const { impl, calls } = fakeFetch(() => json({ entity: completed }));
    expect(await make(impl).identityResult('jid-3')).toEqual({
      status: 'done',
      outcome: 'passed',
      legalName: 'TUNDE ADE BAKARE',
      dateOfBirth: '1995-04-12',
      checks: [
        { key: 'id', outcome: 'passed' },
        { key: 'selfie', outcome: 'passed' },
      ],
      idNumber: '12345678901',
      idType: 'nin',
    });
    expect(calls[0]!.url).toBe('https://api.dojah.io/api/v1/kyc/verification?reference_id=jid-3');
    expect(calls[0]!.init.headers).toMatchObject({ Authorization: 'sk-dojah', AppId: 'app-1' });
    // Completed means finished, not passed: a failed selfie step is looked at.
    const noSelfie = { ...completed, data: { ...completed.data, selfie: { status: false } } };
    expect((await make(fakeFetch(() => json({ entity: noSelfie })).impl).identityResult('x')).outcome).toBe('review');
    expect(
      (await make(fakeFetch(() => json({ entity: { verification_status: 'Ongoing' } })).impl).identityResult('x'))
        .status,
    ).toBe('pending');
    expect((await make(fakeFetch(() => json({}, 404)).impl).identityResult('x')).status).toBe('pending');
  });

  it('reads whichever ID the person chose in the widget, and a BVN alongside', async () => {
    const read = async (data: object) =>
      make(fakeFetch(() => json({ entity: { verification_status: 'Completed', data } })).impl).identityResult('x');
    const person = { first_name: 'Tunde', last_name: 'Bakare', date_of_birth: '1995-04-12' };
    // A driver's licence looked up with the issuer, and a BVN in the same name.
    const licence = await read({
      government_data: {
        status: true,
        data: { drivers_license: { entity: { ...person, license_no: 'LAG12345AA12' } }, bvn: { entity: person } },
      },
      selfie: { status: true },
    });
    expect(licence).toMatchObject({ idType: 'drivers_licence', idNumber: 'LAG12345AA12', outcome: 'passed' });
    expect(licence.checks.map((c) => c.key)).toEqual(['id', 'selfie', 'bvn']);
    // A BVN in someone else's name goes to review.
    const other = await read({
      government_data: {
        status: true,
        data: {
          nin: { entity: { ...person, nin: '12345678901' } },
          bvn: { entity: { first_name: 'Ada', last_name: 'Obi' } },
        },
      },
      selfie: { status: true },
    });
    expect(other.checks).toContainEqual({ key: 'bvn', outcome: 'review', note: 'The BVN is in another name' });
    // A passport from the ID document step, with no lookup.
    const passport = await read({
      id: {
        status: true,
        data: { id_data: { ...person, document_type: 'International Passport', document_number: 'A12345678' } },
      },
      selfie: { status: true },
    });
    expect(passport).toMatchObject({ idType: 'passport', idNumber: 'A12345678', outcome: 'passed' });
    // Only a BVN: it is the ID.
    const bvn = await read({
      government_data: { status: true, data: { bvn: { entity: { ...person, bvn: '22212345678' } } } },
      selfie: { status: true },
    });
    expect(bvn).toMatchObject({ idType: 'bvn', idNumber: '22212345678' });
    expect(bvn.checks.map((c) => c.key)).toEqual(['id', 'selfie']);
  });

  it('takes a webhook only with the webhook secret, and starts and reads address visits', async () => {
    const dojah = make(fakeFetch(() => json({})).impl);
    const raw = Buffer.from(JSON.stringify(completed));
    const signature = createHmac('sha256', 'hook-secret').update(raw).digest('hex');
    expect((await dojah.parseWebhook(raw, { 'x-dojah-signature': signature }))?.reference).toBe('jid-3');
    expect(await dojah.parseWebhook(raw, { 'x-dojah-signature': 'nope' })).toBeNull();

    const { impl, calls } = fakeFetch(({ init }) =>
      init.method === 'POST'
        ? json({ entity: { status: 'pending', reference_id: 'addr-1' } })
        : json({ entity: { status: 'verified' } }),
    );
    const visits = make(impl);
    expect(await visits.startAddress({ person, address: '14 Fola Osibo Road', state: 'Lagos', area: 'Lekki' })).toEqual(
      {
        reference: 'addr-1',
      },
    );
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      first_name: 'Tunde',
      last_name: 'Bakare',
      mobile: '08031234567',
      street: '14 Fola Osibo Road',
      lga: 'Lekki',
      state: 'Lagos',
    });
    expect(await visits.addressResult('addr-1')).toEqual({ status: 'done', outcome: 'passed' });
  });

  it('reads dates of birth in either order', () => {
    expect(isoDate('1995-04-12')).toBe('1995-04-12');
    expect(isoDate('12-04-1995')).toBe('1995-04-12');
    expect(isoDate('April')).toBeUndefined();
  });
});

describe('Youverify', () => {
  const make = (impl: typeof fetch) => new YouverifyIdentityAdapter('yv-secret', 'pmk-1', true, ctx, impl);
  const envelope = (data: unknown, status = 200) => json({ success: status < 400, data }, status);

  it('serves a page with a liveness session it started, and the NIN field', async () => {
    const { impl, calls } = fakeFetch(({ url }) =>
      url.endsWith('/session/generate') ? envelope({ sessionId: 'sess-1' }) : envelope({ authToken: 'tok-1' }),
    );
    const youverify = make(impl);
    expect((await youverify.startIdentity({ reference: 'jid-4' })).url).toBe(
      'https://api.jiffo.test/v1/identity/hosted/youverify?ref=jid-4&sig=sig(youverify:jid-4)',
    );
    const page = await youverify.page('jid-4', { idType: 'nin', withBvn: false });
    expect(calls[0]!.url).toBe('https://api.sandbox.youverify.co/v2/api/identity/sdk/session/generate');
    expect(calls[0]!.init.headers).toMatchObject({ token: 'yv-secret' });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      publicMerchantID: 'pmk-1',
      metadata: { reference: 'jid-4' },
    });
    expect(page).toContain('"sessionId":"sess-1"');
    expect(page).toContain('"sessionToken":"tok-1"');
    expect(page).toContain('"sessionSig":"sig(youverify-session:jid-4:sess-1)"');
    expect(page).toContain('integrity="sha384-');
    // The SDK starts only with a task, and tags the result with Jiffo's account via the public key.
    expect(page).toContain('"tasks":[{"id":"complete-the-circle"}]');
    expect(page).toContain('"publicKey":"pmk-1"');
    expect(page).toContain('National Identification Number');
    // Pasted with spaces, the NIN keeps only its digits.
    expect(page).toContain("input.value.replace(/[^0-9]/g, '').slice(0, 11)");
    expect(page).not.toContain('id="bvn"');
    expect(page).not.toContain('yv-secret');
    // The page sends the NIN and the session, never the selfie.
    expect(page).not.toMatch(/faceImage/);
  });

  describe('a submitted page', () => {
    const input = { idNumber: '12345678901', session: 'sess-1', sessionSig: 'sig(youverify-session:jid-4:sess-1)' };
    const nin = { idType: 'nin', withBvn: false } as const;
    const respond = (live: object | null, nin: object) =>
      fakeFetch(({ url }) =>
        url.includes('/identity/liveness')
          ? envelope({ docs: live ? [{ sessionId: 'sess-1', ...live }] : [] })
          : envelope(nin),
      );

    it('passes the liveness selfie link into the NIN check, and maps the answer', async () => {
      const { impl, calls } = respond(
        { passed: true, faceImage: 'https://cdn.youverify.co/face.jpg' },
        {
          status: 'found',
          selfieValidation: true,
          firstName: 'Tunde',
          middleName: 'Ade',
          lastName: 'Bakare',
          dateOfBirth: '1995-04-12',
          idNumber: '12345678901',
        },
      );
      expect(await make(impl).submitPage('jid-4', nin, input)).toEqual({
        status: 'done',
        outcome: 'passed',
        legalName: 'TUNDE ADE BAKARE',
        dateOfBirth: '1995-04-12',
        checks: [
          { key: 'id', outcome: 'passed' },
          { key: 'selfie', outcome: 'passed' },
        ],
        idNumber: '12345678901',
      });
      expect(calls[0]!.url).toBe('https://api.sandbox.youverify.co/v2/api/identity/liveness?sessionId=sess-1&limit=1');
      expect(calls[1]!.url).toBe('https://api.sandbox.youverify.co/v2/api/identity/ng/nin');
      expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
        id: '12345678901',
        isSubjectConsent: true,
        validations: { selfie: { image: 'https://cdn.youverify.co/face.jpg' } },
      });
    });

    it('fails a liveness check that did not pass, without a NIN check', async () => {
      const { impl, calls } = respond({ passed: false, faceImage: 'x' }, {});
      expect(await make(impl).submitPage('jid-4', nin, input)).toMatchObject({ outcome: 'failed' });
      expect(calls).toHaveLength(1);
    });

    it('sends an unmatched selfie to review, and a NIN not found fails', async () => {
      const live = { passed: true, faceImage: 'https://cdn.youverify.co/face.jpg' };
      const unmatched = respond(live, { status: 'found', selfieValidation: false, firstName: 'A', lastName: 'B' });
      expect(await make(unmatched.impl).submitPage('jid-4', nin, input)).toMatchObject({
        outcome: 'review',
        checks: [
          { key: 'id', outcome: 'passed' },
          { key: 'selfie', outcome: 'review' },
        ],
      });
      // Some answers put the match under validations.
      const nested = respond(live, {
        status: 'found',
        firstName: 'A',
        lastName: 'B',
        validations: { selfie: { selfieVerification: { match: true } } },
      });
      expect((await make(nested.impl).submitPage('jid-4', nin, input)).outcome).toBe('passed');
      const silent = respond(live, { status: 'failed', reason: 'NIMC timeout' });
      expect((await make(silent.impl).submitPage('jid-4', nin, input)).checks).toEqual([
        { key: 'id', outcome: 'review', note: 'NIMC answered: NIMC timeout' },
        { key: 'selfie', outcome: 'review', note: "Not compared, as NIMC didn't answer" },
      ]);
      const missing = respond(live, { status: 'not_found' });
      const result = await make(missing.impl).submitPage('jid-4', nin, input);
      expect(result).toMatchObject({
        outcome: 'failed',
        checks: [{ key: 'id', outcome: 'failed' }, expect.anything()],
      });
      expect(result.idNumber).toBeUndefined();
    });

    it("checks a driver's licence, and a BVN alongside in the same name", async () => {
      const calls: Call[] = [];
      const impl = (async (url: string | URL, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        const path = String(url);
        if (path.includes('/identity/liveness')) {
          return envelope({
            docs: [{ sessionId: 'sess-1', passed: true, faceImage: 'https://cdn.youverify.co/f.jpg' }],
          });
        }
        if (path.endsWith('/drivers-license')) {
          return envelope({ status: 'found', selfieValidation: true, firstName: 'Tunde', lastName: 'Bakare' });
        }
        return envelope({ status: 'found', firstName: 'TUNDE', lastName: 'BAKARE' });
      }) as typeof fetch;
      const licence = { idType: 'drivers_licence', withBvn: true } as const;
      const result = await make(impl).submitPage('jid-4', licence, {
        ...input,
        idNumber: 'LAG12345AA12',
        bvn: '22212345678',
      });
      expect(result).toMatchObject({ outcome: 'passed', idNumber: 'LAG12345AA12', legalName: 'TUNDE BAKARE' });
      expect(result.checks.map((c) => c.key)).toEqual(['id', 'selfie', 'bvn']);
      expect(calls.map((c) => c.url.replace('https://api.sandbox.youverify.co', ''))).toEqual([
        '/v2/api/identity/liveness?sessionId=sess-1&limit=1',
        '/v2/api/identity/ng/drivers-license',
        '/v2/api/identity/ng/bvn',
      ]);
      expect(JSON.parse(String(calls[1]!.init.body))).toMatchObject({
        id: 'LAG12345AA12',
        validation: { selfie: { image: 'https://cdn.youverify.co/f.jpg' } },
      });
      // A licence that isn't found: the BVN isn't looked up (or paid for), and the match is read where the
      // licence's answer puts it.
      const missing: Call[] = [];
      const notFound = (async (url: string | URL, init: RequestInit = {}) => {
        missing.push({ url: String(url), init });
        return String(url).includes('/identity/liveness')
          ? envelope({ docs: [{ sessionId: 'sess-1', passed: true, faceImage: 'https://cdn.youverify.co/f.jpg' }] })
          : envelope({ status: 'not_found' });
      }) as typeof fetch;
      const lost = await make(notFound).submitPage('jid-4', licence, {
        ...input,
        idNumber: 'LAG12345AA12',
        bvn: '22212345678',
      });
      expect(lost.checks).toContainEqual({
        key: 'bvn',
        outcome: 'review',
        note: 'Not compared, as the ID record was not found',
      });
      expect(missing.some((c) => c.url.endsWith('/ng/bvn'))).toBe(false);
      const nested = (async (url: string | URL) =>
        String(url).includes('/identity/liveness')
          ? envelope({ docs: [{ sessionId: 'sess-1', passed: true, faceImage: 'https://cdn.youverify.co/f.jpg' }] })
          : envelope({
              status: 'found',
              firstName: 'Tunde',
              lastName: 'Bakare',
              validation: { selfie: { selfieVerification: { match: true } } },
            })) as typeof fetch;
      const plain = { idType: 'drivers_licence', withBvn: false } as const;
      expect((await make(nested).submitPage('jid-4', plain, { ...input, idNumber: 'LAG12345AA12' })).outcome).toBe(
        'passed',
      );
      // The page asks for both.
      const page = await make(
        fakeFetch(({ url }) =>
          url.endsWith('/session/generate') ? envelope({ sessionId: 'sess-1' }) : envelope({ authToken: 'tok-1' }),
        ).impl,
      ).page('jid-4', licence);
      expect(page).toContain('Driver&#39;s licence number');
      expect(page).toContain('id="bvn"');
    });

    it('takes only a session the API started for this check', async () => {
      const { impl, calls } = respond({ passed: true, faceImage: 'x' }, {});
      await expect(make(impl).submitPage('jid-4', nin, { ...input, session: 'someone-elses' })).rejects.toBeInstanceOf(
        IdentityPageError,
      );
      await expect(make(impl).submitPage('jid-5', nin, input)).rejects.toBeInstanceOf(IdentityPageError);
      expect(calls).toHaveLength(0);
    });
  });

  it('tests the secret key on a harmless read, and leaves addresses to the team', async () => {
    const { impl, calls } = fakeFetch(() => envelope([{ state: 'Lagos' }]));
    expect(await make(impl).check()).toMatch(/Connected/);
    expect(calls[0]!.url).toBe('https://api.sandbox.youverify.co/v2/api/states');
    const refused = fakeFetch(() => json({ success: false, statusCode: 401, message: 'Permission denied' }, 401));
    await expect(make(refused.impl).check()).rejects.toThrow(/401/);
    // A refusal that comes with a 200.
    const broke = fakeFetch(() => json({ success: false, message: 'Insufficient balance', data: null }));
    await expect(make(broke.impl).check()).rejects.toThrow(/Insufficient balance/);
    expect(await make(impl).addressResult()).toMatchObject({ outcome: 'review' });
  });
});
