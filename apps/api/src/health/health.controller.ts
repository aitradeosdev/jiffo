import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { unavailable } from '../common/errors';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** For the load balancer: 200 when the API can reach its database. */
  @Get()
  async check() {
    try {
      await this.db.execute(sql`select 1`);
    } catch {
      throw unavailable('database_unavailable', 'Database unreachable');
    }
    return { status: 'ok' };
  }
}
