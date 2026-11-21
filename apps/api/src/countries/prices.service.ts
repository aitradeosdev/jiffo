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

  /**
   * One change to a country's prices at a time, whether a place's prices or the country's settings they fall back
   * to: each is checked against the others' saved values, so two at once must not both pass on stale ones.
   */
  async lock(tx: Tx, countryCode: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'prices:' + countryCode}))`);
  }

  /**
   * Every state, city and area of a country that sets prices of its own, or sits below one that does, each with
   * the prices of its levels from the state down, to check against the country's settings.
   */
  async chains(countryCode: string, db: Db | Tx = this.db) {
    const { rows } = await db.execute<{
      name: string;
      state_id: string;
      city_id: string | null;
      area_id: string | null;
    }>(sql`
      select s.name, s.id as state_id, null::uuid as city_id, null::uuid as area_id from states s
        where s.country_code = ${countryCode}
      union all
      select c.name, c.state_id, c.id, null from cities c join states s on s.id = c.state_id
        where s.country_code = ${countryCode}
      union all
      select a.name, c.state_id, c.id, a.id from areas a join cities c on c.id = a.city_id
        join states s on s.id = c.state_id where s.country_code = ${countryCode}`);
    const places = rows.map((r) => [
      { scope: 'state' as const, id: r.state_id },
      ...(r.city_id ? [{ scope: 'city' as const, id: r.city_id }] : []),
      ...(r.area_id ? [{ scope: 'area' as const, id: r.area_id }] : []),
    ]);
    const saved = await this.latest([...new Map(places.flat().map((p) => [`${p.scope}:${p.id}`, p])).values()], db);
    return rows
      .map((r, i) => ({ name: r.name, chain: places[i]!.map((p) => saved.get(`${p.scope}:${p.id}`)!.data) }))
      .filter((p) => p.chain.some((data) => Object.keys(data).length > 0));
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
