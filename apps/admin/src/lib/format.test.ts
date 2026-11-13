import { describe, expect, it } from 'vitest';
import { ago, count, dateTime, money, shortDay, waited } from './format';

describe('format', () => {
  it('shows money in naira', () => {
    expect(money(250_000)).toBe('₦2,500');
    expect(money(250_050)).toBe('₦2,500.50');
    expect(money(0)).toBe('₦0');
    expect(money(-1_000_000)).toBe('-₦10,000');
  });

  it('shows counts, dates and days', () => {
    expect(count(1234567)).toBe('1,234,567');
    expect(dateTime('2026-11-13T13:05:00Z', 'Africa/Lagos')).toBe('13 Nov, 14:05');
    expect(shortDay('2026-11-13')).toBe('Fri 13');
  });

  it('says how long something has waited', () => {
    const now = Date.parse('2026-11-13T13:00:00Z');
    expect(waited('2026-11-13T12:59:40Z', now)).toBe('under a minute');
    expect(waited('2026-11-13T12:20:00Z', now)).toBe('40 min');
    expect(waited('2026-11-12T13:00:00Z', now)).toBe('24 h');
    expect(waited('2026-11-10T13:00:00Z', now)).toBe('3 days');
  });

  it('says how long ago', () => {
    const now = Date.parse('2026-11-13T13:00:00Z');
    expect(ago('2026-11-13T12:59:40Z', 'Africa/Lagos', now)).toBe('just now');
    expect(ago('2026-11-13T12:55:00Z', 'Africa/Lagos', now)).toBe('5 min ago');
    expect(ago('2026-11-13T10:00:00Z', 'Africa/Lagos', now)).toBe('3 h ago');
    expect(ago('2026-11-11T10:00:00Z', 'Africa/Lagos', now)).toBe('11 Nov, 11:00');
  });
});
