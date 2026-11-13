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

function IconSelect({ value }: { value?: string }) {
  const icons = value && !CATEGORY_ICONS.includes(value) ? [value, ...CATEGORY_ICONS] : CATEGORY_ICONS;
  return (
    <select name="icon" defaultValue={value ?? 'bag'} className={inputClass} aria-label="Icon">
      {icons.map((i) => (
        <option key={i} value={i}>
          {i}
        </option>
      ))}
    </select>
  );
}

/** One category's fields, saved together; removing asks first. */
export function CategoryRow({ category, canEdit }: { category: Category; canEdit: boolean }) {
  const [state, action] = useActionState(updateCategory, {});
  const [removing, setRemoving] = useState(false);
  return (
    <form action={action} className="grid gap-3 py-4 sm:grid-cols-[1fr_1fr_120px_80px] sm:items-end">
      <input type="hidden" name="id" value={category.id} />
      <fieldset disabled={!canEdit} className="contents">
        <label className="block">
          <span className="mb-1 block text-[13px] font-semibold text-ink-3">
            Name · <span className="num">{category.key}</span>
          </span>
          <input
            name="name"
            defaultValue={category.name}
            required
            minLength={2}
            maxLength={60}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-semibold text-ink-3">Short description</span>
          <input name="description" defaultValue={category.description} maxLength={200} className={inputClass} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-semibold text-ink-3">Icon</span>
          <IconSelect value={category.icon} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[13px] font-semibold text-ink-3">Order</span>
          <input name="sort" type="number" min={0} max={1000} defaultValue={category.sort} className={inputClass} />
        </label>
        <div className="flex flex-wrap items-center gap-4 sm:col-span-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="buyDefault" defaultChecked={category.buyDefault} className="accent-current" />
            Agent buys items, by default
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={category.active} className="accent-current" />
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

export function NewCategory({ country }: { country: string }) {
  const [state, action] = useActionState(addCategory, {});
  return (
    <form action={action} key={state.ok ? 'done' : 'editing'} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="country" value={country} />
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Name</span>
        <input name="name" required minLength={2} maxLength={60} className={inputClass} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Key</span>
        <input
          name="key"
          required
          pattern="[a-z][a-z0-9_]{1,30}"
          aria-describedby="key-help"
          className={`${inputClass} num`}
        />
        <span id="key-help" className="mt-1 block text-[13px] text-ink-3">
          Lower-case, for example <span className="num">books</span>. It can&apos;t change later.
        </span>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">Short description</span>
        <input name="description" maxLength={200} className={inputClass} />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Icon</span>
          <IconSelect />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Order</span>
          <input name="sort" type="number" min={0} max={1000} defaultValue={100} className={inputClass} />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="buyDefault" className="accent-current" />
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
