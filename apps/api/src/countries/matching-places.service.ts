import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { resolveMatching, type CountrySettings, type MatchingOverride } from '@jiffo/shared';
import { DB, type Db, type Tx } from '../db/database.module';
import { matchingOverrides } from '../db/schema';
import { CountriesService } from './countries.service';
import { latestOverrides, overrideChains, type PlaceRef } from './place-overrides';

type Matching = CountrySettings['matching'];
/** Where an errand is: its country, its state, and the area its pickup is in (null for errands from before areas). */
export type ErrandPlace = { countryCode: string; stateCode: string; areaId: string | null };

/**
 * Matching values per state, city and area (docs/matching.md, M14): how a place's urgent errands are offered and
 * ranked, each value from the nearest of its area, city and state that sets it, then the country's settings.
 */
@Injectable()
export class MatchingPlacesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly countries: CountriesService,
  ) {}

  /** The latest Matching values each of these places sets, keyed `scope:id`; a place with none has version 0. */
  latest(places: PlaceRef[], db: Db | Tx = this.db) {
    return latestOverrides<MatchingOverride>(db, matchingOverrides, places);
  }

  /** Every place of a country that sets Matching values, or sits below one that does, with its levels' values. */
  chains(countryCode: string, db: Db | Tx = this.db) {
    return overrideChains<MatchingOverride>(db, matchingOverrides, countryCode);
  }

  /**
   * The Matching rules for an errand: its area's, city's and state's own values, then the country's (`country`, when
   * the caller has them already). One query for what its places set.
   */
  async rulesFor(errand: ErrandPlace, country?: Matching): Promise<Matching> {
    const [base, { rows }] = await Promise.all([
      country ?? this.countries.currentSettings(errand.countryCode).then((c) => c.settings.matching),
      this.db.execute<{ data: MatchingOverride }>(sql`
        with chain(scope, id, depth) as (
          select 'state', s.id, 0 from states s where s.country_code = ${errand.countryCode} and s.code = ${errand.stateCode}
          union all
          select 'city', a.city_id, 1 from areas a where a.id = ${errand.areaId}::uuid
          union all
          select 'area', a.id, 2 from areas a where a.id = ${errand.areaId}::uuid
        )
        select distinct on (c.depth) o.data
        from chain c join ${matchingOverrides} o on o.scope = c.scope and o.scope_id = c.id
        order by c.depth, o.version desc`),
    ]);
    return rows.length
      ? resolveMatching(
          base,
          rows.map((r) => r.data),
        )
      : base;
  }

  /** A state's rules, for its batch (M5): its own values, then the country's. A city or area never sets those. */
  stateRules(countryCode: string, stateCode: string, country?: Matching) {
    return this.rulesFor({ countryCode, stateCode, areaId: null }, country);
  }
}
