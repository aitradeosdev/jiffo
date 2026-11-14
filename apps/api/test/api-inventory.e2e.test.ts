import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/app-config';
import { createTestApp, type TestApp } from './helpers';
import { openApiDocument } from './openapi';

/** The committed list of every route (docs/security-plan.md, S8). `pnpm --filter @jiffo/api openapi` rewrites it. */
const DOCUMENT = resolve(__dirname, '../../../docs/api/openapi.json');

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

  it('serves one API version only, and every route says who may call it', () => {
    const doc = openApiDocument(t.app);
    const outside = ['/health', '/.well-known/security.txt', '/security'];
    for (const [path, operations] of Object.entries(doc.paths)) {
      expect(path.startsWith('/v1/') || outside.includes(path), path).toBe(true);
      for (const op of Object.values(operations) as Array<{ security: unknown[]; 'x-rate-limit': string }>) {
        expect(Array.isArray(op.security)).toBe(true);
        expect(op['x-rate-limit']).toBeTruthy();
      }
    }
    // Admin routes take an admin session, never an app one, and never none.
    for (const [path, operations] of Object.entries(doc.paths)) {
      if (!path.startsWith('/v1/admin/') || path.startsWith('/v1/admin/auth/')) continue;
      for (const op of Object.values(operations) as Array<{ security: unknown[] }>) {
        expect(op.security, path).toEqual([{ admin: [] }]);
      }
    }
  });

  it("doesn't register the development store's file routes in production", async () => {
    const before = process.env.NODE_ENV;
    vi.resetModules();
    process.env.NODE_ENV = 'production';
    try {
      const { FilesModule } = await import('../src/files/files.module');
      const names = (Reflect.getMetadata('controllers', FilesModule) as Array<{ name: string }>).map((c) => c.name);
      expect(names).toEqual(['UploadsController']);
    } finally {
      process.env.NODE_ENV = before;
      vi.resetModules();
    }
    // Outside production they exist, for the memory store's signed links.
    expect(Object.keys(openApiDocument(t.app).paths)).toContain('/v1/dev-files/{key}');
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
  });
});
