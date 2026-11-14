import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import { allowedOrigins, originAllowed } from '../common/origins';

/**
 * Socket.IO as every server runs it:
 * - only from the origins the HTTP API allows (CORS_ORIGINS), checked on every connection, WebSocket included;
 * - through Redis, so a room message, a leave or a disconnect reaches the sockets on every server, not just
 *   the one that sent it.
 */
export class ConfiguredIoAdapter extends IoAdapter {
  private readonly clients: IORedis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly config: { CORS_ORIGINS: string; REDIS_URL: string },
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: allowedOrigins(this.config.CORS_ORIGINS) },
      allowRequest: (req, done) => done(null, originAllowed(req.headers, this.config.CORS_ORIGINS)),
    } as ServerOptions);
    const pub = new IORedis(this.config.REDIS_URL, { maxRetriesPerRequest: null });
    const sub = pub.duplicate();
    this.clients.push(pub, sub);
    server.adapter(createAdapter(pub, sub));
    return server;
  }

  override async dispose() {
    await Promise.all(this.clients.map((c) => c.quit().catch(() => c.disconnect())));
  }
}
