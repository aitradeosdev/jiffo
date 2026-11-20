import { describe, expect, it } from 'vitest';
import { flagDecisionOf, signInFinding } from './flags';

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

describe('a risky sign-in, in words', () => {
  it('names each reason, the provider and how many accounts', () => {
    expect(signInFinding({ score: 4, reasons: ['emulator', 'data_centre'], provider: 'aws', app: 'agent' })).toBe(
      "Scored 4 in the agent app: an emulator, an address in a cloud provider's ranges (aws)",
    );
    expect(signInFinding({ score: 2, reasons: ['shared_phone'], accounts: 3, app: 'customer' })).toBe(
      'Scored 2 in the customer app: a phone several accounts have signed in on (3 accounts)',
    );
  });

  it('reads a reason it does not know as it was sent', () => {
    expect(signInFinding({ score: 1, reasons: ['something_new'] })).toBe('Scored 1: something_new');
  });
});
