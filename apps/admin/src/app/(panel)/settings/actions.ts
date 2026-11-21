'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api, reasonOf, ASKED, isPending, messageOf } from '@/lib/api';

export interface SaveState {
  error?: string;
  issues?: Array<{ path: string; message: string }>;
}

export async function saveSettings(_: SaveState, form: FormData): Promise<SaveState> {
  const country = String(form.get('country') ?? '');
  let version = 0;
  let pending = false;
  try {
    const res = await api<{ version?: number }>(`/admin/settings?country=${encodeURIComponent(country)}`, {
      reason: reasonOf(form),
      method: 'POST',
      body: {
        basedOn: Number(form.get('basedOn')),
        settings: JSON.parse(String(form.get('settings') ?? '{}')),
        note: String(form.get('note') ?? ''),
      },
    });
    pending = isPending(res);
    version = res.version ?? 0;
  } catch (error) {
    const message = messageOf(error);
    const issues = (error as { details?: { issues?: SaveState['issues'] } }).details?.issues;
    return { error: message, issues };
  }
  // Settings changes wait for a second owner (docs/security-plan.md, D4, X10).
  if (pending) redirect(ASKED);
  redirect(`/settings?saved=${version}`);
}

type Result = { error?: string; ok?: boolean };

async function run(call: () => Promise<unknown>, path: string): Promise<Result> {
  try {
    await call();
  } catch (error) {
    return { error: messageOf(error) };
  }
  revalidatePath(path);
  return { ok: true };
}

export async function addCategory(_: Result, form: FormData): Promise<Result> {
  return run(
    () =>
      api('/admin/categories', {
        reason: reasonOf(form),
        method: 'POST',
        body: {
          country: String(form.get('country') ?? ''),
          key: String(form.get('key') ?? '').trim(),
          name: String(form.get('name') ?? ''),
          icon: String(form.get('icon') ?? ''),
          description: String(form.get('description') ?? ''),
          buyDefault: form.get('buyDefault') === 'on',
          sort: Number(form.get('sort') || 0),
        },
      }),
    '/settings/categories',
  );
}

export async function updateCategory(_: Result, form: FormData): Promise<Result> {
  const id = encodeURIComponent(String(form.get('id') ?? ''));
  if (form.get('remove') === 'yes') {
    return run(
      () => api(`/admin/categories/${id}`, { reason: reasonOf(form), method: 'DELETE' }),
      '/settings/categories',
    );
  }
  return run(
    () =>
      api(`/admin/categories/${id}`, {
        reason: reasonOf(form),
        method: 'PATCH',
        body: {
          name: String(form.get('name') ?? ''),
          icon: String(form.get('icon') ?? ''),
          description: String(form.get('description') ?? ''),
          buyDefault: form.get('buyDefault') === 'on',
          sort: Number(form.get('sort') || 0),
          active: form.get('active') === 'on',
        },
      }),
    '/settings/categories',
  );
}

export async function updateState(_: Result, form: FormData): Promise<Result> {
  return run(
    () =>
      api(`/admin/states/${encodeURIComponent(String(form.get('id') ?? ''))}`, {
        reason: reasonOf(form),
        method: 'PATCH',
        body: { enabled: form.get('enabled') === 'on', agentSignups: String(form.get('agentSignups') ?? 'open') },
      }),
    '/settings/states',
  );
}

/** The boundary drawn or pasted, as the form sends it: GeoJSON text, or nothing when it didn't change (boundaryField). */
const boundaryOf = (form: FormData) => {
  const text = String(form.get('boundary') ?? '').trim();
  return text ? (JSON.parse(text) as unknown) : undefined;
};

/** Adds a city to a state, with the shape drawn (Places). It starts off. */
export async function createCity(_: Result, form: FormData): Promise<Result> {
  return run(
    () =>
      api('/admin/cities', {
        reason: reasonOf(form),
        method: 'POST',
        body: {
          stateId: String(form.get('stateId') ?? ''),
          name: String(form.get('name') ?? ''),
          boundary: boundaryOf(form),
        },
      }),
    '/settings/places',
  );
}

/** Adds an area to a city, with the shape drawn (Places). It starts off. */
export async function createArea(_: Result, form: FormData): Promise<Result> {
  return run(
    () =>
      api('/admin/areas', {
        reason: reasonOf(form),
        method: 'POST',
        body: {
          cityId: String(form.get('cityId') ?? ''),
          name: String(form.get('name') ?? ''),
          boundary: boundaryOf(form),
        },
      }),
    '/settings/places',
  );
}

/** Renames, reshapes, or switches a city or area on or off: only what the form sends changes. */
export async function updatePlace(_: Result, form: FormData): Promise<Result> {
  const kind = form.get('kind') === 'city' ? 'cities' : 'areas';
  const name = form.get('name');
  // A switch's form says it carries the switch: an unticked box sends nothing at all.
  const enabled = form.get('toggle') !== null ? form.get('enabled') === 'on' : null;
  return run(() => {
    // Read inside, so a boundary that isn't JSON is a message on the form, as everywhere else.
    const boundary = boundaryOf(form);
    return api(`/admin/${kind}/${encodeURIComponent(String(form.get('id') ?? ''))}`, {
      reason: reasonOf(form),
      method: 'PATCH',
      body: {
        ...(name !== null ? { name: String(name) } : {}),
        ...(enabled !== null ? { enabled } : {}),
        ...(boundary !== undefined ? { boundary } : {}),
      },
    });
  }, '/settings/places');
}
