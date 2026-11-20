import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { switchPayload, type PinningSwitch } from '@jiffo/shared';
import { startPinning, type PinningDeps } from './pinning-core';

/**
 * Certificate pinning as the app starts (docs/security/pinning.md, MB7): nothing when the build has no pins;
 * otherwise the signed remote switch is read first, and the API's hosts are pinned for requests and WebSockets
 * unless the switch has turned pinning off for now, or the pins' end date has passed.
 */
describe('starting certificate pinning', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const switchKey = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const now = Date.parse('2026-11-20T12:00:00Z');
  const HOUR = 3_600_000;
  const config = {
    hosts: ['api.jiffo.example'],
    pins: [
      { ca: 'isrg-root-x1', hash: Buffer.alloc(32, 'a').toString('base64') },
      { ca: 'gts-root-r1', hash: Buffer.alloc(32, 'b').toString('base64') },
    ],
    expires: '2027-09-30',
    switchUrl: 'https://status.jiffo-cdn.example/pinning.json',
    switchKey,
    // Built a month before the tests' "now".
    issuedAfter: new Date(Date.parse('2026-10-20T12:00:00Z')).toISOString(),
  };
  const signed = (s: PinningSwitch) => {
    const payload = switchPayload(s);
    return { payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') };
  };

  const setup = (over: Partial<PinningDeps> = {}, kept: string | null = null) => {
    let stored = kept;
    const native = {
      available: vi.fn(() => true),
      pinRequests: vi.fn(async () => {}),
      pinWebSockets: vi.fn(async () => {}),
      unpinRequests: vi.fn(async () => {}),
    };
    const deps: PinningDeps = {
      config,
      now: () => now,
      fetchSwitch: vi.fn(async () => {
        throw new Error('unreachable');
      }),
      verify: (message, signature, key) =>
        verify(
          null,
          message,
          {
            key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key)]),
            format: 'der',
            type: 'spki',
          },
          signature,
        ),
      storage: { get: async () => stored, set: async (v) => void (stored = v) },
      native,
      ...over,
    };
    return { deps, native, stored: () => stored };
  };
  const pinned = {
    'api.jiffo.example': {
      includeSubdomains: false,
      publicKeyHashes: config.pins.map((p) => p.hash),
      expirationDate: '2027-09-30',
    },
  };

  it('pins nothing in a build without pins', async () => {
    const { deps, native } = setup({ config: null });
    expect(await startPinning(deps)).toBe('not_built');
    expect(native.pinRequests).not.toHaveBeenCalled();
    expect(deps.fetchSwitch).not.toHaveBeenCalled();
  });

  it("pins the API's hosts for requests and WebSockets, also when the switch can't be fetched", async () => {
    const { deps, native } = setup();
    expect(await startPinning(deps)).toBe('on');
    expect(native.pinRequests).toHaveBeenCalledWith(pinned);
    expect(native.pinWebSockets).toHaveBeenCalledWith(pinned);
  });

  it('pins nothing once the end date has passed: normal certificate checks', async () => {
    const { deps, native } = setup({ now: () => Date.parse('2027-09-30T00:00:01Z') });
    expect(await startPinning(deps)).toBe('expired');
    expect(native.pinRequests).not.toHaveBeenCalled();
  });

  it('pins nothing while a signed switch has it off, and keeps that switch', async () => {
    const off = {
      pinning: 'off',
      issuedAt: new Date(now - HOUR).toISOString(),
      until: new Date(now + HOUR).toISOString(),
    } as const;
    const { deps, native, stored } = setup({ fetchSwitch: vi.fn(async () => signed(off)) });
    expect(await startPinning(deps)).toBe('switched_off');
    expect(native.pinRequests).not.toHaveBeenCalled();
    expect(JSON.parse(stored()!)).toEqual(off);
  });

  it('keeps a switch it took when the next start finds none, until it ends', async () => {
    const off = {
      pinning: 'off',
      issuedAt: new Date(now - HOUR).toISOString(),
      until: new Date(now + HOUR).toISOString(),
    };
    expect(await startPinning(setup({}, JSON.stringify(off)).deps)).toBe('switched_off');
    expect(await startPinning(setup({ now: () => now + 2 * HOUR }, JSON.stringify(off)).deps)).toBe('on');
  });

  it("pins when the switch isn't signed with the build's key, or replays an older one", async () => {
    const { privateKey: otherKey } = generateKeyPairSync('ed25519');
    const off = {
      pinning: 'off',
      issuedAt: new Date(now - HOUR).toISOString(),
      until: new Date(now + HOUR).toISOString(),
    } as const;
    const payload = switchPayload(off);
    const forged = { payload, signature: sign(null, Buffer.from(payload), otherKey).toString('base64') };
    expect(await startPinning(setup({ fetchSwitch: vi.fn(async () => forged) }).deps)).toBe('on');

    const onLater = JSON.stringify({ pinning: 'on', issuedAt: new Date(now - HOUR / 2).toISOString() });
    expect(await startPinning(setup({ fetchSwitch: vi.fn(async () => signed(off)) }, onLater).deps)).toBe('on');
  });

  it("refuses an off signed before the build, so an old one can't be replayed to a new install", async () => {
    const off = {
      pinning: 'off',
      issuedAt: new Date(now - 2 * HOUR).toISOString(),
      until: new Date(now + HOUR).toISOString(),
    } as const;
    const builtLater = { ...config, issuedAfter: new Date(now - HOUR).toISOString() };
    expect(await startPinning(setup({ config: builtLater, fetchSwitch: vi.fn(async () => signed(off)) }).deps)).toBe(
      'on',
    );
    const builtEarlier = { ...config, issuedAfter: new Date(now - 3 * HOUR).toISOString() };
    expect(await startPinning(setup({ config: builtEarlier, fetchSwitch: vi.fn(async () => signed(off)) }).deps)).toBe(
      'switched_off',
    );
  });

  it("takes the request pins off again when the WebSockets can't be pinned, so both are checked alike", async () => {
    const native = {
      available: () => true,
      pinRequests: vi.fn(async () => {}),
      pinWebSockets: vi.fn(async () => {
        throw new Error('no WebSocket pinning');
      }),
      unpinRequests: vi.fn(async () => {}),
    };
    expect(await startPinning(setup({ native }).deps)).toBe('failed');
    expect(native.unpinRequests).toHaveBeenCalled();
  });

  it("goes on without pins where the app can't pin (Expo Go, the web), or the native side fails", async () => {
    expect(
      await startPinning(
        setup({
          native: { available: () => false, pinRequests: vi.fn(), pinWebSockets: vi.fn(), unpinRequests: vi.fn() },
        }).deps,
      ),
    ).toBe('unavailable');
    const failing = {
      available: () => true,
      pinRequests: vi.fn(async () => {
        throw new Error('TrustKit');
      }),
      pinWebSockets: vi.fn(),
      unpinRequests: vi.fn(async () => {}),
    };
    expect(await startPinning(setup({ native: failing }).deps)).toBe('failed');
  });
});
