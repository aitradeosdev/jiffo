import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import { DB, type Db, type Tx } from '../db/database.module';
import { areas, cities, states } from '../db/schema';
import { conflict, notFound, unprocessable } from '../common/errors';
import { shapeOf, type BoundaryInput } from '../countries/service-areas';
import { AuditService } from './audit.service';
import { requireCountry } from './countries';
import type { AdminContext } from './admin.types';

/** How far outside its city an area may reach, for a hand-drawn edge (metres). */
const EDGE_TOLERANCE_M = 100;
/** Overlap between two cities, or two areas of one city, allowed for a hand-drawn shared edge (square metres). */
const OVERLAP_TOLERANCE_M2 = 10_000;
/** The smallest area that can be drawn, so a stray click doesn't make one (square metres). */
const SMALLEST_M2 = 10_000;
/** The largest city, to catch a shape drawn at the wrong zoom (square metres): a little over Lagos State twice. */
const LARGEST_CITY_M2 = 10_000 * 1_000_000;

type Change = { name?: string; boundary?: BoundaryInput; enabled?: boolean };

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === '23505' || (error as { cause?: { code?: string } }).cause?.code === '23505');

/**
 * Where Jiffo works, as admin draws it (docs/admin-panel.md, Places): cities in states and areas in cities, each
 * switched on separately. Every change is audited; a boundary change records that it changed and its size, not
 * every point.
 */
