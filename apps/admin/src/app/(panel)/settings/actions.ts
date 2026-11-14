'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api, ASKED, isPending, messageOf } from '@/lib/api';

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
    return run(() => api(`/admin/categories/${id}`, { method: 'DELETE' }), '/settings/categories');
  }
  return run(
    () =>
      api(`/admin/categories/${id}`, {
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
        method: 'PATCH',
        body: { enabled: form.get('enabled') === 'on', agentSignups: String(form.get('agentSignups') ?? 'open') },
      }),
    '/settings/states',
  );
}
