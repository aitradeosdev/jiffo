import { Inject, Injectable } from '@nestjs/common';
import {
  MATCHING_PLACE_FIELDS,
  matchingOverrideFor,
  matchingProblem,
  resolveMatching,
  type MatchingOverride,
  type MatchingPlaceField,
} from '@jiffo/shared';
import { badRequest, conflict, notFound } from '../common/errors';
import { CountriesService } from '../countries/countries.service';
import { checkPlaceChange, lockPlaces, placeOf, type PlaceScope } from '../countries/place-overrides';
import { DB, type Db, type Tx } from '../db/database.module';
import { matchingOverrides } from '../db/schema';
import { AuditService } from './audit.service';
import type { AdminContext } from './admin.types';

export type MatchingChange = {
  scope: PlaceScope;
  id: string;
  basedOn: number;
  matching: MatchingOverride;
  note: string;
};

const FIELD_LABEL: Record<MatchingPlaceField, string> = {
  batchSeconds: 'batch wait',
  offerSeconds: 'time to answer an offer',
  dispatchRetrySeconds: 'look again after',
  shortlistSize: 'shortlist',
  fallbackSpeedKmh: 'fallback speed',
  searchStepsKm: 'search steps',
  offersPerStep: 'offers per step',
  weights: 'ranking weights',
  tierBoosts: 'tier boosts',
  newAgentErrands: 'errands as a new agent',
  freeDeclineKm: 'free to decline beyond',
  freeDeclineMinutes: 'free to decline after going online for',
};
const UNIT: Partial<Record<MatchingPlaceField, string>> = {
  batchSeconds: 's',
  offerSeconds: 's',
  dispatchRetrySeconds: 's',
  fallbackSpeedKmh: 'km/h',
  searchStepsKm: 'km',
  freeDeclineKm: 'km',
  freeDeclineMinutes: 'min',
};

/** A value as the person approving reads it: "as above" where the place leaves it to the level above. */
export function matchingText(field: MatchingPlaceField, value: unknown): string {
  if (value === undefined) return 'as above';
  const unit = UNIT[field] ? ` ${UNIT[field]}` : '';
  if (Array.isArray(value)) return `${value.join(', ')}${unit}`;
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${k} ${String(v)}`)
      .join(', ');
  }
  return `${String(value)}${unit}`;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Matching values per state, city and area (Settings, Places; docs/matching.md, M14). A change is checked twice, as
 * prices are: when asked for, and when the second admin approves, each time against the values then, for the place
 * and every city and area below it.
 */
@Injectable()
export class MatchingPlacesAdminService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly countries: CountriesService,
  ) {}

  /**
   * Checks a change as if saved: only what the place may set, made from the values saved now, and leaving workable
   * rules here and in every city and area below. Returns the place and the values it replaces.
   */
  check(input: MatchingChange, db: Db | Tx = this.db) {
    const allowed = matchingOverrideFor(input.scope).safeParse(input.matching);
    if (!allowed.success) {
      throw badRequest(
        'invalid_matching',
        input.scope !== 'state' && 'batchSeconds' in input.matching
          ? 'Only a state sets how long its batch waits: its urgent errands are matched together'
          : (allowed.error.issues[0]?.message ?? 'These Matching values are not valid'),
      );
    }
    return checkPlaceChange<MatchingOverride>(
      db,
      matchingOverrides,
      { ...input, data: allowed.data },
      async (countryCode) => {
        // Read on the same connection: a save holds its transaction while it checks.
        const country = await this.countries.currentSettingsIfAny(countryCode, db);
        if (!country) throw notFound('settings_missing', `No settings saved for ${countryCode}`);
        return (chain) => matchingProblem(resolveMatching(country.settings.matching, chain));
      },
      {
        changed: (version) =>
          conflict('matching_changed', 'These Matching values changed since you opened them. Reload and try again.', {
            version,
          }),
        invalid: (where, problem) => badRequest('invalid_matching', `${where}: ${problem}`),
      },
    );
  }

  private changes(from: MatchingOverride, to: MatchingOverride) {
    return MATCHING_PLACE_FIELDS.filter((f) => !same(from[f], to[f]));
  }

  /** What a change does, for the person approving it. */
  async describe(input: MatchingChange) {
    const { place, current } = await this.check(input);
    const changed = this.changes(current.data, input.matching).map(
      (f) => `${FIELD_LABEL[f]} ${matchingText(f, input.matching[f])}`,
    );
    return {
      place,
      summary: changed.length
        ? `Change Matching for ${place.label}: ${changed.join('; ')}`
        : `Save the Matching values for ${place.label} unchanged`,
    };
  }

  /** Saves the next version of a place's Matching values, once approved. */
  async save(admin: AdminContext, input: MatchingChange) {
    // One change at a time to what a country's places set, or to the country's settings they fall back to.
    const { countryCode } = await placeOf(this.db, input.scope, input.id);
    return this.db.transaction(async (tx) => {
      await lockPlaces(tx, countryCode);
      const { place, current } = await this.check(input, tx);
      const version = current.version + 1;
      await tx.insert(matchingOverrides).values({
        scope: input.scope,
        scopeId: input.id,
        countryCode: place.countryCode,
        version,
        data: input.matching,
        createdBy: admin.adminId,
      });
      await this.audit.record(tx, admin, {
        action: 'matching.change',
        targetType: input.scope,
        targetId: input.id,
        countryCode: place.countryCode,
        data: {
          place: place.label,
          version,
          note: input.note,
          changes: this.changes(current.data, input.matching).map((f) => ({
            field: f,
            from: current.data[f] ?? null,
            to: input.matching[f] ?? null,
          })),
        },
      });
      return { version, matching: input.matching };
    });
  }
}
