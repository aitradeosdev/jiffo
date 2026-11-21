import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { formatNaira, PRICE_FIELDS, pricesProblem, resolvePrices, type PriceOverride } from '@jiffo/shared';
import { badRequest, conflict, notFound } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { PricesService, type PriceScope } from '../countries/prices.service';
import { DB, type Db, type Tx } from '../db/database.module';
import { areas, cities, priceOverrides, states } from '../db/schema';
import { AuditService } from './audit.service';
import type { AdminContext } from './admin.types';

export type PriceChange = { scope: PriceScope; id: string; basedOn: number; prices: PriceOverride; note: string };

type Level = { scope: PriceScope; id: string; name: string };

const FIELD_LABEL: Record<(typeof PRICE_FIELDS)[number], string> = {
  baseFeeKobo: 'base fee',
  ratePerKmKobo: 'per km',
  minFeeKobo: 'minimum fee',
  serviceFeeBps: 'service fee',
  serviceFeeMinKobo: 'service fee at least',
  serviceFeeCapKobo: 'service fee at most',
};

/** A price as the panel shows it: naira, or a percentage for the service fee. */
export const priceText = (field: (typeof PRICE_FIELDS)[number], value: number | undefined) =>
  value === undefined ? 'as above' : field === 'serviceFeeBps' ? `${value / 100}%` : formatNaira(value);

/**
 * Prices per state, city and area (Settings, Places). A change is checked twice: when asked for, and when the
 * second admin approves, each time against the prices then, and for the place and every city and area below it.
 */
@Injectable()
export class PricesAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly prices: PricesService,
    private readonly countries: CountriesService,
  ) {}

  /** The place, its country, and the levels from its state down to it. */
  private async place(scope: PriceScope, id: string, db: Db | Tx) {
    if (scope === 'state') {
      const [s] = await db.select().from(states).where(eq(states.id, id));
      if (!s) throw notFound('state_not_found', 'State not found');
      return { countryCode: s.countryCode, label: `the state ${s.name}`, chain: [{ scope, id, name: s.name }] };
    }
    if (scope === 'city') {
      const [c] = await db
        .select({
          id: cities.id,
          name: cities.name,
          stateId: states.id,
          state: states.name,
          countryCode: states.countryCode,
        })
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
        id: areas.id,
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
  private async below(scope: PriceScope, id: string, db: Db | Tx): Promise<Level[][]> {
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
   * Checks a change as if saved: made from the prices saved now, and leaving workable prices here and in every
   * city and area below. Returns the place and the prices it replaces.
   */
  async check(input: PriceChange, db: Db | Tx = this.db) {
    const place = await this.place(input.scope, input.id, db);
    const self = place.chain[place.chain.length - 1]!;
    const below = await this.below(input.scope, input.id, db);
    const everyone = [...place.chain, ...below.flat()];
    const saved = await this.prices.latest(everyone, db);
    const current = saved.get(`${self.scope}:${self.id}`)!;
    if (current.version !== input.basedOn) {
      throw conflict('prices_changed', 'These prices changed since you opened them. Reload and try again.', {
        version: current.version,
      });
    }
    // Read on the same connection: a save holds its transaction while it checks.
    const country = await this.countries.currentSettingsIfAny(place.countryCode, db);
    if (!country) throw notFound('settings_missing', `No settings saved for ${place.countryCode}`);
    const dataOf = (l: Level) => (l === self ? input.prices : saved.get(`${l.scope}:${l.id}`)!.data);
    for (const levels of [[], ...below]) {
      const chain = [...place.chain, ...levels];
      const problem = pricesProblem(resolvePrices(country.settings, chain.map(dataOf)));
      if (problem) {
        const where = chain[chain.length - 1]!.name;
        throw badRequest('invalid_prices', `${where}: ${problem}`);
      }
    }
    return { place, current };
  }

  /** What a change does, for the person approving it. */
  async describe(input: PriceChange) {
    const { place, current } = await this.check(input);
    const changed = PRICE_FIELDS.filter((f) => current.data[f] !== input.prices[f]).map(
      (f) => `${FIELD_LABEL[f]} ${priceText(f, input.prices[f])}`,
    );
    return {
      place,
      summary: changed.length
        ? `Change prices for ${place.label}: ${changed.join(', ')}`
        : `Save the prices for ${place.label} unchanged`,
    };
  }

  /** Saves the next version of a place's prices, once approved. */
  async save(admin: AdminContext, input: PriceChange) {
    // The place's country, then its lock: one price change in a country at a time, whether a place's or the
    // country's settings they fall back to, as each is checked against the others' saved prices.
    const { countryCode } = await this.place(input.scope, input.id, this.db);
    return this.db.transaction(async (tx) => {
      await this.prices.lock(tx, countryCode);
      const { place, current } = await this.check(input, tx);
      const version = current.version + 1;
      await tx.insert(priceOverrides).values({
        scope: input.scope,
        scopeId: input.id,
        countryCode: place.countryCode,
        version,
        data: input.prices,
        createdBy: admin.adminId,
      });
      await this.audit.record(tx, admin, {
        action: 'prices.change',
        targetType: input.scope,
        targetId: input.id,
        countryCode: place.countryCode,
        data: {
          place: place.label,
          version,
          note: input.note,
          changes: PRICE_FIELDS.filter((f) => current.data[f] !== input.prices[f]).map((f) => ({
            field: f,
            from: current.data[f] ?? null,
            to: input.prices[f] ?? null,
          })),
        },
      });
      return { version, prices: input.prices };
    });
  }
}
