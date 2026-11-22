import {
  MATCHING_PLACE_FIELDS,
  MATCHING_STATE_FIELDS,
  type MatchingOverride,
  type MatchingPlaceField,
} from '@jiffo/shared';
import { FIELD_BY_PATH, fieldText, fieldValue, getAt, shown, unreadable, type Field } from './settings-fields';

type Scope = 'state' | 'city' | 'area';

/** One value a place may set, and its inputs: one, or several parts set together (ranking weights, tier boosts). */
export interface MatchingInput {
  field: MatchingPlaceField;
  /** The Settings page's own fields for it, so a place's form reads as the country's does. */
  parts: Field[];
}

const GROUP_LABEL: Partial<Record<MatchingPlaceField, string>> = {
  weights: 'Ranking weights',
  tierBoosts: 'Tier boosts',
};

/** What a state, city or area may set (M14): a city or area leaves how long the batch waits to its state. */
export function matchingInputs(scope: Scope): MatchingInput[] {
  const stateOnly: readonly MatchingPlaceField[] = MATCHING_STATE_FIELDS;
  return MATCHING_PLACE_FIELDS.filter((f) => scope === 'state' || !stateOnly.includes(f)).map((field) => {
    const own = FIELD_BY_PATH.get(`matching.${field}`);
    return {
      field,
      parts: own ? [own] : [...FIELD_BY_PATH.values()].filter((p) => p.path.startsWith(`matching.${field}.`)),
    };
  });
}

/** Where a part's value sits within the Matching values. */
const within = (part: Field) => part.path.slice('matching.'.length);

/** A part's value as its input shows it: empty where the place leaves it to the level above. */
export function matchingText(part: Field, values: Partial<Record<string, unknown>>): string {
  return fieldText(part, getAt(values, within(part)));
}

/**
 * The Matching values a place's form sets: each field filled in, in the Settings page's units. An empty field is
 * left to the level above; a group of parts is set whole or not at all. Says which field is wrong.
 */
export function matchingFromForm(form: FormData, scope: Scope): { matching?: MatchingOverride; error?: string } {
  const matching: Record<string, unknown> = {};
  for (const input of matchingInputs(scope)) {
    const texts = input.parts.map((p) => String(form.get(p.path) ?? '').trim());
    const filled = texts.filter(Boolean).length;
    if (!filled) continue;
    if (filled < texts.length) {
      return {
        error: `${GROUP_LABEL[input.field] ?? input.field}: fill in all ${texts.length === 4 ? 'four' : texts.length}, or leave them all empty to use the level above's`,
      };
    }
    const values = input.parts.map((p, i) => fieldValue(p, texts[i]!));
    const bad = values.findIndex((v) => typeof v === 'number' && Number.isNaN(v));
    if (bad >= 0) {
      const part = input.parts[bad]!;
      return { error: `${part.label}: ${unreadable(part).toLowerCase()}` };
    }
    matching[input.field] =
      input.parts.length === 1 && within(input.parts[0]!) === input.field
        ? values[0]
        : Object.fromEntries(input.parts.map((p, i) => [within(p).split('.').at(-1)!, values[i]]));
  }
  return { matching: matching as MatchingOverride };
}

/** One change to a place's Matching values, as the audit log says it: "as above" where it went back to the level above. */
export function matchingChangeText(field: string, to: unknown): string {
  const own = FIELD_BY_PATH.get(`matching.${field}`);
  const label = (own?.label ?? GROUP_LABEL[field as MatchingPlaceField] ?? field).toLowerCase();
  if (to === null || to === undefined) return `${label} as above`;
  if (own) return `${label} ${shown(own, to)}`;
  const parts = Object.entries(to as Record<string, unknown>).map(([k, v]) => `${k} ${String(v)}`);
  return `${label} ${parts.join(', ')}`;
}
