import { describe, expect, it } from 'vitest';
import { moderate } from '../src/risk/moderation';

/** Moderation's words (docs/security-plan.md, E5): what flags an errand, and what doesn't. */
describe('errand moderation', () => {
  const kinds = (text: string) => moderate(text).map((f) => f.kind);

  it('flags carrying or withdrawing cash', () => {
    expect(kinds('Withdraw 20k from the ATM and bring it')).toEqual(['cash_errand']);
    expect(kinds('Bring CASH from my shop')).toEqual(['cash_errand']);
    expect(kinds('Collect naira notes from my brother')).toEqual(['cash_errand']);
    expect(kinds('POS withdrawal at the junction')).toEqual(['cash_errand']);
  });

  it('flags money to be sent to an account', () => {
    expect(kinds('Send it to my account when you collect')).toEqual(['send_money']);
    expect(kinds('Transfer money to my sister')).toEqual(['send_money']);
    expect(kinds('My account number is below')).toEqual(['send_money']);
    expect(kinds('Pay 0123456789 at GTBank')).toEqual(['send_money']);
  });

  it("keeps an account number out of what it found, and doesn't take a phone number for one", () => {
    const [finding] = moderate('Pay into 0123456789');
    expect(finding!.words).toEqual(['an account number']);
    expect(kinds('Call me on +234 8031234567 at the gate')).toEqual([]);
    expect(kinds('Call me on 08031234567 at the gate')).toEqual([]);
  });

  it('leaves ordinary errands alone', () => {
    expect(kinds('Pick up a parcel from the front desk')).toEqual([]);
    expect(kinds('Buy cashew nuts and a cake for the party')).toEqual([]);
    expect(kinds('Collect my laptop from the repair shop')).toEqual([]);
  });
});
