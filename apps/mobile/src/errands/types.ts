import type { ErrandEvent, ErrandState } from '@jiffo/shared';

export interface StopView {
  seq: number;
  kind: 'pickup' | 'stop' | 'dropoff';
  label: string | null;
  address: string;
  lat: number;
  lng: number;
}

export interface ErrandView {
  id: string;
  status: ErrandState;
  version: number;
  categoryKey: string;
  buy: boolean;
  urgent: boolean;
  description: string;
  feeKobo: number;
  serviceFeeKobo: number;
  pendingOfferKobo: number | null;
  itemAmountKobo: number | null;
  scheduledFor: string | null;
  stops: StopView[];
  customer: { id: string; firstName: string | null } | null;
  agent: { id: string; firstName: string | null } | null;
  role: 'customer' | 'agent' | 'prospect';
  allowedEvents: ErrandEvent[];
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
}

export interface Quote {
  distanceMeters: number;
  durationSeconds: number;
  suggestedFeeKobo: number;
  minFeeKobo: number;
  serviceFeeKobo: number;
}

export interface PlacePick {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** The state the place is in, when Jiffo is live there. */
  stateCode: string | null;
}

/** How each status reads to the customer. */
export const STATUS_TEXT: Record<ErrandState, string> = {
  requested: 'Finding your agent',
  accepted: 'Agent on the way',
  started: 'Errand started',
  item_pending: 'Lock the item amount',
  items_locked: 'Items bought',
  delivered: 'Agent has arrived',
  photo_pending: 'Approve the drop-off photo',
  unreachable: "Your agent couldn't reach you",
  disputed: 'Support is reviewing',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'No agent found',
};

export const isActive = (e: Pick<ErrandView, 'status'>) => !['completed', 'cancelled', 'expired'].includes(e.status);
