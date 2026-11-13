'use client';

import { useActionState, useState } from 'react';
import { SubmitButton } from '@/components/submit-button';
import { buttonClass, inputClass, Notice } from '@/components/ui';
import { CATEGORY_ICONS } from '@/lib/settings-fields';
import { addCategory, updateCategory } from '../actions';

export interface Category {
  id: string;
  key: string;
  name: string;
  icon: string;
  description: string;
  buyDefault: boolean;
  sort: number;
  active: boolean;
}

type Fields = Omit<Category, 'id'>;
type Result = { error?: string; ok?: boolean };

/**
 * A category form's fields, held in state: React clears uncontrolled fields after every action, which would
 * throw away what was typed when the API refuses it.
 */
function useFields(initial: Fields) {
  const [fields, setFields] = useState(initial);
  const set =
    <K extends keyof Fields>(key: K) =>
    (value: Fields[K]) =>
      setFields((f) => ({ ...f, [key]: value }));
  return { f: fields, set, reset: () => setFields(initial) };
}

function IconSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const icons = value && !CATEGORY_ICONS.includes(value) ? [value, ...CATEGORY_ICONS] : CATEGORY_ICONS;
  return (
    <select name="icon" value={value} onChange={(e) => onChange(e.currentTarget.value)} className={inputClass}>
      {icons.map((i) => (
        <option key={i} value={i}>
          {i}
        </option>
      ))}
    </select>
  );
}

function Label({ text, children }: { text: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-semibold text-ink-3">{text}</span>
      {children}
    </label>
  );
}

/** One category's fields, saved together; removing asks first. */
export function CategoryRow({ category, canEdit }: { category: Category; canEdit: boolean }) {
  const [state, action] = useActionState<Result, FormData>(updateCategory, {});
  const [removing, setRemoving] = useState(false);
  const { f, set } = useFields(category);
  return (
    <form action={action} className="grid gap-3 py-4 sm:grid-cols-[1fr_1fr_120px_80px] sm:items-end">
      <input type="hidden" name="id" value={category.id} />
      <fieldset disabled={!canEdit} className="contents">
        <Label
          text={
            <>
              Name · <span className="num">{category.key}</span>
            </>
          }
        >
          <input
            name="name"
            value={f.name}
            onChange={(e) => set('name')(e.currentTarget.value)}
            required
            minLength={2}
            maxLength={60}
            className={inputClass}
          />
        </Label>
        <Label text="Short description">
          <input
            name="description"
            value={f.description}
            onChange={(e) => set('description')(e.currentTarget.value)}
            maxLength={200}
            className={inputClass}
          />
        </Label>
        <Label text="Icon">
          <IconSelect value={f.icon} onChange={set('icon')} />
        </Label>
        <Label text="Order">
          <input
            name="sort"
            type="number"
            min={0}
            max={1000}
            value={f.sort}
            onChange={(e) => set('sort')(Number(e.currentTarget.value))}
            className={inputClass}
          />
        </Label>
        <div className="flex flex-wrap items-center gap-4 sm:col-span-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="buyDefault"
              checked={f.buyDefault}
              onChange={(e) => set('buyDefault')(e.currentTarget.checked)}
              className="accent-current"
            />
            Agent buys items, by default
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="active"
              checked={f.active}
              onChange={(e) => set('active')(e.currentTarget.checked)}
              className="accent-current"
            />
            Shown in the apps
          </label>
          {canEdit ? (
            <div className="ml-auto flex gap-2">
              {removing ? (
                <>
                  <input type="hidden" name="remove" value="yes" />
                  <SubmitButton kind="danger" small>
                    Yes, remove
                  </SubmitButton>
                  <button type="button" className={buttonClass('ghost', true)} onClick={() => setRemoving(false)}>
                    Keep
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className={buttonClass('ghost', true)} onClick={() => setRemoving(true)}>
                    Remove
                  </button>
                  <SubmitButton kind="secondary" small pendingLabel="Saving…">
                    Save
                  </SubmitButton>
                </>
              )}
            </div>
          ) : null}
        </div>
      </fieldset>
      {state.error ? (
        <div className="sm:col-span-4">
          <Notice>{state.error}</Notice>
        </div>
      ) : null}
    </form>
  );
}

const BLANK: Fields = { key: '', name: '', icon: 'bag', description: '', buyDefault: false, sort: 100, active: true };

export function NewCategory({ country }: { country: string }) {
  const { f, set, reset } = useFields(BLANK);
  const [state, action] = useActionState<Result, FormData>(async (prev, form) => {
    const result = await addCategory(prev, form);
    // Cleared only once it is saved; a refusal keeps what was typed.
    if (result.ok) reset();
    return result;
  }, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="country" value={country} />
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Name</span>
        <input
          name="name"
          value={f.name}
          onChange={(e) => set('name')(e.currentTarget.value)}
          required
          minLength={2}
          maxLength={60}
          className={inputClass}
        />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Key</span>
        <input
          name="key"
          value={f.key}
          onChange={(e) => set('key')(e.currentTarget.value)}
          required
          pattern="[a-z][a-z0-9_]{1,30}"
          aria-describedby="key-help"
          className={`${inputClass} num`}
        />
        <span id="key-help" className="mt-1 block text-[13px] text-ink-3">
          Lower-case, for example <span className="num">books</span>. It can&apos;t change later or be used again.
        </span>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Short description</span>
        <input
          name="description"
          value={f.description}
          onChange={(e) => set('description')(e.currentTarget.value)}
          maxLength={200}
          className={inputClass}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Icon</span>
          <IconSelect value={f.icon} onChange={set('icon')} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Order</span>
          <input
            name="sort"
            type="number"
            min={0}
            max={1000}
            value={f.sort}
            onChange={(e) => set('sort')(Number(e.currentTarget.value))}
            className={inputClass}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          name="buyDefault"
          checked={f.buyDefault}
          onChange={(e) => set('buyDefault')(e.currentTarget.checked)}
          className="accent-current"
        />
        Agent buys items, by default
      </label>
      <div className="space-y-3 sm:col-span-2">
        <Notice>{state.error}</Notice>
        {state.ok ? <Notice tone="brand">Category added. It shows in the apps now.</Notice> : null}
        <SubmitButton pendingLabel="Adding…">Add category</SubmitButton>
      </div>
    </form>
  );
}
