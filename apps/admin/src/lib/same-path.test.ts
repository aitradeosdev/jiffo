import { describe, expect, it } from 'vitest';
import { samePath } from './same-path';

describe('samePath', () => {
  it('keeps paths on this site', () => {
    expect(samePath('/team')).toBe('/team');
    expect(samePath('/audit?before=12')).toBe('/audit?before=12');
  });

  it('never sends the browser to another site', () => {
    for (const back of [
      '//evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'https://evil.example/x',
      'javascript:alert(1)',
    ]) {
      expect(samePath(back)).toBe('/');
    }
  });
});
