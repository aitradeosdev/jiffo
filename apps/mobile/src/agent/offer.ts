import { shortWhen } from '../errands/when';

/** An urgent errand offered to this agent alone (GET /v1/agent/offers/current; docs/matching.md, M6). */
export interface Offer {
  id: string;
  expiresAt: string;
  /** By the server's clock when it answered: the app counts down from this, as a phone's clock can be off. */
  secondsLeft: number;
  /** The whole time the agent had to answer, for the countdown bar. */
  windowSeconds: number;
  agentEarnsKobo: number;
  errand: {
    id: string;
    categoryKey: string;
    feeKobo: number;
    buy: boolean;
    urgent: boolean;
    stopCount: number;
    scheduledFor: string | null;
  };
  /** The areas only, never an address, and how far each is from where the agent was when offered it. */
  pickup: { area: string; km: number };
  dropoff: { area: string; km: number };
  customer: {
    firstName: string | null;
    lastInitial: string | null;
    verified: boolean;
    rating: number | null;
    completedErrands: number;
  };
}

/** When the offer ends by this phone's clock: the server's seconds left, from when its answer came. */
export const offerEndsAt = (offer: Pick<Offer, 'secondsLeft'>, receivedAt: number) =>
  receivedAt + offer.secondsLeft * 1000;

/** Whole seconds still to go, rounded up, never below 0. */
export const secondsToGo = (endsAt: number, now: number) => Math.max(0, Math.ceil((endsAt - now) / 1000));

/** "Ada O. · Verified · 4.8 ★ · 12 errands": who the customer is, without their full name. */
export function customerLine(c: Offer['customer']) {
  if (!c.firstName) return 'A new customer';
  const parts = [c.lastInitial ? `${c.firstName} ${c.lastInitial}.` : c.firstName];
  if (c.verified) parts.push('Verified');
  if (c.rating !== null) parts.push(`${c.rating.toFixed(1)} ★`);
  if (c.completedErrands > 0) parts.push(`${c.completedErrands} ${c.completedErrands === 1 ? 'errand' : 'errands'}`);
  return parts.join(' · ');
}

/** When, how many stops, and whether the agent pays for items: what the errand involves, in short. */
export function offerFacts(offer: Offer) {
  const { errand } = offer;
  return [
    errand.scheduledFor ? `Scheduled for ${shortWhen(errand.scheduledFor)}` : 'Now',
    `${errand.stopCount} stops`,
    ...(errand.buy ? ['You buy the items'] : []),
  ];
}

/** How full the countdown bar is: what's left of the whole window, from 0 to 1. */
export const barShare = (left: number, windowSeconds: number) =>
  windowSeconds > 0 ? Math.min(1, Math.max(0, left / windowSeconds)) : 0;

/**
 * Whether a push in the phone's tray is this offer's: by its data when the app showed it, else by the tag the
 * server gives offer pushes, which is all that's left of one the phone showed with the app in the background.
 */
export function isPushForOffer(push: { identifier: string; data: unknown }, offerId: string) {
  const data = push.data as { offerId?: unknown } | null;
  if (isOfferPush(data)) return data?.offerId === offerId;
  const query = push.identifier.split('?')[1] ?? '';
  return query.split('&').some((part) => part === `tag=${encodeURIComponent(offerId)}`);
}

/** A push about an offer (the server's data.type), to open the offer screen from. */
export function isOfferPush(data: unknown) {
  return !!data && typeof data === 'object' && (data as { type?: unknown }).type === 'errand.offer';
}

/** Why Jiffo took the agent offline, as the app tells them; null when it didn't. */
export function offlineMessage(reason: string | null | undefined): string | null {
  if (!reason) return null;
  if (reason === 'missed_offers') {
    return "You missed several offers in a row, so Jiffo took you offline. Go online again when you're ready.";
  }
  return "Jiffo took you offline. Go online again when you're ready.";
}
