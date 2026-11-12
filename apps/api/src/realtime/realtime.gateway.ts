import { Inject } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { eq } from 'drizzle-orm';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { DB, type Db } from '../db/database.module';
import { errands, type AppName } from '../db/schema';
import { SessionVerifier } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';

const userRoom = (userId: string, app: AppName) => `user:${userId}:${app}`;
const errandRoom = (errandId: string) => `errand:${errandId}`;
const SubscribeBody = z.object({ errandId: z.string().uuid() });

type Ack = { ok: true } | { ok: false; error: { code: string; message: string } };

/**
 * One socket per signed-in app. Clients join their own user room on connect and subscribe to the
 * errands they are part of. Tokens go in the handshake: io(url + '/realtime', { auth: { token } }).
 */
@WebSocketGateway({ namespace: '/realtime', cors: { origin: '*' } })
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() private readonly server: Namespace;
  constructor(
    private readonly verifier: SessionVerifier,
    @Inject(DB) private readonly db: Db,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
      if (typeof token !== 'string') throw new Error('missing token');
      const auth = await this.verifier.verify(token);
      client.data.auth = auth;
      await client.join(userRoom(auth.userId, auth.app));
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
    const allowed =
      !!errand &&
      ((auth.app === 'customer' && errand.customerId === auth.userId) ||
        (auth.app === 'agent' && errand.agentId === auth.userId));
    if (!allowed) return { ok: false, error: { code: 'errand_not_found', message: 'Errand not found' } };

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

  /** Drops sockets whose session just ended (logout, or "sign out other phones"). */
  disconnectWhere(match: (auth: AuthContext) => boolean) {
    if (!this.server) return;
    for (const socket of this.server.sockets.values()) {
      const auth = socket.data.auth as AuthContext | undefined;
      if (auth && match(auth)) socket.disconnect(true);
    }
  }
}
