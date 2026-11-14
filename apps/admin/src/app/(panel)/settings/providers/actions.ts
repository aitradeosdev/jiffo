'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { providerInfo } from '@jiffo/shared';
import { api, ASKED, isPending, messageOf } from '@/lib/api';

export interface ProviderState {
  error?: string;
  /** The answer of the last test, shown next to the button. */
  test?: { ok: boolean; message: string };
}

const back = (category: string, provider: string, done: string) =>
  redirect(`/settings/providers?done=${done}&p=${encodeURIComponent(`${category}:${provider}`)}#${category}`);

const target = (form: FormData) => ({
  category: String(form.get('category') ?? ''),
  provider: String(form.get('provider') ?? ''),
});

/** Saves the fields. Secret fields left empty keep what is saved; their values are never sent back. */
export async function saveProvider(_: ProviderState, form: FormData): Promise<ProviderState> {
  const { category, provider } = target(form);
  const info = providerInfo(category, provider);
  if (!info) return { error: 'Unknown provider' };
  const config: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const f of info.fields) {
    const value = String(form.get(f.key) ?? '');
    if (f.secret) {
      if (value.trim()) secrets[f.key] = value;
    } else {
      config[f.key] = value;
    }
  }
  let pending = false;
  try {
    pending = isPending(
      await api(`/admin/providers/${category}/${provider}`, { method: 'PUT', body: { config, secrets } }),
    );
  } catch (error) {
    return { error: messageOf(error) };
  }
  // New settings for the provider in use wait for a second owner.
  if (pending) redirect(ASKED);
  back(category, provider, 'saved');
  return {};
}

export async function testProvider(_: ProviderState, form: FormData): Promise<ProviderState> {
  const { category, provider } = target(form);
  try {
    const test = await api<{ ok: boolean; message: string }>(`/admin/providers/${category}/${provider}/test`, {
      method: 'POST',
    });
    revalidatePath('/settings/providers');
    return { test };
  } catch (error) {
    return { error: messageOf(error) };
  }
}

/** Switches a provider on for its category; an empty provider goes back to the server's own setting. */
export async function activateProvider(_: ProviderState, form: FormData): Promise<ProviderState> {
  const { category, provider } = target(form);
  let pending = false;
  try {
    pending = isPending(
      await api(`/admin/providers/${category}/active`, { method: 'POST', body: { provider: provider || null } }),
    );
  } catch (error) {
    return { error: messageOf(error) };
  }
  if (pending) redirect(ASKED);
  back(category, provider, provider ? 'on' : 'off');
  return {};
}

export async function removeProvider(_: ProviderState, form: FormData): Promise<ProviderState> {
  const { category, provider } = target(form);
  try {
    await api(`/admin/providers/${category}/${provider}`, { method: 'DELETE' });
  } catch (error) {
    return { error: messageOf(error) };
  }
  back(category, provider, 'removed');
  return {};
}

/** A new callback address, should the old one have leaked; it must then be set in the provider's dashboard. */
export async function renewCallback(_: ProviderState, form: FormData): Promise<ProviderState> {
  const { category, provider } = target(form);
  try {
    await api(`/admin/providers/${category}/${provider}/callback`, { method: 'POST' });
  } catch (error) {
    return { error: messageOf(error) };
  }
  back(category, provider, 'callback');
  return {};
}
