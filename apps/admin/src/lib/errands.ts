import 'server-only';
import { cache } from 'react';
import type { ErrandState } from '@jiffo/shared';
import { api } from './api';

/** How each status reads in the panel, and its badge colour. */
export const STATUS: Record<ErrandState, { label: string; tone: 'neutral' | 'brand' | 'warn' | 'danger' }> = {
  requested: { label: 'Waiting for an agent', tone: 'neutral' },
  accepted: { label: 'Accepted', tone: 'brand' },
  started: { label: 'Started', tone: 'brand' },
  item_pending: { label: 'Item amount sent', tone: 'brand' },
  items_locked: { label: 'Items locked', tone: 'brand' },
  delivered: { label: 'At the drop-off', tone: 'brand' },
  photo_pending: { label: 'Drop-off photo sent', tone: 'brand' },
  unreachable: { label: 'Customer unreachable', tone: 'warn' },
  disputed: { label: 'In dispute', tone: 'danger' },
  completed: { label: 'Completed', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  expired: { label: 'No agent found', tone: 'neutral' },
};

/** What each event means, in a line. */
export const EVENT: Record<string, string> = {
  create: 'Errand requested',
  accept: 'Agent accepted',
  withdraw: 'Agent withdrew before starting',
  release_agent: 'Customer asked for a different agent',
  cancel: 'Customer cancelled',
  expire: 'No agent took it in time',
  raise_fee: 'Customer raised the fee',
  send_offer: 'Agent offered a new price',
  accept_offer: 'Customer accepted the new price',
  decline_offer: 'Customer kept the old price',
  start: 'Agent started',
  send_item_amount: 'Agent sent the item amount',
  lock_item_amount: 'Customer locked the item amount',
  item_lock_timeout: 'Item amount not locked in time',
  mark_delivered: 'Agent marked it delivered',
  confirm_pin: 'Handed off with the PIN',
  send_dropoff_photo: 'Agent sent a drop-off photo',
  approve_photo: 'Customer approved the drop-off',
  auto_release: 'Drop-off approved automatically',
  report_unreachable: "Agent couldn't reach the customer",
  redeliver: 'Redelivery',
  unreachable_timeout: 'Customer stayed unreachable',
  open_dispute: 'Dispute opened',
  admin_cancel: 'Support cancelled it',
  admin_intervene: 'Support stepped in',
  pin_wrong: 'Agent entered a wrong PIN',
  pin_locked: 'Too many wrong PINs: held for support',
  resolve_complete: 'Support settled it as complete',
  resolve_cancel: 'Support settled it as cancelled',
};

/** The ledger's accounts, as they read on an errand's money card. */
export const ACCOUNT: Record<string, string> = {
  customer_wallet: 'Customer wallet',
  agent_available: 'Agent, available',
  agent_held: 'Agent, held',
  fee_escrow: 'Fee held on this errand',
  item_escrow: 'Item money held on this errand',
  platform_revenue: 'Jiffo revenue',
  provider_cash: 'Cash at the payment provider',
  provider_fees: 'Payment provider fees',
  payouts_in_transit: 'Withdrawals on the way',
};

export const JOURNAL: Record<string, string> = {
  fee_lock: 'Fee held',
  fee_adjust: 'Fee changed',
  fee_refund: 'Fee returned',
  items_lock: 'Item money held',
  items_refund: 'Item money returned',
  settle: 'Paid out at the hand-off',
  tip: 'Tip',
  adjustment: 'Adjustment by Jiffo support',
};

export interface PersonRef {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string;
}

export const nameOf = (p: PersonRef | null) =>
  p ? [p.firstName, p.lastName].filter(Boolean).join(' ') || 'No name yet' : '—';

/** The country's categories, for their names. Public settings, read once per request. */
export const getCategories = cache(async (country: string) => {
  const config = await api<{ categories: Array<{ key: string; name: string }> }>(`/config/${country}`);
  return new Map(config.categories.map((c) => [c.key, c.name]));
});
