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
  stateCode: string;
  stops: StopView[];
  customer: { id: string; firstName: string | null } | null;
  agent: { id: string; firstName: string | null } | null;
  role: 'customer' | 'agent' | 'prospect';
  allowedEvents: ErrandEvent[];
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  /** Only on a single errand's view, for its customer and agent: short-lived photo links. */
  photos?: { items: string[]; dropoff: string | null };
  ratedByMe?: boolean;
  /** Customer only: a tip was already given on this errand. */
  tipped?: boolean;
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

/** Which of the five steps a status is on (-1 while still looking for an agent). */
export function stepOf(status: ErrandState): number {
  switch (status) {
    case 'requested':
      return -1;
    case 'accepted':
      return 0;
    case 'started':
    case 'item_pending':
      return 1;
    case 'items_locked':
      return 2;
    case 'delivered':
    case 'photo_pending':
    case 'unreachable':
    case 'disputed':
      return 3;
    default:
      return 4;
  }
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

/** How each status reads to the agent. */
export const AGENT_STATUS: Record<ErrandState, string> = {
  requested: 'Open errand',
  accepted: 'Accepted',
  started: 'In progress',
  item_pending: 'Waiting for the customer to lock the item amount',
  items_locked: 'Item amount locked',
  delivered: 'At the drop-off',
  photo_pending: 'Waiting for the customer to approve',
  unreachable: 'Customer unreachable',
  disputed: 'Support is reviewing',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
};

export const isActive = (e: Pick<ErrandView, 'status'>) => !['completed', 'cancelled', 'expired'].includes(e.status);
