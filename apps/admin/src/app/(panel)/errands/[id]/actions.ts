'use server';

import { redirect } from 'next/navigation';
import { api, messageOf } from '@/lib/api';
import { nairaToKobo } from '@/lib/format';

export interface ActState {
  error?: string;
}

const kobo = (value: FormDataEntryValue | null) => nairaToKobo(String(value ?? ''));

export async function actOnErrand(_: ActState, form: FormData): Promise<ActState> {
  const id = String(form.get('id') ?? '');
  const event = String(form.get('event') ?? '');
  if (!event) return { error: 'Choose what to do' };
  const custom = form.get('money') === 'custom' && event.startsWith('resolve_');
  const split = custom
    ? {
        agentKobo: kobo(form.get('agent')),
        jiffoKobo: kobo(form.get('jiffo')),
        itemsToAgentKobo: kobo(form.get('items')),
        chargeCustomerKobo: kobo(form.get('charge')),
      }
    : undefined;
  if (split && Object.values(split).some((v) => Number.isNaN(v))) return { error: 'Amounts must be numbers' };
  try {
    await api(`/admin/errands/${encodeURIComponent(id)}/actions`, {
      method: 'POST',
      body: { event, version: Number(form.get('version')), note: String(form.get('note') ?? ''), split },
    });
  } catch (error) {
    return { error: messageOf(error) };
  }
  // Back to the errand with a note of what happened: the actions card itself may be gone now.
  redirect(`/errands/${encodeURIComponent(id)}?done=${encodeURIComponent(event)}`);
}
