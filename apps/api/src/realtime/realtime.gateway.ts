import { Inject, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { boardCell, boardCellsAround, DEFAULT_MATCHING_SETTINGS, DEFAULT_SECURITY_SETTINGS } from '@jiffo/shared';
import { and, eq, inArray } from 'drizzle-orm';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { DB, type Db } from '../db/database.module';
import { agentPresence, errandStops, errands, type AppName } from '../db/schema';
import { haversineMeters } from '../adapters/maps';
import { CountriesService } from '../countries/countries.service';
import { AgentApplicationService } from '../agents/application.service';
import { SessionVerifier } from '../auth/auth.guard';
import { RateLimiter } from '../common/rate-limit';
import type { AuthContext } from '../auth/auth.types';
import { participantRole } from '../errands/access';

const userRoom = (userId: string, app: AppName) => `user:${userId}:${app}`;
const sessionRoom = (sessionId: string) => `session:${sessionId}`;
const errandRoom = (errandId: string) => `errand:${errandId}`;
const ERRAND_PREFIX = 'errand:';
const SubscribeBody = z.object({ errandId: z.string().uuid() });
/** The board around a place (docs/matching.md, M11): agents watching it hear of errands coming on and going off. */
const boardRoom = (countryCode: string, cell: string) => `board:${countryCode}:${cell}`;
const BOARD_PREFIX = 'board:';
const WatchBody = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
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
    private readonly countries: CountriesService,
    private readonly applications: AgentApplicationService,
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
      await this.recheckBoard();
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

  /** An agent who went offline stops watching the board until they watch it again (M11). */
  private async recheckBoard() {
    const watching = [...this.server.sockets.values()].filter(
      (s) => s.connected && s.data.auth && [...s.rooms].some((r) => r.startsWith(BOARD_PREFIX)),
    );
    if (!watching.length) return;
    const watcherIds = [...new Set(watching.map((s) => (s.data.auth as AuthContext).userId))];
    const online = await this.db
      .select({ userId: agentPresence.userId })
      .from(agentPresence)
      .where(and(inArray(agentPresence.userId, watcherIds), eq(agentPresence.online, true)));
    const still = new Set(online.map((o) => o.userId));
    for (const socket of watching) {
      if (still.has((socket.data.auth as AuthContext).userId)) continue;
      for (const room of [...socket.rooms]) if (room.startsWith(BOARD_PREFIX)) await socket.leave(room);
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

  /**
   * An agent's app watches the board around where they are (docs/matching.md, M11): only around where their phone
   * last said they are, as the board itself answers, and only their own country's. Watching a new place stops
   * watching the last.
   */
  @SubscribeMessage('board.watch')
  async watchBoard(@ConnectedSocket() client: Socket, @MessageBody() body: unknown): Promise<Ack> {
    const auth = client.data.auth as AuthContext | undefined;
    const parsed = WatchBody.safeParse(body);
    if (!auth || auth.app !== 'agent' || !parsed.success) {
      return { ok: false, error: { code: 'invalid_request', message: 'Send lat and lng from the agent app' } };
    }
    if (!(await this.limiter.hit('presence', `u:${auth.userId}`)).ok) {
      return { ok: false, error: { code: 'rate_limited', message: 'Too many requests. Try again in a minute.' } };
    }
    const [[presence], current, approved] = await Promise.all([
      this.db
        .select({
          lat: agentPresence.lat,
          lng: agentPresence.lng,
          online: agentPresence.online,
          locatedAt: agentPresence.locatedAt,
        })
        .from(agentPresence)
        .where(eq(agentPresence.userId, auth.userId)),
      this.countries.currentSettingsIfAny(auth.countryCode),
      this.applications.approved(auth.userId),
    ]);
    // As the board itself: an approved agent, online, where their phone said they are a moment ago.
    if (!approved) {
      return {
        ok: false,
        error: {
          code: 'application_pending',
          message: 'Finish your application, and once it is approved you can take errands',
        },
      };
    }
    const nearKm = (current?.settings.security ?? DEFAULT_SECURITY_SETTINGS).boardNearKm;
    const matching = current?.settings.matching ?? DEFAULT_MATCHING_SETTINGS;
    const reachKm = matching.boardRadiusKm;
    const fresh =
      !!presence?.locatedAt && Date.now() - presence.locatedAt.getTime() <= matching.locationFreshMinutes * 60_000;
    if (!presence?.online || !fresh) {
      return { ok: false, error: { code: 'go_online', message: 'Go online to see and take errands' } };
    }
    if (presence.lat == null || presence.lng == null) {
      return { ok: false, error: { code: 'not_here', message: 'The board shows errands near where you are' } };
    }
    if (haversineMeters({ lat: presence.lat, lng: presence.lng }, parsed.data) > nearKm * 1000) {
      return { ok: false, error: { code: 'not_here', message: 'The board shows errands near where you are' } };
    }
    for (const room of [...client.rooms]) if (room.startsWith(BOARD_PREFIX)) await client.leave(room);
    await client.join(boardCellsAround(parsed.data, reachKm).map((cell) => boardRoom(auth.countryCode, cell)));
    return { ok: true };
  }

  /**
   * An errand came on the board, went off it (taken, cancelled, expired), or changed (a raised fee): agents
   * watching around its pickup are told, with its id alone. Not waited for by the change; a failure is logged.
   */
  boardChanged(errandId: string, change: 'added' | 'removed' | 'changed') {
    void (async () => {
      if (!this.server) return;
      const [pickup] = await this.db
        .select({ countryCode: errands.countryCode, lat: errandStops.lat, lng: errandStops.lng })
        .from(errands)
        .innerJoin(errandStops, and(eq(errandStops.errandId, errands.id), eq(errandStops.seq, 0)))
        .where(eq(errands.id, errandId));
      if (pickup) {
        this.server.to(boardRoom(pickup.countryCode, boardCell(pickup))).emit('board.changed', { errandId, change });
      }
    })().catch((error: Error) => this.logger.warn(`Telling the board of ${errandId} failed: ${error.message}`));
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
