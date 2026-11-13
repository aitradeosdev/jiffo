'use client';

import { useActionState, useMemo, useState } from 'react';
import { settingChanges } from '@jiffo/shared';
import { SubmitButton } from '@/components/submit-button';
import { buttonClass, Card, inputClass, Notice } from '@/components/ui';
import { FIELD_BY_PATH, getAt, SECTIONS, setAt, shown, type Field } from '@/lib/settings-fields';
import { saveSettings, type SaveState } from './actions';

type Settings = Record<string, unknown>;

/** What the input shows for a stored value, in the field's own unit. */
function toText(field: Field, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (field.kind === 'naira' || field.kind === 'optionalNaira') return String(Number(value) / 100);
  if (field.kind === 'percent' || field.kind === 'optionalPercent') return String(Number(value) / 100);
  return String(value);
}

/** The stored value for what was typed: kobo for naira, basis points for percent. NaN when it can't be read. */
function fromText(field: Field, text: string): unknown {
  const t = text.trim().replace(/,/g, '');
  if (
    (field.kind === 'optionalNaira' || field.kind === 'optionalPercent' || field.kind === 'optionalText') &&
    t === ''
  ) {
    return null;
  }
  if (field.kind === 'optionalText') return t;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  const n = Number(t);
  if (
    field.kind === 'naira' ||
    field.kind === 'optionalNaira' ||
    field.kind === 'percent' ||
    field.kind === 'optionalPercent'
  ) {
    return Math.round(n * 100);
  }
  return Number.isInteger(n) ? n : NaN;
}

/** What to type instead, for a value the field can't read. */
const unreadable = (field: Field) =>
  ['naira', 'optionalNaira', 'percent', 'optionalPercent'].includes(field.kind)
    ? 'Enter a number, with at most two decimal places'
    : 'Enter a whole number';

const UNIT: Partial<Record<Field['kind'], string>> = {
  naira: '₦',
  optionalNaira: '₦',
  percent: '%',
  optionalPercent: '%',
  minutes: 'min',
  hours: 'h',
  seconds: 's',
};

