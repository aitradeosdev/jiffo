'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { ReasonInput } from '@/components/reason';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, Notice, buttonClass, inputClass } from '@/components/ui';
import {
  applyPrices,
  PRICE_FIELDS,
  resolveMatching,
  type CountrySettings,
  type MatchingOverride,
  type PriceOverride,
  type Prices,
} from '@jiffo/shared';
import { matchingInputs, matchingText } from '@/lib/matching-places';
import { PRICE_LABELS, priceInput } from '@/lib/prices';
import { FIELD_UNIT } from '@/lib/settings-fields';
import { boundaryField, boundsOf, editableOnMap, parseBoundary, type Boundary } from '@/lib/shapes';
import { createArea, createCity, locatePlace, saveMatching, savePrices, updatePlace } from '../actions';
import { PlacesMap, type MapShape } from './map';
import { PlacesMapbox } from './mapbox-map';
import {
  cityQuery,
  focusBox,
  mapNotice,
  stateQuery,
  type MapBox,
  type MapFocus,
  type PlacesMapInfo,
} from '@/lib/places-map';

/** The prices a place sets now, and their version: 0, with nothing set, before the first. */
export interface SavedPrices {
  version: number;
  data: PriceOverride;
}
/** The Matching values a place sets now (M14), and their version, as for prices. */
export interface SavedMatching {
  version: number;
  data: MatchingOverride;
}
export interface PlaceArea {
  id: string;
  name: string;
  enabled: boolean;
  boundary: Boundary;
  prices: SavedPrices;
  matching: SavedMatching;
}
export interface PlaceCity extends PlaceArea {
  areas: PlaceArea[];
}
export interface PlaceState {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  prices: SavedPrices;
  matching: SavedMatching;
  cities: PlaceCity[];
}

type Scope = 'state' | 'city' | 'area';
/** What a place sets for itself, of each kind. */
type Own = { id: string; name: string; prices: SavedPrices; matching: SavedMatching };
/** Marks a place that sets something of its own. */
const owns = (data: object) => (Object.keys(data).length ? ' (own)' : '');

/** Setting a state's, city's or area's prices: what it sets now, and what it would take from the levels above. */
type PriceTask = {
  kind: 'prices';
  scope: 'state' | 'city' | 'area';
  id: string;
  name: string;
  saved: SavedPrices;
  above: PriceOverride[];
};

/** Setting a place's Matching values (M14), the same way. */
type MatchingTask = {
  kind: 'matching';
  scope: Scope;
  id: string;
  name: string;
  saved: SavedMatching;
  above: MatchingOverride[];
};

/**
 * What is being drawn: a new city, a new area in a city, or a new shape (and name) for one; or prices or Matching
 * values set.
 */
type Task =
  | PriceTask
  | MatchingTask
  | { kind: 'new-city' }
  | { kind: 'new-area'; cityId: string; cityName: string }
  | { kind: 'reshape'; place: 'city' | 'area'; id: string; name: string; boundary: Boundary };

/**
 * Settings, Places: pick a state, see its cities and areas on the map, draw new ones and reshape them, and switch
 * each on. Errands are taken only inside an area that is on, in a city and state that are on.
 */
