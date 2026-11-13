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
      auth: (cb) => {
        api.accessToken().then((token) => cb({ token }));
      },
    });
    setSocket(s);
    return () => {
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
