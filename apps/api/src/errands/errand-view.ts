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

export function errandView(
  errand: ErrandRow,
  stops: StopRow[],
  people: { customer: PersonSummary | null; agent: PersonSummary | null },
  role: ViewerRole,
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
    pendingOfferKobo: errand.pendingOfferKobo,
    itemAmountKobo: errand.itemAmountKobo,
    scheduledFor: errand.scheduledFor,
    settingsVersion: errand.settingsVersion,
    stops: [...stops]
      .sort((a, b) => a.seq - b.seq)
      .map((s) => ({ seq: s.seq, kind: s.kind, label: s.label, address: s.address, lat: s.lat, lng: s.lng })),
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
