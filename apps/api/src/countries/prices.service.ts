import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { resolvePrices, type CountrySettings, type PriceOverride, type Prices } from '@jiffo/shared';
import { DB, type Db, type Tx } from '../db/database.module';
import type { ServedAt } from './service-areas';

export type PriceScope = 'state' | 'city' | 'area';
/** The prices one place sets now, and their version: 0, with nothing set, before the first. */
export type SavedPrices = { version: number; data: PriceOverride };

/**
 * Prices per state, city and area (Settings, Places): the latest each place sets, and the prices for a point from
 * its area, city and state, each value from the nearest that sets it, then the country's settings.
 */
@Injectable()
export class PricesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The latest prices each of these places sets, keyed `scope:id`; a place with none has version 0. */
  async latest(places: Array<{ scope: PriceScope; id: string }>, db: Db | Tx = this.db) {
    const found = new Map<string, SavedPrices>(places.map((p) => [`${p.scope}:${p.id}`, { version: 0, data: {} }]));
    if (!places.length) return found;
    const wanted = JSON.stringify(places.map((p) => ({ scope: p.scope, id: p.id })));
    const { rows } = await db.execute<{
      scope: PriceScope;
      scope_id: string;
      version: number;
      data: PriceOverride;
    }>(sql`
      select distinct on (o.scope, o.scope_id) o.scope, o.scope_id, o.version, o.data
      from price_overrides o
      join jsonb_to_recordset(${wanted}::jsonb) as w(scope text, id uuid) on w.scope = o.scope and w.id = o.scope_id
      order by o.scope, o.scope_id, o.version desc`);
    for (const r of rows) found.set(`${r.scope}:${r.scope_id}`, { version: r.version, data: r.data });
    return found;
  }

  /** The prices where a point is served: its area's, city's and state's, then the country's. */
  async pricesAt(
    settings: CountrySettings,
    at: Pick<ServedAt, 'stateId' | 'cityId' | 'areaId'>,
    db: Db | Tx = this.db,
  ) {
    const chain: Array<{ scope: PriceScope; id: string }> = [
      { scope: 'state', id: at.stateId },
      { scope: 'city', id: at.cityId },
      { scope: 'area', id: at.areaId },
    ];
    const saved = await this.latest(chain, db);
    return resolvePrices(
      settings,
      chain.map((p) => saved.get(`${p.scope}:${p.id}`)!.data),
    ) satisfies Prices;
  }
}
