import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatList } from './chat-list';

const time = () => '10:00';
const message = (senderRole: string, body: string) => ({
  id: Math.floor(Math.random() * 1e9),
  senderRole,
  kind: 'text',
  body,
  photoUrl: null,
  createdAt: '2026-01-01T10:00:00Z',
});

describe('ChatList', () => {
  it('shows markup in a message as text, so it never runs in a staff browser', () => {
    const attacks = [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<a href="javascript:alert(1)">tap</a>',
      '"><svg onload=alert(1)>',
    ];
    for (const role of ['customer', 'agent', 'system']) {
      const html = renderToStaticMarkup(<ChatList chat={attacks.map((a) => message(role, a))} time={time} />);
      expect(html).not.toMatch(/<script|<img src=x|<svg|<a href="javascript/i);
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    }
  });
});
