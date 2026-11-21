'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { ReasonInput } from '@/components/reason';
import { SubmitButton } from '@/components/submit-button';
import { Badge, Card, Notice, buttonClass, inputClass } from '@/components/ui';
import { boundaryField, editableOnMap, parseBoundary, type Boundary } from '@/lib/shapes';
import { createArea, createCity, updatePlace } from '../actions';
import { PlacesMap, type MapShape } from './map';

export interface PlaceArea {
  id: string;
  name: string;
  enabled: boolean;
  boundary: Boundary;
}
export interface PlaceCity extends PlaceArea {
  areas: PlaceArea[];
}
export interface PlaceState {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  cities: PlaceCity[];
}

/** What is being drawn: a new city, a new area in a city, or a new shape (and name) for one. */
type Task =
  | { kind: 'new-city' }
  | { kind: 'new-area'; cityId: string; cityName: string }
  | { kind: 'reshape'; place: 'city' | 'area'; id: string; name: string; boundary: Boundary };

/**
 * Settings, Places: pick a state, see its cities and areas on the map, draw new ones and reshape them, and switch
 * each on. Errands are taken only inside an area that is on, in a city and state that are on.
 */
export function Places({ states, canEdit, mapsKey }: { states: PlaceState[]; canEdit: boolean; mapsKey: string }) {
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

  const target = task?.kind === 'reshape' ? task.id : task?.kind === 'new-area' ? task.cityId : null;
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
          {state && !state.enabled ? (
            <div className="mt-3">
              <Notice tone="warn">{state.name} is off in Settings, States: no errands here until it is on.</Notice>
            </div>
          ) : null}
        </Card>

        {task && canEdit ? (
          <DrawPanel
            key={round}
            task={task}
            stateId={stateId}
            drawn={drawn}
            changed={changed}
            hasMap={!!mapsKey}
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
                        />
                      </li>
                    ))}
                    {canEdit && !task ? (
                      <li>
                        <button
                          type="button"
                          className="text-sm font-semibold text-brand-ink underline"
                          onClick={() => start({ kind: 'new-area', cityId: city.id, cityName: city.name })}
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

      <div className="space-y-2 lg:sticky lg:top-6 lg:self-start">
        {mapsKey ? (
          <PlacesMap
            apiKey={mapsKey}
            shapes={shapes}
            edit={task && (task.kind !== 'reshape' || inTool) ? { key: String(drawing), boundary: drawn } : null}
            onShape={(b) => {
              setDrawn(b);
              setChanged(true);
            }}
            fitKey={stateId}
          />
        ) : (
          <Notice tone="warn">
            The map needs a Google Maps key for the browser: set GOOGLE_MAPS_BROWSER_KEY for the panel
            (docs/admin-panel.md, Places). Until then, shapes can be pasted as GeoJSON.
          </Notice>
        )}
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
}: {
  place: 'city' | 'area';
  item: PlaceArea;
  canEdit: boolean;
  onReshape: () => void;
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
  onPasted,
  onDone,
}: {
  task: Task;
  stateId: string;
  drawn: Boundary | null;
  changed: boolean;
  hasMap: boolean;
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
            : 'Click on the map for each corner, and click the first corner again to finish. Then drag corners to adjust.'}
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
          <input
            id="place-name"
            name="name"
            required
            minLength={2}
            maxLength={60}
            defaultValue={task.kind === 'reshape' ? task.name : ''}
            placeholder={task.kind === 'new-city' ? 'For example: Lagos' : 'For example: Lekki Phase 1'}
            className={`${inputClass} mt-1.5`}
          />
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
