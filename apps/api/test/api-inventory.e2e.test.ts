import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DevelopmentOnlyGuard } from '../src/common/development-only.guard';
import { APP_CONFIG, contactsOf, loadConfig, type AppConfig } from '../src/config/app-config';
import { createTestApp, type TestApp } from './helpers';
import { openApiDocument } from './openapi';

/** The committed list of every route (docs/security-plan.md, S8). `pnpm --filter @jiffo/api openapi` rewrites it. */
const DOCUMENT = resolve(__dirname, '../../../docs/api/openapi.json');

/** Every route anyone may call without signing in: signing in, providers' webhooks and pages, and the basics. */
const PUBLIC = new Set([
  'GET /.well-known/security.txt',
  'GET /health',
  'GET /security',
  'GET /v1/config/{country}',
  'POST /v1/auth/otp/request',
  'POST /v1/auth/otp/verify',
  'POST /v1/auth/refresh',
  'POST /v1/admin/auth/sign-in',
  'POST /v1/admin/auth/code',
  'POST /v1/admin/auth/passkey/options',
  'POST /v1/admin/auth/passkey',
  'POST /v1/admin/auth/setup',
  'POST /v1/admin/auth/invite/check',
  'POST /v1/admin/auth/invite/accept',
  'GET /v1/identity/done',
  'GET /v1/identity/hosted/{provider}',
  'POST /v1/identity/hosted/{provider}/submit',
  'POST /v1/webhooks/{provider}',
  'POST /v1/webhooks/{provider}/transfer-approval',
  'POST /v1/webhooks/identity/{provider}',
  'POST /v1/webhooks/calls/{provider}/{token}',
]);

interface Operation {
  security: unknown[];
  'x-guards'?: string[];
}

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp();
});
afterAll(async () => {
  await t?.close();
});

describe('API inventory', () => {
  it('lists every route in the committed OpenAPI document', () => {
    const now = `${JSON.stringify(openApiDocument(t.app), null, 2)}\n`;
    if (process.env.UPDATE_OPENAPI) writeFileSync(DOCUMENT, now);
    // Out of date? Run `pnpm --filter @jiffo/api openapi` and commit docs/api/openapi.json.
    expect(readFileSync(DOCUMENT, 'utf8')).toBe(now);
  });

  it('serves one API version only, and opens to anyone only the routes meant to be open', () => {
    const doc = openApiDocument(t.app);
    const outside = ['/health', '/.well-known/security.txt', '/security'];
    const open = new Set<string>();
    for (const [path, operations] of Object.entries(doc.paths)) {
      expect(path.startsWith('/v1/') || outside.includes(path), path).toBe(true);
      for (const [method, op] of Object.entries(operations) as Array<[string, Operation]>) {
        const route = `${method.toUpperCase()} ${path}`;
        if (op.security.length === 0 && !op['x-guards']?.includes('DevelopmentOnlyGuard')) open.add(route);
        // Admin routes take an admin session, never an app one, unless they are how an admin signs in.
        if (path.startsWith('/v1/admin/') && !PUBLIC.has(route)) expect(op.security, route).toEqual([{ admin: [] }]);
      }
    }
    // A new route open to anyone is added to PUBLIC on purpose, so it's seen in review.
    expect([...open].sort()).toEqual([...PUBLIC].sort());
  });

  it("answers the development store's file routes in production as if they weren't there", async () => {
    const live = new DevelopmentOnlyGuard({ ...t.app.get<AppConfig>(APP_CONFIG), NODE_ENV: 'production' });
    expect(() => live.canActivate()).toThrow(expect.objectContaining({ status: 404 }));
    expect(new DevelopmentOnlyGuard(t.app.get<AppConfig>(APP_CONFIG)).canActivate()).toBe(true);
    // Every route of the development store is behind the guard, and outside production it answers.
    const doc = openApiDocument(t.app);
    for (const [path, operations] of Object.entries(doc.paths)) {
      if (!path.startsWith('/v1/dev-files/')) continue;
      for (const op of Object.values(operations) as Operation[])
        expect(op['x-guards']).toContain('DevelopmentOnlyGuard');
    }
    await request(t.http).get('/v1/dev-files/x?m=GET&exp=1&size=1&sig=x').expect(403);
  });
});

describe('reporting a security problem', () => {
  it('publishes security.txt with a contact, an expiry under a year away, and the policy page', async () => {
    const res = await request(t.http).get('/.well-known/security.txt').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    const fields = Object.fromEntries(
      (res.text as string)
        .trim()
        .split('\n')
        .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 2)]),
    );
    expect(fields.Contact).toMatch(/^(mailto:|https:\/\/)/);
    const expires = Date.parse(fields.Expires!);
    expect(expires).toBeGreaterThan(Date.now());
    expect(expires).toBeLessThan(Date.now() + 365 * 86_400_000);
    expect(fields.Canonical).toMatch(/\/\.well-known\/security\.txt$/);
    expect(fields.Policy).toMatch(/\/security$/);
    // Not under the API version, and not twice.
    await request(t.http).get('/v1/.well-known/security.txt').expect(404);
  });

  it('serves the reporting page as plain HTML with no scripts allowed', async () => {
    const res = await request(t.http).get('/security').expect(200);
    expect(res.headers['content-type']).toMatch(/^text\/html/);
    expect(res.headers['content-security-policy']).toMatch(/^default-src 'none'/);
    expect(res.headers['content-security-policy']).not.toMatch(/script-src/);
    expect(res.text).toContain('Report a security problem');
    expect(res.text).toMatch(/<a href="(mailto:|https:\/\/)/);
  });

  it('takes only mailto: and https: addresses as the contact', () => {
    expect(() => loadConfig({ ...process.env, SECURITY_CONTACT: 'security@jiffoapp.com' })).toThrow(/SECURITY_CONTACT/);
    expect(() => loadConfig({ ...process.env, SECURITY_CONTACT: 'javascript:alert(1)' })).toThrow(/SECURITY_CONTACT/);
    expect(() => loadConfig({ ...process.env, SECURITY_CONTACT: 'https://x.test/"><b>' })).toThrow(/SECURITY_CONTACT/);
    expect(
      loadConfig({ ...process.env, SECURITY_CONTACT: 'mailto:security@jiffoapp.com, https://jiffoapp.com/security' })
        .SECURITY_CONTACT,
    ).toBeTruthy();
    // A comma inside a link stays in it; contacts are split only where the next one starts.
    expect(contactsOf('https://jiffoapp.com/report?a=1,2, mailto:security@jiffoapp.com')).toEqual([
      'https://jiffoapp.com/report?a=1,2',
      'mailto:security@jiffoapp.com',
    ]);
  });
});
