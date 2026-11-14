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

  it('allows eval only in development', () => {
    expect(contentPolicy('n', false)).not.toContain('unsafe-eval');
    expect(contentPolicy('n', false)).not.toMatch(/http:|ws:/);
    expect(contentPolicy('n', true)).toContain("'unsafe-eval'");
  });
});
