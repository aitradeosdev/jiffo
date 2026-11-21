import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

/**
 * Matching's own Redis connection: live agent positions and cached travel times, under REDIS_PREFIX. A
 * command waits for the connection rather than failing while it opens, and fails fast once it's open and lost.
 */
@Injectable()
export class MatchingRedis implements OnModuleDestroy {
  readonly client: IORedis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new IORedis(config.REDIS_URL, { keyPrefix: config.REDIS_PREFIX, maxRetriesPerRequest: 1 });
    this.client.on('error', () => undefined);
  }

  async onModuleDestroy() {
    await this.client.quit().catch(() => this.client.disconnect());
  }
}
