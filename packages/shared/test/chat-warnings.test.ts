import { describe, expect, it } from 'vitest';
import { CHAT_WARNING_TEXT, chatWarnings, warningsOf } from '../src/chat-warnings';

/** Chat warnings (docs/security-plan.md, C3). */
describe('chat warnings', () => {
  it('spots links, written any of the usual ways', () => {
    for (const text of [
      'Check https://example.com/deal',
      'go to www.cheap-phones.ng',
      'pay here: paystack.shop/pay/abc',
      'wa.me/2348031234567',
      'bit.ly/3xYz',
      'HTTP://EXAMPLE.COM',
    ]) {
      expect(chatWarnings(text), text).toContain('link');
    }
  });

  it("doesn't take prices, weights or the end of a sentence for a link", () => {
    for (const text of [
      'It costs N2.500 now',
      'Get 1.5kg of rice.',
      'Okay.Thanks',
      'e.g. the red one',
      'I am at the gate.See you',
    ]) {
      expect(chatWarnings(text), text).not.toContain('link');
    }
  });

  it('spots phone numbers, with or without the country code and spaces', () => {
    for (const text of [
      'call me 08031234567',
      'my number is 0803 123 4567',
      '+234 803 123 4567',
      '2348031234567',
      '+44 20 7946 0958',
      '0803-123-4567',
    ]) {
      expect(chatWarnings(text), text).toContain('phone');
    }
  });

  it('spots a bank account number, and not a phone number as one', () => {
    expect(chatWarnings('acct 0123456789 GTB')).toContain('account_number');
    expect(chatWarnings('0123 456 789')).toContain('account_number');
    expect(chatWarnings('+234 803 123 4567')).not.toContain('account_number');
    expect(chatWarnings('08031234567')).not.toContain('account_number');
    // Ten digits that could be either: both are said.
    expect(chatWarnings('8031234567')).toEqual(expect.arrayContaining(['account_number', 'phone']));
  });

  it("doesn't flag ordinary amounts, times and quantities", () => {
    for (const text of [
      'The total is 15000',
      'It came to N150,000',
      'I will be there by 14:30',
      'Buy 2 packs of 12',
      'Item code 554433',
      'Order 1500000 naira of goods? No, 1.5m is too much',
    ]) {
      expect(chatWarnings(text), text).toEqual([]);
    }
  });

  it('spots being asked to pay outside the app', () => {
    for (const text of [
      'Just pay me directly',
      'transfer to my account instead',
      'Send the money to my opay',
      "cancel it and I'll pay you cash",
      "Let's do it outside the app",
      'pay outside jiffo, it is cheaper',
      'Do bank transfer to me',
      'send it to my palmpay',
      "don't pay in the app",
    ]) {
      expect(chatWarnings(text), text).toContain('pay_outside');
    }
  });

  it('leaves ordinary errand talk alone', () => {
    for (const text of [
      'I paid for the items, sending the receipt',
      'Please confirm the items',
      'On my way to you',
      'The shop wants cash? No, they take card',
      'Where are you now?',
      'Lock the item amount in the app please',
    ]) {
      expect(chatWarnings(text), text).toEqual([]);
    }
  });

  it('gives each warning once, in a fixed order, with words for the banner', () => {
    expect(chatWarnings('pay me directly to 0123456789 or 0123456789, see www.x.com')).toEqual([
      'link',
      'account_number',
      'pay_outside',
    ]);
    for (const kind of ['link', 'phone', 'account_number', 'pay_outside'] as const) {
      expect(CHAT_WARNING_TEXT[kind].length).toBeGreaterThan(20);
    }
  });

  it("reads a stored message's warnings, ignoring anything it doesn't know", () => {
    expect(warningsOf({ warnings: ['phone', 'nonsense', 3] })).toEqual(['phone']);
    expect(warningsOf({})).toEqual([]);
    expect(warningsOf(undefined)).toEqual([]);
  });
});
