import { describe, expect, it } from 'vitest';
import { pinningFor } from '../app.config';

/**
 * Certificate pinning's build settings (docs/security/pinning.md, MB7). Pinning ships off: with no pins set the
 * apps pin nothing. Once pins are set, the build stops unless they follow the rules: certificate authorities'
 * keys, at least two, from two different authorities, with an end date, and a signed remote switch to turn it
 * off from a host that isn't pinned.
 */
describe('pinning build settings', () => {
  const hash = (fill: string) => Buffer.alloc(32, fill).toString('base64');
  const TODAY = Date.parse('2026-11-20T12:00:00Z');
  const ready = {
    EXPO_PUBLIC_API_URL: 'https://api.jiffo.example',
    PINNING_PINS: `isrg-root-x1:${hash('a')},gts-root-r1:${hash('b')}`,
    PINNING_EXPIRES: '2027-09-30',
    PINNING_SWITCH_URL: 'https://status.jiffo-cdn.example/pinning.json',
    PINNING_SWITCH_KEY: hash('k'),
  };

  it('pins nothing until pins are set', () => {
    expect(pinningFor({}, TODAY)).toBeNull();
    expect(pinningFor({ EXPO_PUBLIC_API_URL: 'https://api.jiffo.example', PINNING_PINS: '' }, TODAY)).toBeNull();
  });

  it("pins the API's host to the authorities' keys, until the end date", () => {
    expect(pinningFor(ready, TODAY)).toEqual({
      hosts: ['api.jiffo.example'],
      pins: [
        { ca: 'isrg-root-x1', hash: hash('a') },
        { ca: 'gts-root-r1', hash: hash('b') },
      ],
      expires: '2027-09-30',
      switchUrl: 'https://status.jiffo-cdn.example/pinning.json',
      switchKey: hash('k'),
    });
    expect(pinningFor({ ...ready, PINNING_HOSTS: 'api.jiffo.example, ws.jiffo.example' }, TODAY)?.hosts).toEqual([
      'api.jiffo.example',
      'ws.jiffo.example',
    ]);
  });

  it('stops a build with fewer than two pins, or pins from one authority only', () => {
    expect(() => pinningFor({ ...ready, PINNING_PINS: `isrg-root-x1:${hash('a')}` }, TODAY)).toThrow(/two/);
    expect(() =>
      pinningFor({ ...ready, PINNING_PINS: `isrg-root-x1:${hash('a')},isrg-root-x1:${hash('b')}` }, TODAY),
    ).toThrow(/two different/);
    expect(() =>
      pinningFor({ ...ready, PINNING_PINS: `isrg-root-x1:${hash('a')},gts-root-r1:${hash('a')}` }, TODAY),
    ).toThrow(/twice/);
  });

  it('stops a build with a pin that is not a SHA-256 key hash, or an unnamed authority', () => {
    expect(() => pinningFor({ ...ready, PINNING_PINS: `isrg-root-x1:abc,gts-root-r1:${hash('b')}` }, TODAY)).toThrow(
      /SHA-256/,
    );
    expect(() => pinningFor({ ...ready, PINNING_PINS: `${hash('a')},gts-root-r1:${hash('b')}` }, TODAY)).toThrow(
      /authority/,
    );
  });

  it('stops a build without an end date, or one past, or more than 13 months away', () => {
    const { PINNING_EXPIRES: _, ...noEnd } = ready;
    expect(() => pinningFor(noEnd, TODAY)).toThrow(/PINNING_EXPIRES/);
    expect(() => pinningFor({ ...ready, PINNING_EXPIRES: '30/09/2027' }, TODAY)).toThrow(/PINNING_EXPIRES/);
    expect(() => pinningFor({ ...ready, PINNING_EXPIRES: '2026-11-20' }, TODAY)).toThrow(/PINNING_EXPIRES/);
    expect(() => pinningFor({ ...ready, PINNING_EXPIRES: '2028-06-01' }, TODAY)).toThrow(/13 months/);
  });

  it('stops a build without a signed switch it can reach when the pins fail', () => {
    const { PINNING_SWITCH_URL: _u, ...noUrl } = ready;
    expect(() => pinningFor(noUrl, TODAY)).toThrow(/PINNING_SWITCH_URL/);
    const { PINNING_SWITCH_KEY: _k, ...noKey } = ready;
    expect(() => pinningFor(noKey, TODAY)).toThrow(/PINNING_SWITCH_KEY/);
    expect(() => pinningFor({ ...ready, PINNING_SWITCH_KEY: 'short' }, TODAY)).toThrow(/PINNING_SWITCH_KEY/);
    expect(() => pinningFor({ ...ready, PINNING_SWITCH_URL: 'http://status.jiffo-cdn.example/p.json' }, TODAY)).toThrow(
      /https/,
    );
    // On a pinned host it couldn't be fetched when the pins fail, which is when it's needed.
    expect(() =>
      pinningFor({ ...ready, PINNING_SWITCH_URL: 'https://api.jiffo.example/pinning.json' }, TODAY),
    ).toThrow(/pinned/);
  });

  it('stops a build that pins an API it reaches without HTTPS', () => {
    expect(() => pinningFor({ ...ready, EXPO_PUBLIC_API_URL: 'http://192.168.1.20:3000' }, TODAY)).toThrow(/https/);
  });
});
