'use client';

import { useActionState } from 'react';
import { Notice } from '@/components/ui';
import { updateState } from '../actions';

export interface State {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  agentSignups: 'open' | 'waitlist';
}

/** One state's switches. Each change saves at once. */
export function StateRow({ state: s, canEdit }: { state: State; canEdit: boolean }) {
  const [result, action] = useActionState(updateState, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
      <input type="hidden" name="id" value={s.id} />
      <span className="w-40 font-semibold">
        {s.name} <span className="num text-[13px] font-normal text-ink-3">{s.code}</span>
      </span>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={s.enabled}
          disabled={!canEdit}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="accent-current"
        />
        Errands open
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-ink-3">Agent sign-ups</span>
        <select
          name="agentSignups"
          defaultValue={s.agentSignups}
          disabled={!canEdit}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="h-9 rounded-lg bg-surface-2 px-2 text-sm font-semibold"
        >
          <option value="open">Open</option>
          <option value="waitlist">Waitlist</option>
        </select>
      </label>
      {result.error ? <Notice>{result.error}</Notice> : null}
    </form>
  );
}
