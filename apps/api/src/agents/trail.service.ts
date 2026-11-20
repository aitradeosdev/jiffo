import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/database.module';
import { errandTrail } from '../db/schema';

/** Trails are deleted this long after each point, unless held (docs/security-plan.md, G4). */
export const TRAIL_KEEP_DAYS = 90;
const PRUNE_BATCH = 10_000;

export interface TrailPosition {
  lat: number;
  lng: number;
  mocked: boolean;
  at: Date;
}

/**
 * Where the agent was while out on each errand (docs/security-plan.md, G1, G3, G4, E6): written from the
 * phone's reports only while they are out on one, so being online alone leaves no trail.
 */
@Injectable()
export class TrailService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** A position the agent's phone reported, for each errand they are out on. */
  async record(agentId: string, errandIds: string[], position: TrailPosition) {
    if (!errandIds.length) return;
    await this.db.insert(errandTrail).values(errandIds.map((errandId) => ({ errandId, agentId, ...position })));
  }

  /** An errand's trail, oldest first. */
  of(errandId: string) {
    return this.db
      .select({ lat: errandTrail.lat, lng: errandTrail.lng, mocked: errandTrail.mocked, at: errandTrail.at })
      .from(errandTrail)
      .where(eq(errandTrail.errandId, errandId))
      .orderBy(asc(errandTrail.at), asc(errandTrail.id));
  }

  /**
   * Daily: points older than 90 days go, unless their errand is in dispute or a flag on it is still open, as
   * a dispute or an investigation still needs them. A batch at a time, so a long backlog doesn't hold locks.
   */
  async prune() {
    let deleted = 0;
    for (;;) {
      const { rows } = await this.db.execute<{ id: number }>(sql`
        delete from ${errandTrail} where id in (
          select t.id from ${errandTrail} t
          where t.at < now() - make_interval(days => ${TRAIL_KEEP_DAYS})
            and not exists (select 1 from errands e where e.id = t.errand_id and e.status = 'disputed')
            and not exists (select 1 from risk_flag_errands fe join risk_flags f on f.id = fe.flag_id
              where fe.errand_id = t.errand_id and f.status = 'open')
          limit ${PRUNE_BATCH})
        returning id`);
      deleted += rows.length;
      if (rows.length < PRUNE_BATCH) return { deleted };
    }
  }
}
