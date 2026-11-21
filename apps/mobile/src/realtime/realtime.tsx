import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from '../config';
import { useSession } from '../auth/session';
import { pinningReady } from '../security/pinning';
import { watchAgain } from '../agent/board-order';

const RealtimeContext = createContext<Socket | null>(null);

/**
 * One socket per signed-in app, opened after sign-in and closed on sign-out. The access token is read
 * fresh on every (re)connect, so a refreshed token is picked up without restarting the socket.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { status, api } = useSession();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (status !== 'signedIn') return;
    let s: Socket | null = null;
    let closed = false;
    // The server drops a socket whose token it refuses, and socket.io won't reconnect on its own after
    // that. Try again with a fresh token, backing off, until it connects or the person signs out.
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const reconnectLater = () => {
      clearTimeout(retry);
      retry = setTimeout(() => s?.connect(), Math.min(30_000, 1_000 * 2 ** attempt++));
    };
    // Opened once certificate pinning has started, so the socket carries the same pins as requests (MB7).
    void pinningReady().then(() => {
      if (closed) return;
      s = io(`${API_URL}/realtime`, {
        transports: ['websocket'],
        // Read on every (re)connect. A failed token read still answers, so the handshake never hangs.
        auth: (cb) => {
          api
            .accessToken()
            .then((token) => cb({ token }))
            .catch(() => cb({ token: null }));
        },
      });
      s.on('ready', () => {
        attempt = 0;
      });
      s.on('auth_error', reconnectLater);
      s.on('disconnect', (reason) => {
        if (reason === 'io server disconnect') reconnectLater();
      });
      setSocket(s);
    });
    return () => {
      closed = true;
      clearTimeout(retry);
      s?.removeAllListeners();
      s?.disconnect();
      setSocket(null);
    };
  }, [status, api]);

  return <RealtimeContext.Provider value={socket}>{children}</RealtimeContext.Provider>;
}

/** Calls the handler for every event of this name while the screen is mounted. */
export function useRealtimeEvent<T>(event: string, handler: (payload: T) => void) {
  const socket = useContext(RealtimeContext);
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => {
    if (!socket) return;
    const listener = (payload: T) => latest.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [socket, event]);
}

/** How many mounted screens follow each errand, per connection, so one closing doesn't drop the others. */
const following = new WeakMap<object, Map<string, number>>();

/** Follows one errand's updates and chat while the screen is mounted. */
export function useErrandSubscription(errandId: string | undefined) {
  const socket = useContext(RealtimeContext);
  useEffect(() => {
    if (!socket || !errandId) return;
    let counts = following.get(socket);
    if (!counts) following.set(socket, (counts = new Map()));
    const join = () => socket.emit('errand.subscribe', { errandId });
    socket.on('ready', join);
    const n = counts.get(errandId) ?? 0;
    counts.set(errandId, n + 1);
    if (n === 0 && socket.connected) join();
    return () => {
      socket.off('ready', join);
      const left = (counts.get(errandId) ?? 1) - 1;
      if (left > 0) return void counts.set(errandId, left);
      counts.delete(errandId);
      socket.emit('errand.unsubscribe', { errandId });
    };
  }, [socket, errandId]);
}

/**
 * The agent's board, kept live (docs/matching.md, M11): while online, the app tells the server where it is, so it
 * hears of errands coming on and going off the board around there. Told again after moving a km, every five
 * minutes, and on reconnecting. Null stops nothing: the server forgets on disconnect.
 */
export function useBoardWatch(at: { lat: number; lng: number } | null) {
  const socket = useContext(RealtimeContext);
  const last = useRef<{ at: { lat: number; lng: number }; when: number } | null>(null);
  const here = useRef(at);
  here.current = at;
  useEffect(() => {
    if (!socket) return;
    // A new connection has joined no board rooms: watch again at once.
    const again = () => {
      last.current = null;
      const now = here.current;
      if (now) {
        last.current = { at: now, when: Date.now() };
        socket.emit('board.watch', now);
      }
    };
    socket.on('ready', again);
    return () => {
      socket.off('ready', again);
    };
  }, [socket]);
  // Refused (the server hasn't the agent's latest position yet, or too many asks): asked again shortly, rather
  // than going without live updates until the agent moves on or five minutes pass.
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => clearTimeout(retry.current ?? undefined), []);
  useEffect(() => {
    if (!socket || !at || !socket.connected) return;
    if (!watchAgain(last.current, at, Date.now())) return;
    last.current = { at, when: Date.now() };
    socket
      .timeout(10_000)
      .emitWithAck('board.watch', at)
      .then((ack: { ok: boolean }) => {
        if (ack?.ok) return;
        last.current = null;
        clearTimeout(retry.current ?? undefined);
        retry.current = setTimeout(() => {
          const now = here.current;
          if (!now || !socket.connected) return;
          last.current = { at: now, when: Date.now() };
          socket.emit('board.watch', now);
        }, 15_000);
      })
      .catch(() => {
        last.current = null;
      });
  }, [socket, at]);
}
