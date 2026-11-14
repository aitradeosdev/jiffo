import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import IORedis from 'ioredis';
import type { ServerOptions } from 'socket.io';
import type { IncomingMessage } from 'node:http';
import { allowedOrigins, originAllowed } from '../common/origins';
import type { RateLimiter } from '../common/rate-limit';

/** The caller's address, believing as many forwarding hops as TRUST_PROXY_HOPS says, as Express does. */
function addressOf(req: IncomingMessage, hops: number) {
  const forwarded = req.headers['x-forwarded-for'];
  const list = (Array.isArray(forwarded) ? forwarded.join(',') : (forwarded ?? ''))
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .reverse();
  const chain = [req.socket.remoteAddress ?? 'unknown', ...list];
  return chain[Math.min(hops, chain.length - 1)]!;
}

/**
 * Socket.IO as every server runs it:
 * - only from the origins the HTTP API allows (CORS_ORIGINS), checked on every connection, WebSocket included;
 * - through Redis, so a room message, a leave or a disconnect reaches the sockets on every server, not just
 *   the one that sent it;
 * - a limited number of new connections a minute per address (docs/security-plan.md, S5).
 */
export class ConfiguredIoAdapter extends IoAdapter {
  private readonly clients: IORedis[] = [];

  constructor(
    app: INestApplicationContext,
    private readonly config: { CORS_ORIGINS: string; REDIS_URL: string; TRUST_PROXY_HOPS?: number },
    private readonly limiter?: RateLimiter,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: allowedOrigins(this.config.CORS_ORIGINS) },
      allowRequest: (req, done) => {
        if (!originAllowed(req.headers, this.config.CORS_ORIGINS)) return done(null, false);
        if (!this.limiter) return done(null, true);
        void this.limiter
          .hit('socket', `ip:${addressOf(req, this.config.TRUST_PROXY_HOPS ?? 0)}`)
          .then(({ ok }) => done(ok ? null : 'Too many connections. Try again in a minute.', ok));
      },
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
