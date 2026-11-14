import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

describe('country config', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.close());

  it('reports health outside the versioned prefix', async () => {
    await request(t.http).get('/health').expect(200, { status: 'ok' });
  });

  it('serves the public config for Nigeria', async () => {
    const res = await request(t.http).get('/v1/config/ng').expect(200);
    expect(res.body.country).toMatchObject({ code: 'NG', currency: 'NGN', phonePrefix: '+234' });
    // Other files in the run may have saved newer versions.
    expect(res.body.settingsVersion).toBeGreaterThanOrEqual(1);
    expect(res.body.features).toEqual({ calls: true });
    expect(res.body.states).toHaveLength(37);
    expect(res.body.states.map((s: { code: string }) => s.code)).toContain('FC');
    expect(res.body.categories.map((c: { key: string }) => c.key)).toEqual([
      'groceries',
      'food',
      'pharmacy',
      'shopping',
      'laundry',
      'parcel',
      'queue',
      'other',
    ]);
    expect(res.body.settings.identity).toEqual({
      customerIdTypes: ['nin', 'bvn'],
      agentIdTypes: ['nin', 'bvn'],
    });
  });

  it('keeps server-only settings out of the public config', async () => {
    const { body } = await request(t.http).get('/v1/config/NG').expect(200);
    expect(body.settings.limits).toBeUndefined();
    expect(body.settings.fees.commissionBps).toBeUndefined();
    expect(body.settings.identity.provider).toBeUndefined();
    expect(body.settings.profiles).toBeUndefined();
  });

  it('answers unknown countries and routes in the standard error shape', async () => {
    const country = await request(t.http).get('/v1/config/gh').expect(404);
    expect(country.body.error.code).toBe('country_not_available');
    const route = await request(t.http).get('/v1/nothing-here').expect(404);
    expect(route.body).toEqual({ error: { code: 'not_found', message: expect.any(String) } });
  });
});
