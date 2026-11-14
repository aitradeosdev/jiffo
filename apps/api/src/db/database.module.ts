import { Global, Inject, Injectable, Module, OnApplicationShutdown } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { keyFor } from '../common/keys';
import { useFieldKey } from './fields';
import { FieldsBackfill } from './fields-backfill';
import * as schema from './schema';

import { DB, PG_POOL } from './tokens';

export { DB, PG_POOL, type Db, type Tx } from './tokens';

@Injectable()
class PoolShutdown implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}
  async onApplicationShutdown() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new Pool({ connectionString: config.DATABASE_URL, max: 10 }),
    },
    {
      provide: DB,
      inject: [PG_POOL, APP_CONFIG],
      useFactory: (pool: Pool, config: AppConfig) => {
        // Personal details are encrypted at rest under their own key (see fields.ts).
        useFieldKey(keyFor(config, 'fields'));
        return drizzle(pool, { schema });
      },
    },
    PoolShutdown,
    FieldsBackfill,
  ],
  exports: [DB, PG_POOL],
})
export class DatabaseModule {}
