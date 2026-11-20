import { requireOptionalNativeModule } from 'expo';
import type { PinnedHosts } from '../../src/security/pinning-core';

/**
 * Certificate pinning for WebSockets (docs/security/pinning.md, MB7), by the native module beside this file. The
 * pinning library pins React Native's requests only; socket.io's WebSocket, which carries the sign-in token too,
 * gets the same pins here. Absent in Expo Go and on the web.
 */
interface SocketPinningNative {
  pinWebSockets(hosts: PinnedHosts): Promise<void>;
}

const native = requireOptionalNativeModule<SocketPinningNative>('SocketPinning');

export const socketPinningAvailable = () => native !== null;

/** Pins WebSockets to these hosts' pins. Called after the requests' pins are set. */
export function pinWebSockets(hosts: PinnedHosts): Promise<void> {
  if (!native) return Promise.reject(new Error("This build can't pin WebSockets"));
  return native.pinWebSockets(hosts);
}
