import { describe, expect, it } from 'vitest';
import { DEFAULT_MATCHING_SETTINGS } from '@jiffo/shared';
import { matchingChangeText, matchingFromForm, matchingInputs, matchingText } from './matching-places';

const formOf = (values: Record<string, string>) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(values)) form.set(k, v);
  return form;
};

/** A place's own Matching values (Settings, Places; M14): the Settings page's fields, each left empty for the level above. */
describe('Matching per place form', () => {
  it('offers a state the batch wait, and leaves it to the state for a city or an area', () => {
    const paths = (scope: 'state' | 'city' | 'area') =>
      matchingInputs(scope).flatMap((i) => i.parts.map((p) => p.path));
    expect(paths('state')).toContain('matching.batchSeconds');
    expect(paths('city')).not.toContain('matching.batchSeconds');
    expect(paths('area')).toContain('matching.searchStepsKm');
    // Ranking weights are set together, as four parts.
    expect(paths('area').filter((p) => p.startsWith('matching.weights.'))).toHaveLength(4);
    // Who may get an errand stays the country's.
    expect(paths('state')).not.toContain('matching.boardRadiusKm');
  });

  it('reads the form back, leaving empty fields to the level above', () => {
    expect(
      matchingFromForm(
        formOf({ 'matching.offerSeconds': '30', 'matching.searchStepsKm': '2, 4.5', 'matching.freeDeclineKm': '' }),
        'area',
      ),
    ).toEqual({ matching: { offerSeconds: 30, searchStepsKm: [2, 4.5] } });
    expect(
      matchingFromForm(
        formOf({
          'matching.weights.travel': '50',
          'matching.weights.reliability': '20',
          'matching.weights.rating': '20',
          'matching.weights.waiting': '10',
        }),
        'city',
      ),
    ).toEqual({ matching: { weights: { travel: 50, reliability: 20, rating: 20, waiting: 10 } } });
    expect(matchingFromForm(formOf({}), 'state')).toEqual({ matching: {} });
  });

  it('says which field is wrong', () => {
    expect(matchingFromForm(formOf({ 'matching.offerSeconds': 'soon' }), 'area').error).toMatch(/answer/i);
    expect(matchingFromForm(formOf({ 'matching.weights.travel': '50' }), 'area').error).toMatch(/all four/);
    // Never sent from a city's form, so never set by mistake.
    expect(matchingFromForm(formOf({ 'matching.batchSeconds': '5' }), 'city')).toEqual({ matching: {} });
  });

  it('shows a value as the Settings page types it, and nothing where the level above sets it', () => {
    const steps = matchingInputs('area').find((i) => i.field === 'searchStepsKm')!.parts[0]!;
    expect(matchingText(steps, { searchStepsKm: [2, 4] })).toBe('2, 4');
    expect(matchingText(steps, {})).toBe('');
    const travel = matchingInputs('area').find((i) => i.field === 'weights')!.parts[0]!;
    expect(matchingText(travel, DEFAULT_MATCHING_SETTINGS)).toBe(String(DEFAULT_MATCHING_SETTINGS.weights.travel));
  });

  it('says what a change did, for the audit log', () => {
    expect(matchingChangeText('offerSeconds', 30)).toMatch(/answer.* 30/i);
    expect(matchingChangeText('offerSeconds', null)).toMatch(/as above$/);
    expect(matchingChangeText('weights', { travel: 50, reliability: 20, rating: 20, waiting: 10 })).toBe(
      'ranking weights travel 50, reliability 20, rating 20, waiting 10',
    );
  });
});
