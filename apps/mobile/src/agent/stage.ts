import { naira } from '../money';
import type { Stage } from '../errands/stage';
import { stepOf, type ErrandView } from '../errands/types';

const place = (e: ErrandView, kind: 'pickup' | 'dropoff') => {
  const s = e.stops.find((x) => x.kind === kind);
  return s?.label ?? s?.address ?? (kind === 'pickup' ? 'the pickup' : 'the drop-off');
};

/** How a job reads to the agent, after the prototype's agent trip screen. */
export function agentStage(e: ErrandView): Stage {
  const c = e.customer?.firstName ?? 'The customer';
  const pick = place(e, 'pickup');
  const drop = place(e, 'dropoff');
  const step = stepOf(e.status);
  const waiting = { label: 'Waiting', tone: 'neutral' as const };
  const yourTurn = { label: 'Your turn', tone: 'urgent' as const };
  switch (e.status) {
    case 'accepted':
      return e.pendingOfferKobo !== null
        ? {
            step,
            chip: waiting,
            big: `Waiting for ${c}`,
            sub: `${c} is answering your new price of ${naira(e.pendingOfferKobo)}.`,
            doing: 'Answering your new price',
          }
        : {
            step,
            chip: { label: 'Accepted', tone: 'brand' },
            big: 'Agree the price',
            sub: 'Then tap Start service. New prices are allowed until then.',
            doing: `Expecting you at ${pick}`,
          };
    case 'started':
      return e.buy
        ? {
            step,
            chip: yourTurn,
            big: 'Buy the items',
            sub: `At ${pick}. Then send the item amount with the receipt and items photos.`,
            doing: 'Following you on the map',
          }
        : {
            step,
            chip: { label: 'In progress', tone: 'brand' },
            big: `Take it to ${drop}`,
            sub: `Collect at ${pick}, then mark it delivered at the drop-off.`,
            doing: `Expecting you at ${drop}`,
          };
    case 'item_pending':
      return {
        step,
        chip: waiting,
        big: `Waiting for ${c}`,
        sub: `${c} is checking the receipt before locking ${naira(e.itemAmountKobo ?? 0)}.`,
        doing: 'Checking your photos',
      };
    case 'items_locked':
      return {
        step,
        chip: { label: 'On the way', tone: 'brand' },
        big: `Drop-off: ${drop}`,
        sub: 'The item money is locked for you. Head to the drop-off.',
        doing: `Expecting you at ${drop}`,
      };
    case 'delivered':
      return {
        step,
        chip: yourTurn,
        big: `Ask for ${c}'s PIN`,
        sub: 'They can see it now that you marked it delivered.',
        doing: 'Opening the PIN',
      };
    case 'photo_pending':
      return {
        step,
        chip: waiting,
        big: 'Photo sent',
        sub: `${c} approves it, or it approves itself in 24 hours.`,
        doing: 'Looking at your photo',
      };
    case 'unreachable':
      return {
        step,
        chip: waiting,
        big: `Waiting for ${c}`,
        sub: 'They have 24 hours to ask for redelivery. Support steps in after that.',
        doing: "Couldn't be reached",
      };
    case 'disputed':
      return {
        step,
        chip: { label: 'Under review', tone: 'danger' },
        big: 'Support is reviewing',
        sub: 'Your earnings stay held until they decide.',
        doing: 'Support is looking at the chat and photos',
      };
    case 'completed':
      return { step, chip: { label: 'Completed', tone: 'brand' }, big: 'Delivered', sub: '', doing: 'Done' };
    default:
      return {
        step,
        chip: { label: 'Ended', tone: 'neutral' },
        big: 'This errand ended',
        sub: '',
        doing: '',
      };
  }
}
