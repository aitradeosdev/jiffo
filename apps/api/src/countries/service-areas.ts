import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { DB, type Db, type Tx } from '../db/database.module';

const Position = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);
const Ring = z.array(Position).min(4).max(5_000);

/**
 * A boundary as admin draws it on the map: a GeoJSON polygon, or several. Positions are [longitude, latitude];
 * at most 5,000 of them in all, which is far more than a hand-drawn shape needs.
 */
export const BoundaryInput = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('Polygon'), coordinates: z.array(Ring).min(1).max(50) }),
    z.object({ type: z.literal('MultiPolygon'), coordinates: z.array(z.array(Ring).min(1).max(50)).min(1).max(50) }),
  ])
  .refine(
    (b) => (b.type === 'Polygon' ? b.coordinates.flat() : b.coordinates.flat(2)).length <= 5_000,
    'At most 5,000 points',
  );
export type BoundaryInput = z.infer<typeof BoundaryInput>;

/** The boundary as PostGIS takes it: always a MultiPolygon, in WGS 84. */
export const shapeOf = (boundary: BoundaryInput) =>
  sql`ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(boundary)}), 4326))`;

/** Where a point is in Jiffo's map of where it works: its area, city and state. */
export type ServedAt = {
  areaId: string;
  areaName: string;
  cityId: string;
  cityName: string;
  stateId: string;
  stateCode: string;
  stateName: string;
};

/**
 * Where Jiffo works (docs/admin-panel.md, Places): areas drawn by admin, in cities, in states. A point is served
 * when it is inside an area that is switched on, in a city, state and country that are switched on too.
 */
@Injectable()
export class ServiceAreasService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** For each point, in order, the switched-on area it is in, or null where Jiffo doesn't work. */
  async servedAt(countryCode: string, points: Array<{ lat: number; lng: number }>, db: Db | Tx = this.db) {
    if (!points.length) return [];
    const at = JSON.stringify(points.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) })));
    const { rows } = await db.execute<ServedAt & { idx: number | string }>(sql`
      select p.idx, a.id as "areaId", a.name as "areaName", c.id as "cityId", c.name as "cityName",
        s.id as "stateId", s.code as "stateCode", s.name as "stateName"
      from (
        select (e->>'lng')::float8 as lng, (e->>'lat')::float8 as lat, idx
        from jsonb_array_elements(${at}::jsonb) with ordinality as x(e, idx)
      ) p
      left join lateral (
        select a.id, a.name, a.city_id from areas a
        join cities c on c.id = a.city_id and c.enabled
        join states s on s.id = c.state_id and s.enabled and s.country_code = ${countryCode}
        join countries k on k.code = s.country_code and k.enabled
        where a.enabled and ST_Covers(a.boundary, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326))
        -- Two areas can share a hand-drawn edge: the one whose city the point is really in comes first.
        order by ST_Covers(c.boundary, ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326)) desc, a.name
        limit 1
      ) a on true
      left join cities c on c.id = a.city_id
      left join states s on s.id = c.state_id
      order by p.idx`);
    return rows.map((r) =>
      r.areaId
        ? {
            areaId: r.areaId,
            areaName: r.areaName,
            cityId: r.cityId,
            cityName: r.cityName,
            stateId: r.stateId,
            stateCode: r.stateCode,
            stateName: r.stateName,
          }
        : null,
    );
  }
}

/**
 * Roughly Lagos State, for development and tests: drawn as one city with one area, so errands can be tried before
 * anyone has drawn real ones (`pnpm admin dev-areas`). A rough outline that keeps off Ogun State's towns over the
 * border, such as Sango-Ota. Never used in production.
 */
export const LAGOS_DEV_BOUNDARY: BoundaryInput = {
  type: 'Polygon',
  coordinates: [
    [
      [2.7, 6.37],
      [4.35, 6.37],
      [4.35, 6.55],
      [3.95, 6.65],
      [3.65, 6.7],
      [3.4, 6.7],
      [3.3, 6.64],
      [3.15, 6.6],
      [3.05, 6.47],
      [2.7, 6.47],
      [2.7, 6.37],
    ],
  ],
};

/** Adds the development city and area for Lagos, switched on, unless Lagos already has a city drawn. */
export async function addDevLagos(db: Db) {
  const { rows } = await db.execute<{ id: string }>(sql`
    select s.id from states s where s.country_code = 'NG' and s.code = 'LA'
      and not exists (select 1 from cities c where c.state_id = s.id)`);
  const state = rows[0];
  if (!state) return false;
  const shape = shapeOf(LAGOS_DEV_BOUNDARY);
  await db.transaction(async (tx) => {
    const { rows: city } = await tx.execute<{ id: string }>(sql`
      insert into cities (state_id, name, enabled, boundary) values (${state.id}, 'Lagos', true, ${shape}) returning id`);
    await tx.execute(sql`
      insert into areas (city_id, name, enabled, boundary)
      values (${city[0]!.id}, 'Lagos (development outline)', true, ${shape})`);
  });
  return true;
}
