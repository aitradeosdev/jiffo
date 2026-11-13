import { describe, expect, it } from 'vitest';
import { latestPosition, REPORT_EVERY_MS, shouldSendFromBackground } from './background-rules';

describe('background location', () => {
  it('sends only while the app is not on screen, and not too often', () => {
    const now = 1_000_000;
    expect(shouldSendFromBackground('background', now, now - REPORT_EVERY_MS)).toBe(true);
    expect(shouldSendFromBackground(null, now, 0)).toBe(true);
    expect(shouldSendFromBackground('active', now, 0)).toBe(false);
    expect(shouldSendFromBackground('background', now, now - 1_000)).toBe(false);
  });

  it('uses the newest of a batch of positions', () => {
    expect(latestPosition([])).toBeNull();
    expect(latestPosition(undefined)).toBeNull();
    expect(
      latestPosition([
        { timestamp: 3, coords: { latitude: 6.3, longitude: 3.3 } },
        { timestamp: 5, coords: { latitude: 6.5, longitude: 3.5 } },
        { timestamp: 4, coords: { latitude: 6.4, longitude: 3.4 } },
      ]),
    ).toEqual({ lat: 6.5, lng: 3.5 });
  });
});
