import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { contentPolicy, proxy } from './proxy';
import { SESSION_COOKIE } from './lib/cookies';

const open = (path: string, cookie?: string) =>
  proxy(new NextRequest(`https://admin.jiffo.test${path}`, cookie ? { headers: { cookie } } : undefined));

describe('panel proxy', () => {
  it('sends anyone without a session to sign in', () => {
    const response = open('/errands');
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://admin.jiffo.test/sign-in');
  });

  it('gives every page, signed in or not, a content policy with a fresh nonce', () => {
    const nonces = new Set<string>();
    for (const response of [open('/sign-in'), open('/invite/abc'), open('/errands', `${SESSION_COOKIE}=x`)]) {
      expect(response.status).toBe(200);
      const csp = response.headers.get('content-security-policy') ?? '';
      const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
      expect(nonce).toBeTruthy();
      nonces.add(nonce!);
      expect(csp).toContain("'strict-dynamic'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
    }
    expect(nonces.size).toBe(3);
  });

  it('does not treat a page whose name starts with sign-in as open', () => {
    expect(open('/sign-in-elsewhere').status).toBe(307);
    expect(open('/invites').status).toBe(307);
  });

  it("lets Google's map load only on the Places page, where areas are drawn", () => {
    const policy = (path: string) => open(path, `${SESSION_COOKIE}=x`).headers.get('content-security-policy') ?? '';
    const places = policy('/settings/places');
    expect(places).toMatch(/connect-src [^;]*https:\/\/\*\.googleapis\.com/);
    expect(places).toMatch(/font-src [^;]*https:\/\/fonts\.gstatic\.com/);
    expect(places).toMatch(/style-src [^;]*https:\/\/fonts\.googleapis\.com/);
    expect(places).toContain('worker-src blob:');
    // Still no eval in production, and nothing else loosened.
    expect(contentPolicy('n', false, { maps: true })).not.toContain('unsafe-eval');
    expect(places).toContain("frame-ancestors 'none'");
    for (const path of ['/settings', '/settings/placesx', '/errands']) {
      expect(policy(path)).not.toContain('googleapis');
    }
  });

  it("lets Mapbox's map load there too, for when Mapbox is the maps provider, and nowhere else", () => {
    const policy = (path: string) => open(path, `${SESSION_COOKIE}=x`).headers.get('content-security-policy') ?? '';
    const places = policy('/settings/places');
    expect(places).toMatch(/connect-src [^;]*https:\/\/api\.mapbox\.com/);
    expect(places).toMatch(/connect-src [^;]*https:\/\/events\.mapbox\.com/);
    for (const path of ['/settings', '/errands', '/matching']) {
      expect(policy(path)).not.toContain('mapbox');
    }
  });

  it('allows eval only in development', () => {
    expect(contentPolicy('n', false)).not.toContain('unsafe-eval');
    expect(contentPolicy('n', false)).not.toMatch(/http:|ws:/);
    expect(contentPolicy('n', true)).toContain("'unsafe-eval'");
  });
});
