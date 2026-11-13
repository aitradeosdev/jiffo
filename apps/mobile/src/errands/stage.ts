import { naira } from '@/money';
import { stepOf, type ErrandView } from './types';

export type StageTone = 'brand' | 'urgent' | 'danger';

export interface Stage {
  step: number;
  chip: { label: string; tone: StageTone };
  /** The big line on the tracker. */
  big: string;
  sub: string;
  /** What the agent is doing, under their name. */
  doing: string;
}

const place = (e: ErrandView, kind: 'pickup' | 'dropoff') => {
  const s = e.stops.find((x) => x.kind === kind);
  return s?.label ?? s?.address ?? (kind === 'pickup' ? 'the pickup' : 'the drop-off');
};

/** How a running errand reads to the customer, after the prototype's tracker. */
export function customerStage(e: ErrandView): Stage {
  const a = e.agent?.firstName ?? 'Your agent';
  const pick = place(e, 'pickup');
  const drop = place(e, 'dropoff');
  const step = stepOf(e.status);
  const yourTurn = { label: 'Your turn', tone: 'urgent' as const };
  switch (e.status) {
    case 'accepted':
      return e.pendingOfferKobo !== null
        ? {
            step,
            chip: yourTurn,
            big: 'Answer the new price',
            sub: `${a} asked for ${naira(e.pendingOfferKobo)}. Accept or decline it before they start.`,
            doing: 'Waiting for your answer',
          }
        : {
            step,
            chip: { label: 'Accepted', tone: 'brand' },
            big: `${a} accepted`,
            sub: 'Agree on the price before they start',
            doing: `Heading towards ${pick}`,
          };
    case 'started':
      return {
        step,
        chip: { label: 'In progress', tone: 'brand' },
        big: `On the way to ${pick}`,
        sub: `Price fixed at ${naira(e.feeKobo)}`,
        doing: `Heading to ${pick}`,
      };
    case 'item_pending':
      return {
        step,
        chip: yourTurn,
        big: 'Check the item amount',
        sub: 'Check the receipt and photos, then lock it',
        doing: `At ${pick} · receipt sent`,
      };
    case 'items_locked':
      return {
        step,
        chip: { label: 'On the way', tone: 'brand' },
        big: `${a} is on the way to you`,
        sub: `Items bought · ${drop}`,
        doing: 'On the way with your items',
      };
    case 'delivered':
      return {
        step,
        chip: { label: 'At your door', tone: 'brand' },
        big: `${a} is at the drop-off`,
        sub: 'Check your items, then show your PIN',
        doing: `Waiting at ${drop}`,
      };
    case 'photo_pending':
      return {
        step,
        chip: yourTurn,
        big: 'Approve the drop-off photo',
        sub: 'Nothing is paid until you approve, or 24 hours pass',
        doing: 'Left your items at the drop-off',
      };
    case 'unreachable':
      return {
        step,
        chip: yourTurn,
        big: `${a} couldn't reach you`,
        sub: 'Ask for redelivery within 24 hours',
        doing: `Couldn't reach you at ${drop}`,
      };
    case 'disputed':
      return {
        step,
        chip: { label: 'Under review', tone: 'danger' },
        big: 'Support is reviewing',
        sub: 'The money stays held until they decide',
        doing: 'Support is looking at the chat and photos',
      };
    default:
      return { step, chip: { label: 'Completed', tone: 'brand' }, big: 'Delivered', sub: '', doing: 'Errand complete' };
  }
}

/** What waits on the customer right now, if anything, for the orange card. */
export function customerNeeds(e: ErrandView): { icon: string; title: string; sub: string } | null {
  const a = e.agent?.firstName ?? 'your agent';
  if (e.pendingOfferKobo !== null && e.allowedEvents.includes('accept_offer')) {
    return {
      icon: 'edit',
      title: `New price from ${a}: ${naira(e.pendingOfferKobo)}`,
      sub: 'Accept or decline in the chat',
    };
  }
  if (e.status === 'item_pending' && e.itemAmountKobo !== null) {
    return {
      icon: 'bag',
      title: `Lock ${naira(e.itemAmountKobo)} for your items`,
      sub: 'Receipt and photos are in the chat',
    };
  }
  if (e.status === 'photo_pending') {
    return { icon: 'camera', title: 'Approve the drop-off photo', sub: 'Nothing is paid until you approve' };
  }
  if (e.status === 'unreachable') {
    return { icon: 'alert', title: `${a} couldn't reach you`, sub: 'Ask for redelivery below' };
  }
  return null;
}

/** Money held for the errand now, as the ledger has it. */
export const heldKobo = (e: ErrandView) => (e.held?.feeKobo ?? 0) + (e.held?.itemsKobo ?? 0);

/** The time a step was reached, where the errand records it. */
export function stepTime(e: ErrandView, step: number) {
  const at = [e.acceptedAt, e.startedAt, null, e.deliveredAt, e.completedAt][step];
  return at ? new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
}
