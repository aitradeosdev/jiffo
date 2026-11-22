import { Inject, Injectable } from '@nestjs/common';
import { resolvePrices, type CountrySettings, type PriceOverride, type Prices } from '@jiffo/shared';
import { DB, type Db, type Tx } from '../db/database.module';
import { priceOverrides } from '../db/schema';
import { latestOverrides, overrideChains, placeKey, type PlaceRef, type PlaceScope } from './place-overrides';
import type { ServedAt } from './service-areas';

export type PriceScope = PlaceScope;

/**
 * Prices per state, city and area (Settings, Places): the latest each place sets, and the prices for a point from
 * its area, city and state, each value from the nearest that sets it, then the country's settings.
 */
@Injectable()
export class PricesService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** The latest prices each of these places sets, keyed `scope:id`; a place with none has version 0. */
  latest(places: PlaceRef[], db: Db | Tx = this.db) {
    return latestOverrides<PriceOverride>(db, priceOverrides, places);
  }

  /**
   * Every state, city and area of a country that sets prices of its own, or sits below one that does, each with
   * the prices of its levels from the state down, to check against the country's settings.
   */
  chains(countryCode: string, db: Db | Tx = this.db) {
    return overrideChains<PriceOverride>(db, priceOverrides, countryCode);
  }

  /** The prices where a point is served: its area's, city's and state's, then the country's. */
  async pricesAt(
    settings: CountrySettings,
    at: Pick<ServedAt, 'stateId' | 'cityId' | 'areaId'>,
    db: Db | Tx = this.db,
  ) {
    const chain: PlaceRef[] = [
      { scope: 'state', id: at.stateId },
      { scope: 'city', id: at.cityId },
      { scope: 'area', id: at.areaId },
    ];
    const saved = await this.latest(chain, db);
    return resolvePrices(
      settings,
      chain.map((p) => saved.get(placeKey(p))!.data),
    ) satisfies Prices;
  }
}
