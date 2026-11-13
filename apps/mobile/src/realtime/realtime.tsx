import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL } from '../config';
import { useSession } from '../auth/session';

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
    const s = io(`${API_URL}/realtime`, {
      transports: ['websocket'],
      // Read on every (re)connect. A failed token read still answers, so the handshake never hangs.
      auth: (cb) => {
        api
          .accessToken()
          .then((token) => cb({ token }))
          .catch(() => cb({ token: null }));
      },
    });
    // The server drops a socket whose token it refuses, and socket.io won't reconnect on its own after
    // that. Try again with a fresh token, backing off, until it connects or the person signs out.
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const reconnectLater = () => {
      clearTimeout(retry);
      retry = setTimeout(() => s.connect(), Math.min(30_000, 1_000 * 2 ** attempt++));
    };
    s.on('ready', () => {
      attempt = 0;
    });
    s.on('auth_error', reconnectLater);
    s.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') reconnectLater();
    });
    setSocket(s);
    return () => {
      clearTimeout(retry);
      s.removeAllListeners();
      s.disconnect();
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

/** Follows one errand's updates and chat while the screen is mounted. */
export function useErrandSubscription(errandId: string | undefined) {
  const socket = useContext(RealtimeContext);
  useEffect(() => {
    if (!socket || !errandId) return;
    const join = () => socket.emit('errand.subscribe', { errandId });
    socket.on('ready', join);
    if (socket.connected) join();
    return () => {
      socket.off('ready', join);
      socket.emit('errand.unsubscribe', { errandId });
    };
  }, [socket, errandId]);
}
