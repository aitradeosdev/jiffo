import type { PinningState } from './pinning-core';

/**
 * Certificate pinning on the web: the browser checks certificates itself, and the app can't pin there
 * (docs/security/pinning.md). Phones use pinning.native.ts.
 */
export const pinningReady = (): Promise<PinningState> => Promise.resolve('unavailable');

export const pinnedFetch: typeof fetch = (input, init) => fetch(input, init);
