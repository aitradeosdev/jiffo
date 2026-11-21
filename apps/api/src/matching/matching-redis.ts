import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

/**
 * Matching's own Redis connection: live agent positions and cached travel times, under REDIS_PREFIX. A
 * command waits while the connection opens, but never long: one not answered within a second fails, and the
 * callers carry on without it (the database's positions, estimated travel times).
 */
@Injectable()
export class MatchingRedis implements OnModuleDestroy {
  readonly client: IORedis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new IORedis(config.REDIS_URL, {
      keyPrefix: config.REDIS_PREFIX,
      maxRetriesPerRequest: 1,
      connectTimeout: 2_000,
      commandTimeout: 1_000,
    });
    this.client.on('error', () => undefined);
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
