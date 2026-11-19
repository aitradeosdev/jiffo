import { describe, expect, it } from 'vitest';
import { flagDecisionOf } from './flags';

describe('flag decisions', () => {
  it('takes only a button that was pressed, never a default', () => {
    expect(flagDecisionOf('confirm')).toBe('confirm');
    expect(flagDecisionOf('clear')).toBe('clear');
    expect(flagDecisionOf('reopen')).toBe('reopen');
    // A form sent without a button (Enter in the note) clears nothing.
    expect(flagDecisionOf(null)).toBeNull();
    expect(flagDecisionOf('')).toBeNull();
    expect(flagDecisionOf('delete')).toBeNull();
  });
});
