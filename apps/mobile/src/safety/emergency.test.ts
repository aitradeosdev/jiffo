import { describe, expect, it, vi } from 'vitest';
import { emergencyNumberOf, FOLLOW_EVERY_MS, FOLLOW_FOR_MS, pressEmergency, type EmergencyDeps } from './emergency';

describe('the emergency button (E9)', () => {
  const deps = (over: Partial<EmergencyDeps> = {}) => {
    const order: string[] = [];
    let tick: (() => void) | null = null;
    const d: EmergencyDeps = {
      dial: vi.fn(() => void order.push('dial')),
      locate: vi.fn(async () => {
        order.push('locate');
        return { lat: 6.45, lng: 3.47, accuracy: 10 };
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
      ...over,
    };
    return { d, order, tick: () => tick?.(), ticking: () => tick !== null };
  };

  it('dials before anything goes over the network, then tells the safety team where and on which errand', async () => {
    const { d, order } = deps();
    expect(await pressEmergency(d, { number: '112', errandId: 'err-1' })).toBe('e1');
    expect(order).toEqual(['dial', 'locate', 'report']);
    expect(d.dial).toHaveBeenCalledWith('112');
    expect(d.report).toHaveBeenCalledWith({ errandId: 'err-1', lat: 6.45, lng: 3.47, accuracy: 10 });
  });

  it('still dials and reports with no location, and with no network still dials', async () => {
    const { d } = deps({ locate: async () => null });
    await pressEmergency(d, { number: '112' });
    expect(d.report).toHaveBeenCalledWith({});
    const offline = deps({ report: async () => Promise.reject(new Error('no network')) });
    expect(await pressEmergency(offline.d, { number: '112' })).toBeNull();
    expect(offline.d.dial).toHaveBeenCalled();
  });

  it('keeps sending where the person is for ten minutes, then stops', async () => {
    const { d, tick, ticking } = deps();
    await pressEmergency(d, { number: '112' });
    expect(d.every).toHaveBeenCalledWith(FOLLOW_EVERY_MS, expect.any(Function));
    const times = FOLLOW_FOR_MS / FOLLOW_EVERY_MS;
    for (let i = 0; i < times; i += 1) tick();
    await vi.waitFor(() => expect(d.follow).toHaveBeenCalledTimes(times));
    expect(d.follow).toHaveBeenCalledWith('e1', { lat: 6.45, lng: 3.47, accuracy: 10 });
    tick();
    expect(ticking()).toBe(false);
  });

  it("dials the country's number, or 112", () => {
    expect(emergencyNumberOf({ safety: { emergencyNumber: '199' } })).toBe('199');
    expect(emergencyNumberOf(undefined)).toBe('112');
  });
});
