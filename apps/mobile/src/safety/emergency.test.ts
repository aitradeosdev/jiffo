import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emergencyNumberOf,
  FOLLOW_EVERY_MS,
  FOLLOW_FOR_MS,
  pressEmergency,
  REPORT_RETRY_MS,
  SAME_PRESS_MS,
  type EmergencyDeps,
} from './emergency';

describe('the emergency button (E9)', () => {
  // Each press in its own time, so one test's press isn't taken for another's double tap.
  let clock = 1_000_000;
  beforeEach(() => {
    clock += 600_000;
  });
  const spot = { lat: 6.45, lng: 3.47, accuracy: 10 };
  const deps = (over: Partial<EmergencyDeps> = {}) => {
    const order: string[] = [];
    let tick: (() => void) | null = null;
    const d: EmergencyDeps = {
      dial: vi.fn(() => void order.push('dial')),
      locate: vi.fn(async (ask: boolean) => {
        order.push(ask ? 'locate-asking' : 'locate');
        return spot;
      }),
      report: vi.fn(async () => {
        order.push('report');
        return { id: 'e1' };
      }),
      follow: vi.fn(async () => undefined),
      every: vi.fn((_ms: number, run: () => void) => {
        tick = run;
        return () => {
          tick = null;
        };
      }),
      wait: vi.fn(async () => undefined),
      unreached: vi.fn(),
      ...over,
    };
    return { d, order, tick: () => tick?.(), ticking: () => tick !== null };
  };

  it('dials, then reports straight away, and only then looks for where the person is', async () => {
    const { d, order } = deps();
    expect(await pressEmergency(d, { number: '112', errandId: 'err-1' }, clock)).toBe('e1');
    expect(d.dial).toHaveBeenCalledWith('112');
    expect(d.report).toHaveBeenCalledWith({ errandId: 'err-1' });
    await vi.waitFor(() => expect(d.follow).toHaveBeenCalledWith('e1', spot));
    expect(order.slice(0, 3)).toEqual(['dial', 'report', 'locate-asking']);
  });

  it("doesn't wait on a permission prompt or a location that never comes", async () => {
    const { d } = deps({ locate: () => new Promise(() => undefined) });
    expect(await pressEmergency(d, { number: '112' }, clock)).toBe('e1');
  });

  it('tries the report again on a weak signal, and says so if Jiffo is never reached', async () => {
    let fails = 2;
    const flaky = deps({
      report: vi.fn(async () => {
        if (fails-- > 0) throw new Error('no network');
        return { id: 'e2' };
      }),
    });
    expect(await pressEmergency(flaky.d, { number: '112' }, clock)).toBe('e2');
    expect(flaky.d.report).toHaveBeenCalledTimes(3);
    const offline = deps({ report: async () => Promise.reject(new Error('no network')) });
    expect(await pressEmergency(offline.d, { number: '112' }, clock + 60_000)).toBeNull();
    expect(offline.d.wait).toHaveBeenCalledTimes(REPORT_RETRY_MS.length);
    expect(offline.d.unreached).toHaveBeenCalled();
    expect(offline.d.dial).toHaveBeenCalled();
  });

  it('takes a double tap as one press', async () => {
    const { d } = deps();
    await Promise.all([pressEmergency(d, { number: '112' }, clock), pressEmergency(d, { number: '112' }, clock + 1)]);
    expect(d.dial).toHaveBeenCalledTimes(1);
    expect(d.report).toHaveBeenCalledTimes(1);
    await pressEmergency(d, { number: '112' }, clock + SAME_PRESS_MS + 1);
    expect(d.dial).toHaveBeenCalledTimes(2);
  });

  it('keeps sending where the person is for ten minutes, never asking for permission again, then stops', async () => {
    const { d, tick, ticking } = deps();
    await pressEmergency(d, { number: '112' }, clock);
    expect(d.every).toHaveBeenCalledWith(FOLLOW_EVERY_MS, expect.any(Function));
    const times = FOLLOW_FOR_MS / FOLLOW_EVERY_MS;
    for (let i = 0; i < times; i += 1) tick();
    await vi.waitFor(() => expect(d.follow).toHaveBeenCalledTimes(times + 1));
    expect((d.locate as ReturnType<typeof vi.fn>).mock.calls.filter(([ask]) => ask)).toHaveLength(1);
    tick();
    expect(ticking()).toBe(false);
  });

  it("dials the country's number, or 112", () => {
    expect(emergencyNumberOf({ safety: { emergencyNumber: '199' } })).toBe('199');
    expect(emergencyNumberOf(undefined)).toBe('112');
  });
});