@Injectable()
export class ServiceAreasAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** Every state of the country, with its cities and their areas, boundaries as GeoJSON. */
  async list(countryCode: string) {
    await requireCountry(this.db, countryCode);
    const geo = (column: typeof cities.boundary | typeof areas.boundary) =>
      sql<string>`ST_AsGeoJSON(${column}, 6)`.as('boundary');
    const [stateRows, cityRows, areaRows] = await Promise.all([
      this.db.select().from(states).where(eq(states.countryCode, countryCode)).orderBy(asc(states.name)),
      this.db
        .select({
          id: cities.id,
          stateId: cities.stateId,
          name: cities.name,
          enabled: cities.enabled,
          boundary: geo(cities.boundary),
        })
        .from(cities)
        .innerJoin(states, eq(states.id, cities.stateId))
        .where(eq(states.countryCode, countryCode))
        .orderBy(asc(cities.name)),
      this.db
        .select({
          id: areas.id,
          cityId: areas.cityId,
          name: areas.name,
          enabled: areas.enabled,
          boundary: geo(areas.boundary),
        })
        .from(areas)
        .innerJoin(cities, eq(cities.id, areas.cityId))
        .innerJoin(states, eq(states.id, cities.stateId))
        .where(eq(states.countryCode, countryCode))
        .orderBy(asc(areas.name)),
    ]);
    const parsed = <T extends { boundary: string }>(row: T) => ({
      ...row,
      boundary: JSON.parse(row.boundary) as unknown,
    });
    return {
      states: stateRows.map((s) => ({
        ...s,
        cities: cityRows
          .filter((c) => c.stateId === s.id)
          .map((c) => ({
            ...parsed(c),
            areas: areaRows.filter((a) => a.cityId === c.id).map(parsed),
          })),
      })),
    };
  }

  async createCity(admin: AdminContext, input: { stateId: string; name: string; boundary: BoundaryInput }) {
    return this.db.transaction(async (tx) => {
      const [state] = await tx.select().from(states).where(eq(states.id, input.stateId));
      if (!state) throw notFound('state_not_found', 'State not found');
      await this.lockCountry(tx, state.countryCode);
      const size = await this.checkShape(tx, input.boundary, LARGEST_CITY_M2);
      await this.checkCityOverlap(tx, state.countryCode, input.boundary, null);
      const [city] = await this.unique(() =>
        tx
          .insert(cities)
          .values({ stateId: state.id, name: input.name, boundary: shapeOf(input.boundary) })
          .returning(),
      );
      await this.audit.record(tx, admin, {
        action: 'city.create',
        targetType: 'city',
        targetId: city!.id,
        countryCode: state.countryCode,
        data: { name: input.name, state: state.code, km2: size },
      });
      return this.view(city!);
    });
  }

  async updateCity(admin: AdminContext, id: string, change: Change) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ city: cities, countryCode: states.countryCode, state: states.code })
        .from(cities)
        .innerJoin(states, eq(states.id, cities.stateId))
        .where(eq(cities.id, id))
        .for('update', { of: cities });
      if (!before) throw notFound('city_not_found', 'City not found');
      await this.lockCountry(tx, before.countryCode);
      let size: number | undefined;
      if (change.boundary) {
        size = await this.checkShape(tx, change.boundary, LARGEST_CITY_M2);
        await this.checkCityOverlap(tx, before.countryCode, change.boundary, id);
        // Its areas must stay inside it.
        const { rows } = await tx.execute<{ name: string }>(sql`
          select a.name from areas a where a.city_id = ${id}
            and not ST_CoveredBy(a.boundary::geography, ST_Buffer(${shapeOf(change.boundary)}::geography, ${EDGE_TOLERANCE_M}))`);
        if (rows.length) {
          throw unprocessable(
            'area_outside_city',
            `${rows[0]!.name} would be outside the city. Redraw the city around it.`,
          );
        }
      }
      const [after] = await this.unique(() =>
        tx
          .update(cities)
          .set({ ...this.patch(change), updatedAt: new Date() })
          .where(eq(cities.id, id))
          .returning(),
      );
      await this.audit.record(tx, admin, {
        action: 'city.update',
        targetType: 'city',
        targetId: id,
        countryCode: before.countryCode,
        data: { name: after!.name, state: before.state, changes: this.changes(before.city, change, size) },
      });
      return this.view(after!);
    });
  }

  async createArea(admin: AdminContext, input: { cityId: string; name: string; boundary: BoundaryInput }) {
    return this.db.transaction(async (tx) => {
      const [city] = await tx
        .select({ id: cities.id, name: cities.name, countryCode: states.countryCode })
        .from(cities)
        .innerJoin(states, eq(states.id, cities.stateId))
        .where(eq(cities.id, input.cityId));
      if (!city) throw notFound('city_not_found', 'City not found');
      await this.lockCountry(tx, city.countryCode);
      const size = await this.checkShape(tx, input.boundary, LARGEST_CITY_M2);
      await this.checkAreaFits(tx, city.id, input.boundary, null);
      const [area] = await this.unique(() =>
        tx
          .insert(areas)
          .values({ cityId: city.id, name: input.name, boundary: shapeOf(input.boundary) })
          .returning(),
      );
      await this.audit.record(tx, admin, {
        action: 'area.create',
        targetType: 'area',
        targetId: area!.id,
        countryCode: city.countryCode,
        data: { name: input.name, city: city.name, km2: size },
      });
      return this.view(area!);
    });
  }

  async updateArea(admin: AdminContext, id: string, change: Change) {
    return this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ area: areas, countryCode: states.countryCode, city: cities.name })
        .from(areas)
        .innerJoin(cities, eq(cities.id, areas.cityId))
        .innerJoin(states, eq(states.id, cities.stateId))
        .where(eq(areas.id, id))
        .for('update', { of: areas });
      if (!before) throw notFound('area_not_found', 'Area not found');
      await this.lockCountry(tx, before.countryCode);
      let size: number | undefined;
      if (change.boundary) {
        size = await this.checkShape(tx, change.boundary, LARGEST_CITY_M2);
        await this.checkAreaFits(tx, before.area.cityId, change.boundary, id);
      }
      const [after] = await this.unique(() =>
        tx
          .update(areas)
          .set({ ...this.patch(change), updatedAt: new Date() })
          .where(eq(areas.id, id))
          .returning(),
      );
      await this.audit.record(tx, admin, {
        action: 'area.update',
        targetType: 'area',
        targetId: id,
        countryCode: before.countryCode,
        data: { name: after!.name, city: before.city, changes: this.changes(before.area, change, size) },
      });
      return this.view(after!);
    });
  }

  /** One change to a country's map at a time, so two overlapping shapes can't both pass the checks at once. */
  private async lockCountry(tx: Tx, countryCode: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'service-areas:' + countryCode}))`);
  }

  /** A valid shape of a sensible size; returns its size in square kilometres, to two decimals. */
  private async checkShape(tx: Tx, boundary: BoundaryInput, largestM2: number) {
    let row: { valid: boolean; m2: number | string } | undefined;
    try {
      ({
        rows: [row],
      } = await tx.execute<{ valid: boolean; m2: number | string }>(sql`
        select ST_IsValid(g) as valid, ST_Area(g::geography) as m2 from (select ${shapeOf(boundary)} as g) s`));
    } catch {
      throw unprocessable('invalid_boundary', "This shape can't be used. Redraw it.");
    }
    const m2 = Number(row?.m2 ?? 0);
    if (!row?.valid) throw unprocessable('invalid_boundary', 'The shape crosses itself. Redraw it.');
    if (m2 < SMALLEST_M2) throw unprocessable('invalid_boundary', 'The shape is too small. Redraw it.');
    if (m2 > largestM2) throw unprocessable('invalid_boundary', 'The shape is too large. Check the map is zoomed in.');
    return Math.round(m2 / 10_000) / 100;
  }

  private async checkCityOverlap(tx: Tx, countryCode: string, boundary: BoundaryInput, self: string | null) {
    const { rows } = await tx.execute<{ name: string }>(sql`
      select c.name from cities c join states s on s.id = c.state_id
      where s.country_code = ${countryCode} and (${self}::uuid is null or c.id <> ${self}::uuid)
        and ST_Intersects(c.boundary, ${shapeOf(boundary)})
        and ST_Area(ST_Intersection(c.boundary, ${shapeOf(boundary)})::geography) > ${OVERLAP_TOLERANCE_M2}
      limit 1`);
    if (rows.length)
      throw unprocessable('cities_overlap', `It overlaps ${rows[0]!.name}. Cities can only share an edge.`);
  }

  /** Inside its city, and overlapping none of the city's other areas: each point is in at most one area. */
  private async checkAreaFits(tx: Tx, cityId: string, boundary: BoundaryInput, self: string | null) {
    const { rows: inside } = await tx.execute<{ ok: boolean }>(sql`
      select ST_CoveredBy(${shapeOf(boundary)}::geography, ST_Buffer(c.boundary::geography, ${EDGE_TOLERANCE_M})) as ok
      from cities c where c.id = ${cityId}`);
    if (!inside[0]?.ok) throw unprocessable('area_outside_city', 'The area must be inside its city. Redraw it.');
    const { rows } = await tx.execute<{ name: string }>(sql`
      select a.name from areas a
      where a.city_id = ${cityId} and (${self}::uuid is null or a.id <> ${self}::uuid)
        and ST_Intersects(a.boundary, ${shapeOf(boundary)})
        and ST_Area(ST_Intersection(a.boundary, ${shapeOf(boundary)})::geography) > ${OVERLAP_TOLERANCE_M2}
      limit 1`);
    if (rows.length)
      throw unprocessable('areas_overlap', `It overlaps ${rows[0]!.name}. Areas can only share an edge.`);
  }

  private patch(change: Change) {
    return {
      ...(change.name !== undefined ? { name: change.name } : {}),
      ...(change.enabled !== undefined ? { enabled: change.enabled } : {}),
      ...(change.boundary ? { boundary: shapeOf(change.boundary) } : {}),
    };
  }

  /** What changed, for the audit log: a new boundary is recorded by its size, not its points. */
  private changes(before: { name: string; enabled: boolean }, change: Change, km2?: number) {
    return [
      ...(change.name !== undefined && change.name !== before.name
        ? [{ field: 'name', from: before.name, to: change.name }]
        : []),
      ...(change.enabled !== undefined && change.enabled !== before.enabled
        ? [{ field: 'enabled', from: before.enabled, to: change.enabled }]
        : []),
      ...(change.boundary ? [{ field: 'boundary', to: `${km2} km²` }] : []),
    ];
  }

  private async unique<T>(write: () => Promise<T>) {
    try {
      return await write();
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('name_taken', 'That name is already used here');
      throw error;
    }
  }

  private view<T extends { id: string; name: string; enabled: boolean }>(row: T) {
    return { id: row.id, name: row.name, enabled: row.enabled };
  }
}
