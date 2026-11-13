import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveSchedule, staleSchedule, upcoming, whenLabel } from './when';

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
