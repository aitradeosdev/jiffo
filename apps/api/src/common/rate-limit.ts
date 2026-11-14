import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import IORedis from 'ioredis';
import { clientOf } from '../admin/admin.guard';
import type { AdminRequest } from '../admin/admin.types';
import { TokensService } from '../auth/tokens.service';
import { APP_CONFIG, type AppConfig } from '../config/app-config';
import { sha256 } from './crypto';
import { tooMany } from './errors';

/**
 * What a route is counted under (docs/security-plan.md, S5). Each class has its own limit a minute, per
 * signed-in person or, for anyone else, per network address; every request also counts towards its
 * address's overall limit ("ip").
 */
export const LIMIT_CLASSES = [
  'default',
  'paid',
  'board',
  'chat',
  'presence',
  'auth',
  'webhook',
  'socket',
  'ip',
] as const;
export type LimitClass = (typeof LIMIT_CLASSES)[number];

/** Requests a minute for each class, unless RATE_LIMITS says otherwise. */
const DEFAULT_LIMITS: Record<LimitClass, number> = {
  default: 240,
  // Each costs Jiffo a paid call (Google places, quotes).
  paid: 30,
  board: 30,
  chat: 60,
  presence: 60,
  auth: 30,
  webhook: 600,
  socket: 30,
  // Every request from one address. High, since mobile networks put many people behind one address.
  ip: 1_200,
};

/** RATE_LIMITS as "class=number,…", over the defaults; anything else in it is refused at start. */
export function parseLimits(text: string | undefined): Record<LimitClass, number> {
  const limits = { ...DEFAULT_LIMITS };
  for (const part of (text ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)) {
    const [name, value] = part.split('=').map((p) => p.trim());
    const n = Number(value);
    if (!LIMIT_CLASSES.includes(name as LimitClass) || !Number.isInteger(n) || n < 1) {
      throw new Error(`RATE_LIMITS: "${part}" isn't class=number (classes: ${LIMIT_CLASSES.join(', ')})`);
    }
    limits[name as LimitClass] = n;
  }
  return limits;
}

const LIMIT_KEY = 'jiffo:rate-limit';
/** Counts a route (or a controller's routes) under a class other than "default". */
export const RateLimit = (limit: LimitClass) => SetMetadata(LIMIT_KEY, limit);

/** Counts in Redis, so every server shares the same counts. A minute's window per key. */
@Injectable()
export class RateLimiter implements OnModuleDestroy {
  private readonly logger = new Logger('RateLimiter');
  private readonly redis: IORedis;
  readonly limits: Record<LimitClass, number>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.limits = parseLimits(config.RATE_LIMITS);
    this.redis = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.redis.on('error', () => undefined);
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }

  /**
   * Counts one request; refused once the minute's count passes the class's limit. With Redis down, requests
   * go through (logged): limits shouldn't take the whole API down with them.
   */
  async hit(limit: LimitClass, who: string): Promise<{ ok: boolean; retryAfterSeconds: number }> {
    const window = Math.floor(Date.now() / 60_000);
    const key = `rl:${limit}:${who}:${window}`;
    try {
      const [[, count]] = (await this.redis.multi().incr(key).pexpire(key, 61_000).exec()) as [[null, number]];
      const retryAfterSeconds = 60 - Math.floor((Date.now() / 1000) % 60);
      return { ok: count <= this.limits[limit], retryAfterSeconds };
    } catch (error) {
      this.logger.warn(`Rate limit not counted: ${(error as Error).message}`);
      return { ok: true, retryAfterSeconds: 0 };
    }
  }
}

/**
 * Every route is limited (docs/security-plan.md, S5): by its class, per signed-in person (from their access
 * token) or else per network address, and every request by its address's overall limit. The admin panel's
 * calls count by the admin's own address, which it passes on with the panel secret.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly tokens: TokensService,
    private readonly reflector: Reflector,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const limit =
      this.reflector.getAllAndOverride<LimitClass | undefined>(LIMIT_KEY, [context.getHandler(), context.getClass()]) ??
      'default';
    const ip = clientOf(req as AdminRequest, this.config).ip ?? 'unknown';
    const who = (await this.person(req)) ?? `ip:${ip}`;
    for (const [cls, key] of [
      ['ip', `ip:${ip}`],
      [limit, who],
    ] as const) {
      const { ok, retryAfterSeconds } = await this.limiter.hit(cls, key);
      if (!ok) {
        res.setHeader('retry-after', String(retryAfterSeconds));
        throw tooMany('rate_limited', 'Too many requests. Try again in a minute.', { retryAfterSeconds });
      }
    }
    return true;
  }

  /** The signed-in person, from a valid access token; an admin's by their token. Null for anyone else. */
  private async person(req: Request): Promise<string | null> {
    const header = req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return null;
    try {
      return `u:${(await this.tokens.verifyAccess(token)).userId}`;
    } catch {
      // An admin's token, or one that won't verify: counted by the token itself, which costs nothing to check.
      return `t:${sha256(token).slice(0, 32)}`;
    }
  }
}