export function SettingsForm({
  country,
  version,
  initial,
  canEdit,
}: {
  country: string;
  version: number;
  initial: Settings;
  canEdit: boolean;
}) {
  const [state, action] = useActionState<SaveState, FormData>(saveSettings, {});
  const [settings, setSettings] = useState(initial);
  // What's typed, per field, so a half-typed number isn't lost or rewritten while editing.
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries([...FIELD_BY_PATH.values()].map((f) => [f.path, toText(f, getAt(initial, f.path))])),
  );
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);

  const invalid = [...FIELD_BY_PATH.values()].filter((f) => Number.isNaN(getAt(settings, f.path)));
  // The same comparison the API makes, so the review lists exactly what will be saved.
  const changes = useMemo(() => settingChanges(initial, settings).map((c) => c.path), [initial, settings]);
  const issueFor = (path: string) =>
    state.issues?.find((i) => i.path === path || i.path.startsWith(`${path}.`))?.message;

  const setValue = (path: string, value: unknown) => {
    setSettings((s) => setAt(s, path, value));
    setConfirming(false);
  };

  return (
    <form
      action={action}
      className="space-y-6"
      onSubmit={(e) => {
        if (!confirming) {
          e.preventDefault();
          if (changes.length && !invalid.length) setConfirming(true);
        }
      }}
    >
      <input type="hidden" name="country" value={country} />
      <input type="hidden" name="basedOn" value={version} />
      <input type="hidden" name="settings" value={JSON.stringify(settings)} />
      <fieldset disabled={!canEdit} className="space-y-6">
        {SECTIONS.map((section) => (
          <Card key={section.title} title={section.title}>
            <p className="-mt-1 mb-4 text-sm text-ink-3">{section.about}</p>
            <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
              {section.fields.map((f) => {
                const id = `f-${f.path}`;
                const value = getAt(settings, f.path);
                const changed = changes.includes(f.path) || changes.some((p) => p.startsWith(`${f.path}.`));
                const problem = Number.isNaN(value) ? unreadable(f) : issueFor(f.path);
                if (f.kind === 'bool') {
                  return (
                    <label key={f.path} className="flex items-start gap-2.5 sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={!!value}
                        onChange={(e) => setValue(f.path, e.currentTarget.checked)}
                        className="mt-1 size-4 accent-current"
                      />
                      <span className="text-sm font-semibold">
                        {f.label}
                        {changed ? <span className="ml-1.5 text-brand-ink">· changed</span> : null}
                      </span>
                    </label>
                  );
                }
                if (f.kind === 'multi') {
                  const chosen = (value as string[]) ?? [];
                  return (
                    <fieldset key={f.path} className="sm:col-span-2">
                      <legend className="mb-1.5 text-sm font-semibold">
                        {f.label}
                        {changed ? <span className="ml-1.5 text-brand-ink">· changed</span> : null}
                      </legend>
                      <div className="flex flex-wrap gap-2">
                        {f.options!.map((o) => (
                          <label
                            key={o.value}
                            className="flex items-center gap-1.5 rounded-full bg-surface-2 px-3 py-1.5 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={chosen.includes(o.value)}
                              onChange={(e) =>
                                setValue(
                                  f.path,
                                  // Always in the listed order, so ticking one off and on again changes nothing.
                                  f
                                    .options!.map((x) => x.value)
                                    .filter((v) => (v === o.value ? e.currentTarget.checked : chosen.includes(v))),
                                )
                              }
                              className="accent-current"
                            />
                            {o.label}
                          </label>
                        ))}
                      </div>
                      {problem ? <p className="mt-1 text-[13px] text-danger">{problem}</p> : null}
                    </fieldset>
                  );
                }
                return (
                  <div key={f.path}>
                    <label htmlFor={id} className="mb-1.5 block text-sm font-semibold">
                      {f.label}
                      {changed ? <span className="ml-1.5 text-brand-ink">· changed</span> : null}
                    </label>
                    {f.kind === 'select' ? (
                      <select
                        id={id}
                        value={String(value)}
                        onChange={(e) => setValue(f.path, e.currentTarget.value)}
                        className={inputClass}
                      >
                        {f.options!.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span
                        className={`flex items-center rounded-xl border-2 bg-surface-2 px-3 ${problem ? 'border-danger' : 'border-transparent'}`}
                      >
                        {UNIT[f.kind] === '₦' ? <span className="text-ink-3">₦</span> : null}
                        <input
                          id={id}
                          inputMode={f.kind === 'optionalText' ? 'text' : 'decimal'}
                          value={texts[f.path] ?? ''}
                          aria-invalid={problem ? true : undefined}
                          aria-describedby={f.help || problem ? `${id}-help` : undefined}
                          onChange={(e) => {
                            const text = e.currentTarget.value;
                            setTexts((t) => ({ ...t, [f.path]: text }));
                            setValue(f.path, fromText(f, text));
                          }}
                          className="num h-11 w-full bg-transparent px-1.5 text-[15px] focus:outline-none"
                        />
                        {UNIT[f.kind] && UNIT[f.kind] !== '₦' ? (
                          <span className="text-ink-3">{UNIT[f.kind]}</span>
                        ) : null}
                      </span>
                    )}
                    {f.help || problem ? (
                      <p id={`${id}-help`} className={`mt-1 text-[13px] ${problem ? 'text-danger' : 'text-ink-3'}`}>
                        {problem ?? f.help}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
      </fieldset>

      {canEdit ? (
        <div className="sticky bottom-0 -mx-4 border-t border-line bg-bg/95 px-4 py-4 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
          {confirming ? (
            <div className="space-y-3">
              <p className="font-bold">
                {changes.length} {changes.length === 1 ? 'change' : 'changes'} for new errands:
              </p>
              <ul className="num space-y-0.5 text-sm">
                {changes.map((p) => (
                  <li key={p}>
                    {FIELD_BY_PATH.get(p)?.label ?? p}: {shown(FIELD_BY_PATH.get(p), getAt(initial, p))} →{' '}
                    <span className="font-semibold">{shown(FIELD_BY_PATH.get(p), getAt(settings, p))}</span>
                  </li>
                ))}
              </ul>
              <label className="block max-w-xl">
                <span className="mb-1.5 block text-sm font-semibold">Why</span>
                <textarea
                  name="note"
                  required
                  minLength={5}
                  maxLength={1000}
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.currentTarget.value)}
                  className={`${inputClass} h-auto py-2.5`}
                />
              </label>
              <Notice>{state.error}</Notice>
              <div className="flex gap-2">
                <SubmitButton pendingLabel="Saving…">Save as a new version</SubmitButton>
                <button type="button" className={buttonClass('ghost')} onClick={() => setConfirming(false)}>
                  Keep editing
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className={buttonClass('primary')}
                disabled={!changes.length || invalid.length > 0}
                onClick={() => setConfirming(true)}
              >
                Review {changes.length || ''} {changes.length === 1 ? 'change' : 'changes'}
              </button>
              {changes.length ? (
                <button
                  type="button"
                  className={buttonClass('ghost')}
                  onClick={() => {
                    setSettings(initial);
                    setTexts(
                      Object.fromEntries(
                        [...FIELD_BY_PATH.values()].map((f) => [f.path, toText(f, getAt(initial, f.path))]),
                      ),
                    );
                  }}
                >
                  Undo all
                </button>
              ) : (
                <span className="text-sm text-ink-3">Change a setting to save a new version.</span>
              )}
              <Notice>{state.error && !confirming ? state.error : null}</Notice>
            </div>
          )}
        </div>
      ) : null}
    </form>
  );
}
