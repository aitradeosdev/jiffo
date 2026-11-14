import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { eq, inArray } from 'drizzle-orm';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { DB, type Db } from '../db/database.module';
import { errands, type AppName } from '../db/schema';
import { SessionVerifier } from '../auth/auth.guard';
import { RateLimiter } from '../common/rate-limit';
import type { AuthContext } from '../auth/auth.types';
import { participantRole } from '../errands/access';

const userRoom = (userId: string, app: AppName) => `user:${userId}:${app}`;
const sessionRoom = (sessionId: string) => `session:${sessionId}`;
const errandRoom = (errandId: string) => `errand:${errandId}`;
const ERRAND_PREFIX = 'errand:';
const SubscribeBody = z.object({ errandId: z.string().uuid() });
/** How often each server checks its own sockets' sessions and errand rooms. */
const SWEEP_MS = 30_000;
/** How many errands one re-check reads at a time. */
const ERRAND_BATCH = 1000;

type Ack = { ok: true } | { ok: false; error: { code: string; message: string } };

/**
 * One socket per signed-in app. Clients join their own user room on connect and subscribe to the
 * errands they are part of. Tokens go in the handshake: io(url + '/realtime', { auth: { token } }).
 * Rooms live in Redis (see io-adapter.ts), so leaving and disconnecting reach every server.
 */
@WebSocketGateway({ namespace: '/realtime' })
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() private readonly server: Namespace;
  private readonly logger = new Logger('Realtime');
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;
  constructor(
    private readonly verifier: SessionVerifier,
    @Inject(DB) private readonly db: Db,
    private readonly limiter: RateLimiter,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.sweep(), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /**
   * Checks every socket on this server again (docs/security-plan.md, C4), as a safety net behind the
   * disconnects sent at sign-out and suspension: one whose session ended or expired is dropped, and one in an
   * errand's room it is no longer part of leaves it. Each server sweeps its own sockets. A sweep still running
   * when the next is due is not doubled, and a failed one is logged.
   */
  async sweep() {
    if (!this.server || this.sweeping) return;
    this.sweeping = true;
    try {
      await this.recheck();
    } catch (error) {
      this.logger.error(`Re-checking live connections failed: ${(error as Error).message}`);
    } finally {
      this.sweeping = false;
    }
  }

  private async recheck() {
    const live = [...this.server.sockets.values()].filter((s) => s.data.auth);
    if (!live.length) return;
    const ok = await this.verifier.liveSessions([...new Set(live.map((s) => (s.data.auth as AuthContext).sessionId))]);
    const errandIds = new Set<string>();
    for (const socket of live) {
      if (!ok.has((socket.data.auth as AuthContext).sessionId)) {
        socket.emit('auth_error', { code: 'session_ended', message: 'Sign in again' });
        socket.disconnect(true);
        continue;
      }
      for (const room of socket.rooms)
        if (room.startsWith(ERRAND_PREFIX)) errandIds.add(room.slice(ERRAND_PREFIX.length));
    }
    if (!errandIds.size) return;
    const ids = [...errandIds];
    const byId = new Map<string, { customerId: string; agentId: string | null }>();
    for (let i = 0; i < ids.length; i += ERRAND_BATCH) {
      const rows = await this.db
        .select({ id: errands.id, customerId: errands.customerId, agentId: errands.agentId })
        .from(errands)
        .where(inArray(errands.id, ids.slice(i, i + ERRAND_BATCH)));
      for (const row of rows) byId.set(row.id, row);
    }
    for (const socket of live) {
      if (!socket.connected) continue;
      const auth = socket.data.auth as AuthContext;
      for (const room of [...socket.rooms]) {
        if (!room.startsWith(ERRAND_PREFIX)) continue;
        if (!participantRole(byId.get(room.slice(ERRAND_PREFIX.length)), auth)) await socket.leave(room);
      }
    }
  }

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string') throw new Error('missing token');
      const auth = await this.verifier.verify(token);
      // New connections are limited per person (docs/security-plan.md, S5): a phone reconnecting on a poor
      // network is one person, however many others share its address.
      if (!(await this.limiter.hit('socket', `u:${auth.userId}`)).ok) {
        client.emit('auth_error', { code: 'rate_limited', message: 'Too many connections. Try again in a minute.' });
        client.disconnect(true);
        return;
      }
      client.data.auth = auth;
      await client.join([userRoom(auth.userId, auth.app), sessionRoom(auth.sessionId)]);
      client.emit('ready', { userId: auth.userId, app: auth.app });
    } catch {
      client.emit('auth_error', { code: 'invalid_token', message: 'Sign in again' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('errand.subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<Ack> {
    const auth = client.data.auth as AuthContext | undefined;
    const parsed = SubscribeBody.safeParse(body);
    if (!auth || !parsed.success) return { ok: false, error: { code: 'invalid_request', message: 'Send an errandId' } };

    const [errand] = await this.db
      .select({ customerId: errands.customerId, agentId: errands.agentId })
      .from(errands)
      .where(eq(errands.id, parsed.data.errandId));
    if (!participantRole(errand, auth))
      return { ok: false, error: { code: 'errand_not_found', message: 'Errand not found' } };

    await client.join(errandRoom(parsed.data.errandId));
    return { ok: true };
  }

  @SubscribeMessage('errand.unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<Ack> {
    const parsed = SubscribeBody.safeParse(body);
    if (parsed.success) await client.leave(errandRoom(parsed.data.errandId));
    return { ok: true };
  }

  toErrand(errandId: string, event: string, payload: unknown) {
    this.server?.to(errandRoom(errandId)).emit(event, payload);
  }

  toUser(userId: string, app: AppName, event: string, payload: unknown) {
    this.server?.to(userRoom(userId, app)).emit(event, payload);
  }

  /** An agent who left an errand stops receiving its updates straight away. */
  removeFromErrand(userId: string, app: AppName, errandId: string) {
    this.server?.in(userRoom(userId, app)).socketsLeave(errandRoom(errandId));
  }

  /** Drops the sockets of sessions that just ended (sign-out, "sign out other phones"), on every server. */
  disconnectSessions(sessionIds: string[]) {
    if (!this.server || !sessionIds.length) return;
    this.server.in(sessionIds.map(sessionRoom)).disconnectSockets(true);
  }

  /** Drops every socket of a person, in both apps and on every server: when they are suspended. */
  disconnectUser(userId: string) {
    this.server?.in([userRoom(userId, 'customer'), userRoom(userId, 'agent')]).disconnectSockets(true);
  }
}
