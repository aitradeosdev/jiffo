import { asc, eq, sql } from 'drizzle-orm';
import { notFound } from '../common/errors';
import type { Db, Tx } from '../db/database.module';
import { areas, cities, states, type matchingOverrides, type priceOverrides } from '../db/schema';

/**
 * What states, cities and areas set for themselves (Settings, Places): prices, and Matching values (M14). Each kind
 * has a table of versions per place, the highest current; what a place leaves out comes from the level above, then
 * the country's settings.
 */
export type PlaceScope = 'state' | 'city' | 'area';
export type PlaceRef = { scope: PlaceScope; id: string };
/** A place in a chain from its state down, by name. */
export type PlaceLevel = PlaceRef & { name: string };
/** What one place sets now, and its version: 0, with nothing set, before the first. */
export type SavedOverride<T> = { version: number; data: T };
type OverrideTable = typeof priceOverrides | typeof matchingOverrides;

/** A place's key in what latestOverrides returns: ids lowercase, as Postgres gives them back, whatever case sent. */
export const placeKey = (p: PlaceRef) => `${p.scope}:${p.id.toLowerCase()}`;

/** The latest each of these places sets in the table, keyed `scope:id`; a place with none has version 0. */
export async function latestOverrides<T>(
  db: Db | Tx,
  table: OverrideTable,
  places: PlaceRef[],
): Promise<Map<string, SavedOverride<T>>> {
  const found = new Map<string, SavedOverride<T>>(places.map((p) => [placeKey(p), { version: 0, data: {} as T }]));
  if (!places.length) return found;
  const wanted = JSON.stringify(places.map((p) => ({ scope: p.scope, id: p.id })));
  const { rows } = await db.execute<{ scope: PlaceScope; scope_id: string; version: number; data: T }>(sql`
    select distinct on (o.scope, o.scope_id) o.scope, o.scope_id, o.version, o.data
    from ${table} o
    join jsonb_to_recordset(${wanted}::jsonb) as w(scope text, id uuid) on w.scope = o.scope and w.id = o.scope_id
    order by o.scope, o.scope_id, o.version desc`);
  for (const r of rows) found.set(placeKey({ scope: r.scope, id: r.scope_id }), { version: r.version, data: r.data });
  return found;
}

/**
 * Every state, city and area of a country that sets something of its own in the table, or sits below one that
 * does, each with what its levels set from the state down: to check a change to the country's settings against.
 */
export async function overrideChains<T extends object>(db: Db | Tx, table: OverrideTable, countryCode: string) {
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
  const saved = await latestOverrides<T>(db, table, [...new Map(places.flat().map((p) => [placeKey(p), p])).values()]);
  return rows
    .map((r, i) => ({ name: r.name, chain: places[i]!.map((p) => saved.get(placeKey(p))!.data) }))
    .filter((p) => p.chain.some((data) => Object.keys(data).length > 0));
}

/**
 * One change at a time to what a country's places set, or to the country's settings they fall back to: each is
 * checked against the others' saved values, so two at once must not both pass on stale ones.
 */
export async function lockPlaces(tx: Tx, countryCode: string) {
  // Named for prices, which it first kept apart: the same name, so servers old and new take the same lock.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${'prices:' + countryCode}))`);
}

/** The place, its country, how the panel names it, and its levels from its state down to it. */
export async function placeOf(db: Db | Tx, scope: PlaceScope, id: string) {
  if (scope === 'state') {
    const [s] = await db.select().from(states).where(eq(states.id, id));
    if (!s) throw notFound('state_not_found', 'State not found');
    return { countryCode: s.countryCode, label: `the state ${s.name}`, chain: [{ scope, id, name: s.name }] };
  }
  if (scope === 'city') {
    const [c] = await db
      .select({ name: cities.name, stateId: states.id, state: states.name, countryCode: states.countryCode })
      .from(cities)
      .innerJoin(states, eq(states.id, cities.stateId))
      .where(eq(cities.id, id));
    if (!c) throw notFound('city_not_found', 'City not found');
    return {
      countryCode: c.countryCode,
      label: `the city ${c.name} (${c.state})`,
      chain: [
        { scope: 'state' as const, id: c.stateId, name: c.state },
        { scope, id, name: c.name },
      ],
    };
  }
  const [a] = await db
    .select({
      name: areas.name,
      cityId: cities.id,
      city: cities.name,
      stateId: states.id,
      state: states.name,
      countryCode: states.countryCode,
    })
    .from(areas)
    .innerJoin(cities, eq(cities.id, areas.cityId))
    .innerJoin(states, eq(states.id, cities.stateId))
    .where(eq(areas.id, id));
  if (!a) throw notFound('area_not_found', 'Area not found');
  return {
    countryCode: a.countryCode,
    label: `the area ${a.name} (${a.city})`,
    chain: [
      { scope: 'state' as const, id: a.stateId, name: a.state },
      { scope: 'city' as const, id: a.cityId, name: a.city },
      { scope, id, name: a.name },
    ],
  };
}

/** Every city and area below a place, each with its levels from the place down. */
export async function placesBelow(db: Db | Tx, scope: PlaceScope, id: string): Promise<PlaceLevel[][]> {
  if (scope === 'area') return [];
  const areaRows = await db
    .select({ id: areas.id, name: areas.name, cityId: cities.id, city: cities.name })
    .from(areas)
    .innerJoin(cities, eq(cities.id, areas.cityId))
    .where(scope === 'city' ? eq(cities.id, id) : eq(cities.stateId, id))
    .orderBy(asc(areas.name));
  const cityRows =
    scope === 'state'
      ? await db.select({ id: cities.id, name: cities.name }).from(cities).where(eq(cities.stateId, id))
      : [];
  return [
    ...cityRows.map((c) => [{ scope: 'city' as const, id: c.id, name: c.name }]),
    ...areaRows.map((a) =>
      scope === 'state'
        ? [
            { scope: 'city' as const, id: a.cityId, name: a.city },
            { scope: 'area' as const, id: a.id, name: a.name },
          ]
        : [{ scope: 'area' as const, id: a.id, name: a.name }],
    ),
  ];
}

/**
 * Checks a place's change as if saved (Settings, Places): made from what the place sets now, and leaving workable
 * values there and in every city and area below. `checker` gives, for the place's country, why a chain of what
 * places set from a state down wouldn't work there, or null.
 */
export async function checkPlaceChange<T>(
  db: Db | Tx,
  table: OverrideTable,
  input: { scope: PlaceScope; id: string; basedOn: number; data: T },
  checker: (countryCode: string) => Promise<(chain: T[]) => string | null>,
  refuse: { changed: (version: number) => Error; invalid: (where: string, problem: string) => Error },
) {
  const place = await placeOf(db, input.scope, input.id);
  const self = place.chain[place.chain.length - 1]!;
  const below = await placesBelow(db, input.scope, input.id);
  const saved = await latestOverrides<T>(db, table, [...place.chain, ...below.flat()]);
  const current = saved.get(placeKey(self))!;
  if (current.version !== input.basedOn) throw refuse.changed(current.version);
  const problem = await checker(place.countryCode);
  const dataOf = (l: PlaceLevel) => (l === self ? input.data : saved.get(placeKey(l))!.data);
  for (const levels of [[], ...below]) {
    const chain = [...place.chain, ...levels];
    const why = problem(chain.map(dataOf));
    if (why) throw refuse.invalid(chain[chain.length - 1]!.name, why);
  }
  return { place, current };
}
