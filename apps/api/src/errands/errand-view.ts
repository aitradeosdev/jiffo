import { allowedEvents, type Actor, type ErrandEvent, type TransitionContext } from '@jiffo/shared';
import type { errandStops, errands } from '../db/schema';

export type ErrandRow = typeof errands.$inferSelect;
export type StopRow = typeof errandStops.$inferSelect;
/** prospect: an agent looking at an open errand on the board, before accepting it. */
export type ViewerRole = 'customer' | 'agent' | 'prospect';

export interface PersonSummary {
  id: string;
  firstName: string | null;
}

/** The state machine's view of an errand, for one actor. */
export const transitionContext = (errand: ErrandRow, actor: Actor): TransitionContext => ({
  actor,
  buy: errand.buy,
  pendingOffer: errand.pendingOfferKobo !== null,
});

export function eventsFor(errand: ErrandRow, role: ViewerRole): ErrandEvent[] {
  const events = allowedEvents(errand.status, transitionContext(errand, role === 'customer' ? 'customer' : 'agent'));
  return role === 'prospect' ? events.filter((e) => e === 'accept') : events;
}

const AREA_FALLBACK = { pickup: 'Pickup area', stop: 'Stop area', dropoff: 'Drop-off area' } as const;

/**
 * Where a stop is, as an agent sees it before accepting: the general area and a point rounded to about a
 * kilometre, never the address or its label, so waiting errands can't be mined for where customers live
 * (docs/security-plan.md, R4). The first part of an address is the street or building, and any part with a
 * number in it may be a house, flat or plot, so neither is shown.
 */
export function stopArea(s: Pick<StopRow, 'kind' | 'address' | 'lat' | 'lng'>) {
  const general = s.address
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(1)
    .filter((p) => !/\d/.test(p));
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    label: null,
    address: general.slice(0, 2).join(', ') || AREA_FALLBACK[s.kind],
    lat: round(s.lat),
    lng: round(s.lng),
  };
}

export function errandView(
  errand: ErrandRow,
  stops: StopRow[],
  people: { customer: PersonSummary | null; agent: PersonSummary | null },
  role: ViewerRole,
  /** The customer locked the item amount: item money was (or is) held for it. */
  itemsLocked = false,
) {
  return {
    id: errand.id,
    status: errand.status,
    version: errand.version,
    countryCode: errand.countryCode,
    stateCode: errand.stateCode,
    categoryKey: errand.categoryKey,
    buy: errand.buy,
    urgent: errand.urgent,
    description: errand.description,
    feeKobo: errand.feeKobo,
    serviceFeeKobo: errand.serviceFeeKobo,
    pendingOfferKobo: errand.pendingOfferKobo,
    itemAmountKobo: errand.itemAmountKobo,
    itemsLocked,
    scheduledFor: errand.scheduledFor,
    settingsVersion: errand.settingsVersion,
    stops: [...stops]
      .sort((a, b) => a.seq - b.seq)
      .map((s) => ({
        seq: s.seq,
        kind: s.kind,
        label: s.label,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        ...(role === 'prospect' ? stopArea(s) : {}),
      })),
    customer: people.customer,
    agent: people.agent,
    role,
    allowedEvents: eventsFor(errand, role),
    acceptedAt: errand.acceptedAt,
    startedAt: errand.startedAt,
    deliveredAt: errand.deliveredAt,
    completedAt: errand.completedAt,
    cancelledAt: errand.cancelledAt,
    createdAt: errand.createdAt,
    updatedAt: errand.updatedAt,
  };
}
export type ErrandView = ReturnType<typeof errandView>;
