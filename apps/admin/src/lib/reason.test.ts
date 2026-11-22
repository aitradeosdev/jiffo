import { describe, expect, it } from 'vitest';
import { reasonMissing } from './reason';

/** Every change says why (D7): one box at the top of the page, which a form's refusal points back to. */
describe('the reason box', () => {
  it('is pointed to when a change came back refused and the box has no reason in it', () => {
    expect(reasonMissing({ error: 'Say why, in a few words' }, '')).toBe(true);
    expect(reasonMissing({ error: 'Say why, in a few words' }, ' ab ')).toBe(true);
  });

  it('is left alone when a reason is there, the change went through, or nothing was sent yet', () => {
    expect(reasonMissing({ error: 'The key is wrong' }, 'Test server setup')).toBe(false);
    expect(reasonMissing({}, '')).toBe(false);
    expect(reasonMissing(undefined, '')).toBe(false);
  });
});