export function Places({
  states,
  countryPrices,
  countryMatching,
  canEdit,
  map,
}: {
  states: PlaceState[];
  countryPrices: Prices | null;
  countryMatching: CountrySettings['matching'] | null;
  canEdit: boolean;
  /** The maps provider's own map, and its public key for the panel. */
  map: PlacesMapInfo;
}) {
  const notice = mapNotice(map);
  const hasMap = !notice && !!map.key;
  const MapOfProvider = map.engine === 'mapbox' ? PlacesMapbox : PlacesMap;
  const [stateId, setStateId] = useState(
    () => (states.find((s) => s.cities.length) ?? states.find((s) => s.code === 'LA') ?? states[0])?.id ?? '',
  );
  const state = states.find((s) => s.id === stateId);
  const [task, setTask] = useState<Task | null>(null);
  const [drawn, setDrawn] = useState<Boundary | null>(null);
  // Whether the shape was changed since this task began: a rename alone keeps the shape.
  const [changed, setChanged] = useState(false);
  // A new task starts the panel and the drawing afresh; a pasted shape starts only the drawing again, keeping the
  // name already typed.
  const [round, setRound] = useState(0);
  const [drawing, setDrawing] = useState(0);

  const start = (next: Task | null) => {
    setTask(next);
    setDrawn(next?.kind === 'reshape' ? next.boundary : null);
    setChanged(false);
    setRound((r) => r + 1);
    setDrawing((d) => d + 1);
  };
  const pasted = (boundary: Boundary) => {
    setDrawn(boundary);
    setChanged(true);
    setDrawing((d) => d + 1);
  };

  // Where the map goes before anything is drawn there.
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [stateNote, setStateNote] = useState<string | null>(null);
  // What the maps provider found for each state and city asked about, so each is asked about once.
  const found = useRef(new Map<string, MapBox>());
  // Each move is counted, so an answer that comes after a later move is let go.
  const moves = useRef(0);
  const moveTo = (box: MapBox) => setFocus({ key: String(++moves.current), box });

  /** Moves the map to a state or city as the maps provider finds it by name: null, or why it couldn't. */
  const goTo = async (kind: 'state' | 'city', query: string): Promise<string | null> => {
    const move = ++moves.current;
    const key = `${kind}:${query.toLowerCase()}`;
    let box = found.current.get(key);
    if (!box) {
      let answer: Awaited<ReturnType<typeof locatePlace>>;
      try {
        answer = await locatePlace(kind, query);
      } catch {
        answer = { error: "The panel couldn't reach the server." };
      }
      if (move !== moves.current) return null;
      if (!answer.found) {
        return answer.missing
          ? `${query} wasn't found on the map: move the map there yourself.`
          : `${answer.error ?? 'Something went wrong.'} Move the map there yourself.`;
      }
      box = focusBox(answer.found, kind);
      found.current.set(key, box);
    }
    if (move === moves.current) moveTo(box);
    return null;
  };

  // A state with nothing drawn yet: the map goes to it, as the maps provider finds it. One with cities shows them.
  useEffect(() => {
    setStateNote(null);
    if (!hasMap || !state || state.cities.length) return;
    void goTo('state', stateQuery(state.name)).then(setStateNote);
    // Only when another state is picked: drawing in it doesn't move the map.
  }, [stateId, hasMap]);

  /** Opens a place's prices or Matching values, with what each level above it sets. */
  const openOwn = (kind: 'prices' | 'matching', scope: Scope, place: Own, above: Own[]) =>
    start(
      kind === 'prices'
        ? { kind, scope, id: place.id, name: place.name, saved: place.prices, above: above.map((a) => a.prices.data) }
        : {
            kind,
            scope,
            id: place.id,
            name: place.name,
            saved: place.matching,
            above: above.map((a) => a.matching.data),
          },
    );

  const target =
    task?.kind === 'reshape' || task?.kind === 'prices' || task?.kind === 'matching'
      ? task.id
      : task?.kind === 'new-area'
        ? task.cityId
        : null;
  // The one being reshaped is drawn by the drawing tool instead, unless it has holes, which the tool can't take.
  const inTool = task?.kind === 'reshape' && editableOnMap(task.boundary) ? task.id : null;
  const shapes = useMemo<MapShape[]>(
    () =>
      (state?.cities ?? []).flatMap((c) => [
        ...(c.id === inTool
          ? []
          : [
              {
                id: c.id,
                kind: 'city' as const,
                name: c.name,
                enabled: c.enabled,
                boundary: c.boundary,
                selected: c.id === target,
              },
            ]),
        ...c.areas
          .filter((a) => a.id !== inTool)
          .map((a) => ({
            id: a.id,
            kind: 'area' as const,
            name: a.name,
            enabled: a.enabled,
            boundary: a.boundary,
            selected: a.id === target,
          })),
      ]),
    [state, target, inTool],
  );

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
      <div className="space-y-4">
        <Card>
          <label className="block text-sm font-semibold" htmlFor="place-state">
            State
          </label>
          <select
            id="place-state"
            value={stateId}
            onChange={(e) => {
              setStateId(e.target.value);
              setFocus(null);
              start(null);
            }}
            className={`${inputClass} mt-1.5`}
          >
            {states.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.cities.length ? ` (${s.cities.length} ${s.cities.length === 1 ? 'city' : 'cities'})` : ''}
                {s.enabled ? '' : ', off'}
              </option>
            ))}
          </select>
          {state && !task ? (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {countryPrices ? (
                <button
                  type="button"
                  className="text-sm font-semibold text-ink-2 underline"
                  onClick={() => openOwn('prices', 'state', state, [])}
                >
                  Prices for {state.name}
                  {owns(state.prices.data)}
                </button>
              ) : null}
              {countryMatching ? (
                <button
                  type="button"
                  className="text-sm font-semibold text-ink-2 underline"
                  onClick={() => openOwn('matching', 'state', state, [])}
                >
                  Matching for {state.name}
                  {owns(state.matching.data)}
                </button>
              ) : null}
            </div>
          ) : null}
          {state && !state.enabled ? (
            <div className="mt-3">
              <Notice tone="warn">{state.name} is off in Settings, States: no errands here until it is on.</Notice>
            </div>
          ) : null}
        </Card>

        {task?.kind === 'prices' && countryPrices ? (
          <PricePanel
            key={round}
            task={task}
            countryPrices={countryPrices}
            canEdit={canEdit}
            onDone={() => start(null)}
          />
        ) : task?.kind === 'matching' && countryMatching ? (
          <MatchingPanel
            key={round}
            task={task}
            countryMatching={countryMatching}
            canEdit={canEdit}
            onDone={() => start(null)}
          />
        ) : task && task.kind !== 'prices' && task.kind !== 'matching' && canEdit ? (
          <DrawPanel
            key={round}
            task={task}
            stateId={stateId}
            drawn={drawn}
            changed={changed}
            hasMap={!notice}
            onFind={
              task.kind === 'new-city' && hasMap && state
                ? (name) => goTo('city', cityQuery(name, state.name))
                : undefined
            }
            onPasted={pasted}
            onDone={() => start(null)}
          />
        ) : null}

        <Card
          title={state ? `Cities in ${state.name}` : 'Cities'}
          action={
            canEdit && !task ? (
              <button
                type="button"
                className={buttonClass('secondary', true)}
                onClick={() => start({ kind: 'new-city' })}
              >
                Add a city
              </button>
            ) : null
          }
        >
          {state?.cities.length ? (
            <ul className="space-y-4">
              {state.cities.map((city) => (
                <li key={city.id} className="space-y-2">
                  <PlaceRow
                    place="city"
                    item={city}
                    canEdit={canEdit && !task}
                    onReshape={() =>
                      start({ kind: 'reshape', place: 'city', id: city.id, name: city.name, boundary: city.boundary })
                    }
                    onPrices={countryPrices && !task ? () => openOwn('prices', 'city', city, [state]) : undefined}
                    onMatching={countryMatching && !task ? () => openOwn('matching', 'city', city, [state]) : undefined}
                  />
                  <ul className="ml-4 space-y-1.5 border-l border-line pl-3">
                    {city.areas.map((area) => (
                      <li key={area.id}>
                        <PlaceRow
                          place="area"
                          item={area}
                          canEdit={canEdit && !task}
                          onReshape={() =>
                            start({
                              kind: 'reshape',
                              place: 'area',
                              id: area.id,
                              name: area.name,
                              boundary: area.boundary,
                            })
                          }
                          onPrices={
                            countryPrices && !task ? () => openOwn('prices', 'area', area, [state, city]) : undefined
                          }
                          onMatching={
                            countryMatching && !task
                              ? () => openOwn('matching', 'area', area, [state, city])
                              : undefined
                          }
                        />
                      </li>
                    ))}
                    {canEdit && !task ? (
                      <li>
                        <button
                          type="button"
                          className="text-sm font-semibold text-brand-ink underline"
                          onClick={() => {
                            start({ kind: 'new-area', cityId: city.id, cityName: city.name });
                            // The area is drawn inside its city: the map shows the city.
                            const box = boundsOf([city.boundary]);
                            if (box) moveTo(box);
                          }}
                        >
                          Add an area to {city.name}
                        </button>
                      </li>
                    ) : null}
                    {!city.areas.length ? (
                      <li className="text-sm text-ink-3">No areas yet: errands are taken only inside areas.</li>
                    ) : null}
                  </ul>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">No cities drawn here yet.</p>
          )}
        </Card>
      </div>

      <div id="places-map" className="space-y-2 lg:sticky lg:top-6 lg:self-start">
        {hasMap && map.key ? (
          <MapOfProvider
            apiKey={map.key}
            shapes={shapes}
            edit={task && (task.kind !== 'reshape' || inTool) ? { key: String(drawing), boundary: drawn } : null}
            onShape={(b) => {
              setDrawn(b);
              setChanged(true);
            }}
            fitKey={stateId}
            focus={focus}
          />
        ) : (
          <Notice tone="warn">{notice}</Notice>
        )}
        {stateNote ? <p className="text-sm text-ink-2">{stateNote}</p> : null}
        <p className="text-[13px] text-ink-3">
          Cities are outlined; areas are green when on and grey when off. An area stays inside its city, and areas and
          cities don&apos;t overlap, though they can share an edge.
        </p>
      </div>
    </div>
  );
}

/** A city or area in the list: on or off, with its switch and a button to reshape it. */
function PlaceRow({
  place,
  item,
  canEdit,
  onReshape,
  onPrices,
  onMatching,
}: {
  place: 'city' | 'area';
  item: PlaceArea;
  canEdit: boolean;
  onReshape: () => void;
  /** Opens its prices: anyone can look; those who may change settings can change them. */
  onPrices?: () => void;
  /** Opens its Matching values, the same way. */
  onMatching?: () => void;
}) {
  const [result, action] = useActionState(updatePlace, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <ReasonInput after={result} />
      <input type="hidden" name="kind" value={place} />
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="toggle" value="1" />
      <span className={place === 'city' ? 'font-bold' : 'text-sm font-semibold'}>{item.name}</span>
      <Badge tone={item.enabled ? 'brand' : 'neutral'}>{item.enabled ? 'On' : 'Off'}</Badge>
      {canEdit ? (
        <>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              key={String(item.enabled)}
              type="checkbox"
              name="enabled"
              defaultChecked={item.enabled}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
              className="accent-current"
            />
            On
          </label>
          <button type="button" className="text-sm font-semibold text-ink-2 underline" onClick={onReshape}>
            Reshape
          </button>
        </>
      ) : null}
      {onPrices ? (
        <button type="button" className="text-sm font-semibold text-ink-2 underline" onClick={onPrices}>
          Prices{owns(item.prices.data)}
        </button>
      ) : null}
      {onMatching ? (
        <button type="button" className="text-sm font-semibold text-ink-2 underline" onClick={onMatching}>
          Matching{owns(item.matching.data)}
        </button>
      ) : null}
      {result.error ? (
        <div className="basis-full">
          <Notice>{result.error}</Notice>
        </div>
      ) : null}
    </form>
  );
}

/** Drawing a new city or area, or a new shape and name for one: saved with the reason given above. */
function DrawPanel({
  task,
  stateId,
  drawn,
  changed,
  hasMap,
  onFind,
  onPasted,
  onDone,
}: {
  task: Task;
  stateId: string;
  drawn: Boundary | null;
  changed: boolean;
  hasMap: boolean;
  /** For a new city: moves the map to the name typed, as the maps provider finds it. Null, or why it couldn't. */
  onFind?: (name: string) => Promise<string | null>;
  onPasted: (b: Boundary) => void;
  onDone: () => void;
}) {
  const save = task.kind === 'new-city' ? createCity : task.kind === 'new-area' ? createArea : updatePlace;
  const holed = task.kind === 'reshape' && !editableOnMap(task.boundary) && !changed;
  const [result, action] = useActionState(save, {});
  const [pasted, setPasted] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  useEffect(() => {
    if (result.ok) onDone();
  }, [result, onDone]);

  const nameField = useRef<HTMLInputElement>(null);
  const [finding, setFinding] = useState(false);
  const [findNote, setFindNote] = useState<string | null>(null);
  // The name last looked up, and the one being looked up now: leaving the field doesn't look it up again.
  const lastFound = useRef('');
  const looking = useRef('');
  /** Moves the map to the name typed: when asked (`again`), or on leaving the field with a new name. */
  const find = async (again: boolean) => {
    const name = nameField.current?.value.trim() ?? '';
    if (!onFind || name.length < 2 || looking.current === name || (!again && name === lastFound.current)) return;
    lastFound.current = name;
    looking.current = name;
    setFinding(true);
    const why = await onFind(name);
    looking.current = '';
    setFinding(false);
    setFindNote(why);
    // On a phone the map is further down: bring it into view, to draw on.
    if (!why && again) document.getElementById('places-map')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const title =
    task.kind === 'new-city'
      ? 'New city'
      : task.kind === 'new-area'
        ? `New area in ${task.cityName}`
        : `Reshape ${task.name}`;
  return (
    <Card title={title}>
      <p className="-mt-1 mb-3 text-sm text-ink-3">
        {!hasMap
          ? "Paste the shape's GeoJSON below."
          : task.kind === 'reshape'
            ? 'Drag a corner to move it, or the dot between two corners to add one.'
            : `${onFind ? 'Type its name and tap Find on map to go there. ' : ''}Click on the map for each corner, and click the first corner again to finish. Then drag corners to adjust.`}
      </p>
      <form action={action} className="space-y-3">
        <ReasonInput after={result} />
        {task.kind === 'new-city' ? <input type="hidden" name="stateId" value={stateId} /> : null}
        {task.kind === 'new-area' ? <input type="hidden" name="cityId" value={task.cityId} /> : null}
        {task.kind === 'reshape' ? (
          <>
            <input type="hidden" name="kind" value={task.place} />
            <input type="hidden" name="id" value={task.id} />
          </>
        ) : null}
        <input
          type="hidden"
          name="boundary"
          value={boundaryField({ reshaping: task.kind === 'reshape', changed, drawn })}
        />
        <div>
          <label className="block text-sm font-semibold" htmlFor="place-name">
            Name
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="place-name"
              ref={nameField}
              name="name"
              required
              minLength={2}
              maxLength={60}
              defaultValue={task.kind === 'reshape' ? task.name : ''}
              placeholder={task.kind === 'new-city' ? 'For example: Lagos' : 'For example: Lekki Phase 1'}
              className={`${inputClass} min-w-0 flex-1`}
              // A new city: the keyboard's Go finds it on the map, as its shape is drawn there before saving.
              enterKeyHint={onFind ? 'search' : undefined}
              onBlur={onFind ? () => void find(false) : undefined}
              onKeyDown={
                onFind
                  ? (e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      void find(true);
                    }
                  : undefined
              }
            />
            {onFind ? (
              <button
                type="button"
                className={buttonClass('secondary', true)}
                disabled={finding}
                onClick={() => void find(true)}
              >
                {finding ? 'Finding…' : 'Find on map'}
              </button>
            ) : null}
          </div>
          {findNote ? <p className="mt-1.5 text-sm text-ink-2">{findNote}</p> : null}
        </div>
        <details open={!hasMap} className="text-sm">
          <summary className="cursor-pointer font-semibold text-ink-2">Paste a shape instead</summary>
          <textarea
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            rows={4}
            placeholder='GeoJSON, such as {"type":"Polygon","coordinates":[[[3.4,6.4],...]]}'
            className={`${inputClass} mt-2 h-auto py-2 font-mono text-xs`}
          />
          <button
            type="button"
            className={`${buttonClass('secondary', true)} mt-2`}
            onClick={() => {
              const read = parseBoundary(pasted);
              setPasteError(read.error ?? null);
              if (read.boundary) onPasted(read.boundary);
            }}
          >
            Use this shape
          </button>
          {pasteError ? <p className="mt-2 text-danger">{pasteError}</p> : null}
        </details>
        {holed ? (
          <p className="text-sm text-ink-2">
            This shape has holes, which the map can&apos;t reshape: paste a new shape to change it, or save to change
            only the name.
          </p>
        ) : null}
        {drawn ? (
          <p className="text-sm text-ink-2">
            {changed || task.kind !== 'reshape' ? 'Shape ready to save.' : 'Shape as saved.'}
          </p>
        ) : (
          <p className="text-sm text-ink-3">
            {task.kind === 'reshape' ? 'No shape: draw one again, or cancel to keep the one saved.' : 'No shape yet.'}
          </p>
        )}
        <Notice>{result.error}</Notice>
        <div className="flex gap-2">
          {drawn ? (
            <SubmitButton small pendingLabel="Saving…">
              Save
            </SubmitButton>
          ) : null}
          <button type="button" className={buttonClass('ghost', true)} onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

/**
 * A state's, city's or area's prices: each field it sets, or empty to take the level above's, shown as the
 * placeholder. Saving asks a second admin to approve (Approvals).
 */
function PricePanel({
  task,
  countryPrices,
  canEdit,
  onDone,
}: {
  task: PriceTask;
  countryPrices: Prices;
  canEdit: boolean;
  onDone: () => void;
}) {
  const [result, action] = useActionState(savePrices, {});
  useEffect(() => {
    if (result.ok) onDone();
  }, [result, onDone]);
  const inherited = applyPrices(countryPrices, task.above);
  const from = task.scope === 'state' ? 'the country' : task.scope === 'city' ? 'the state' : 'the city';
  return (
    <Card title={`Prices for ${task.name}`}>
      <p className="-mt-1 mb-3 text-sm text-ink-3">
        Leave a field empty to use {from}&apos;s, shown in grey. Errands already sent keep the prices they were sent
        with; a change waits for a second admin&apos;s approval.
      </p>
      <form action={action} className="space-y-3">
        <ReasonInput after={result} />
        <input type="hidden" name="scope" value={task.scope} />
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="basedOn" value={task.saved.version} />
        <div className="grid grid-cols-2 gap-3">
          {PRICE_FIELDS.map((field) => {
            const { label, percent } = PRICE_LABELS[field];
            return (
              <label key={field} className="block text-sm">
                <span className="font-semibold">{label}</span>
                <span className="mt-1.5 flex items-center gap-1.5">
                  {percent ? null : <span className="text-ink-3">₦</span>}
                  <input
                    name={field}
                    inputMode="decimal"
                    defaultValue={priceInput(field, task.saved.data[field])}
                    placeholder={priceInput(field, inherited[field])}
                    disabled={!canEdit}
                    className={inputClass}
                  />
                  {percent ? <span className="text-ink-3">%</span> : null}
                </span>
              </label>
            );
          })}
        </div>
        {canEdit ? (
          <>
            <div>
              <label className="block text-sm font-semibold" htmlFor="price-note">
                What changes, and why
              </label>
              <input
                id="price-note"
                name="note"
                required
                minLength={3}
                maxLength={500}
                placeholder="For example: errands take longer in Lekki's traffic"
                className={`${inputClass} mt-1.5`}
              />
            </div>
            <Notice>{result.error}</Notice>
            <div className="flex gap-2">
              <SubmitButton small pendingLabel="Saving…">
                Ask for approval
              </SubmitButton>
              <button type="button" className={buttonClass('ghost', true)} onClick={onDone}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button type="button" className={buttonClass('ghost', true)} onClick={onDone}>
            Close
          </button>
        )}
      </form>
    </Card>
  );
}

/**
 * A state's, city's or area's Matching values (M14): how its urgent errands are offered and ranked, each field it
 * sets, or empty to take the level above's, shown as the placeholder. Who may get an errand stays the country's.
 * Saving asks a second admin to approve (Approvals).
 */
function MatchingPanel({
  task,
  countryMatching,
  canEdit,
  onDone,
}: {
  task: MatchingTask;
  countryMatching: CountrySettings['matching'];
  canEdit: boolean;
  onDone: () => void;
}) {
  const [result, action] = useActionState(saveMatching, {});
  useEffect(() => {
    if (result.ok) onDone();
  }, [result, onDone]);
  const inherited = resolveMatching(countryMatching, task.above);
  const from = task.scope === 'state' ? 'the country' : task.scope === 'city' ? 'the state' : 'the city';
  return (
    <Card title={`Matching for ${task.name}`}>
      <p className="-mt-1 mb-3 text-sm text-ink-3">
        How urgent errands here are offered and ranked. Leave a field empty to use {from}&apos;s, shown in grey. Who may
        get an errand stays the country&apos;s, as do the offers over which an agent&apos;s acceptance rate is worked
        out and its pause; the free-decline values here decide which of this place&apos;s offers count toward it. The
        fallback speed here is for offers: the board&apos;s order estimates with the country&apos;s
        {task.scope === 'state' ? '' : ", and how long a batch waits is the state's"}. A change waits for a second
        admin&apos;s approval.
      </p>
      <form action={action} className="space-y-3">
        <ReasonInput after={result} />
        <input type="hidden" name="scope" value={task.scope} />
        <input type="hidden" name="id" value={task.id} />
        <input type="hidden" name="basedOn" value={task.saved.version} />
        <div className="space-y-3">
          {matchingInputs(task.scope).flatMap((input) =>
            input.parts.map((part) => (
              <label key={part.path} className="block text-sm">
                <span className="font-semibold">{part.label}</span>
                <span className="mt-1.5 flex items-center gap-1.5">
                  <input
                    name={part.path}
                    inputMode={part.kind === 'kmList' ? 'text' : 'decimal'}
                    defaultValue={matchingText(part, task.saved.data)}
                    placeholder={matchingText(part, inherited)}
                    disabled={!canEdit}
                    className={inputClass}
                  />
                  {FIELD_UNIT[part.kind] ? <span className="text-ink-3">{FIELD_UNIT[part.kind]}</span> : null}
                </span>
                {part.help ? <span className="mt-1 block text-[13px] text-ink-3">{part.help}</span> : null}
              </label>
            )),
          )}
        </div>
        {canEdit ? (
          <>
            <div>
              <label className="block text-sm font-semibold" htmlFor="matching-note">
                What changes, and why
              </label>
              <input
                id="matching-note"
                name="note"
                required
                minLength={3}
                maxLength={500}
                placeholder="For example: fewer agents out here, so search further sooner"
                className={`${inputClass} mt-1.5`}
              />
            </div>
            <Notice>{result.error}</Notice>
            <div className="flex gap-2">
              <SubmitButton small pendingLabel="Saving…">
                Ask for approval
              </SubmitButton>
              <button type="button" className={buttonClass('ghost', true)} onClick={onDone}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button type="button" className={buttonClass('ghost', true)} onClick={onDone}>
            Close
          </button>
        )}
      </form>
    </Card>
  );
}
