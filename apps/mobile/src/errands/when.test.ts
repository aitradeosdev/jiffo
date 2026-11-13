import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dayLabel, liveSchedule, shortWhen, staleSchedule, upcoming, whenLabel } from './when';

const NOW = new Date('2026-11-13T09:00:00Z');
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

describe('schedules', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => vi.useRealTimers());

  it('keeps a draft schedule only while it is at least 15 minutes ahead', () => {
    expect(liveSchedule(null)).toBeNull();
    expect(liveSchedule(inMinutes(15))).toBe(inMinutes(15));
    expect(liveSchedule(inMinutes(14))).toBeNull();
    expect(staleSchedule(inMinutes(14))).toBe(true);
    expect(staleSchedule(inMinutes(-5))).toBe(true);
    expect(staleSchedule(inMinutes(60))).toBe(false);
    expect(staleSchedule(null)).toBe(false);
  });

  it('shows a sent errand as scheduled until its time comes', () => {
    expect(upcoming(inMinutes(5))).toBe(inMinutes(5));
    expect(upcoming(inMinutes(-1))).toBeNull();
  });

  it('reads Now, or the day and time', () => {
    expect(whenLabel(null)).toBe('Now');
    expect(whenLabel(inMinutes(-1))).toBe('Now');
    expect(whenLabel(inMinutes(60))).toMatch(/^[A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} · \d{1,2}:\d{2} [AP]M$/);
  });
});

describe('list dates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 13, 15, 0));
  });
  afterEach(() => vi.useRealTimers());

  it('names today and yesterday, and dates the rest', () => {
    expect(dayLabel(new Date(2026, 10, 13, 9, 5))).toBe('Today');
    expect(dayLabel(new Date(2026, 10, 12, 23, 59))).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 10, 4, 11, 40))).toBe('4 Nov');
    expect(shortWhen(new Date(2026, 10, 12, 18, 12).toISOString())).toBe('Yesterday, 6:12 PM');
  });
});
