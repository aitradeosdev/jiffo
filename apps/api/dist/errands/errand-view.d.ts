import { type ErrandEvent } from '@jiffo/shared';
import type { errandStops, errands } from '../db/schema';
export type ErrandRow = typeof errands.$inferSelect;
export type StopRow = typeof errandStops.$inferSelect;
/** prospect: an agent looking at an open errand on the board, before accepting it. */
export type ViewerRole = 'customer' | 'agent' | 'prospect';
export interface PersonSummary {
    id: string;
    firstName: string | null;
}
export declare function eventsFor(errand: ErrandRow, role: ViewerRole): ErrandEvent[];
export declare function errandView(errand: ErrandRow, stops: StopRow[], people: {
    customer: PersonSummary | null;
    agent: PersonSummary | null;
}, role: ViewerRole): {
    id: string;
    status: "requested" | "accepted" | "started" | "item_pending" | "items_locked" | "delivered" | "photo_pending" | "unreachable" | "disputed" | "completed" | "cancelled" | "expired";
    version: number;
    countryCode: string;
    stateCode: string;
    categoryKey: string;
    buy: boolean;
    urgent: boolean;
    description: string;
    feeKobo: number;
    pendingOfferKobo: number | null;
    itemAmountKobo: number | null;
    scheduledFor: Date | null;
    settingsVersion: number;
    stops: {
        seq: number;
        kind: "pickup" | "stop" | "dropoff";
        label: string | null;
        address: string;
        lat: number;
        lng: number;
    }[];
    customer: PersonSummary | null;
    agent: PersonSummary | null;
    role: ViewerRole;
    allowedEvents: ("accept" | "expire" | "cancel" | "withdraw" | "send_offer" | "accept_offer" | "decline_offer" | "release_agent" | "start" | "send_item_amount" | "lock_item_amount" | "item_lock_timeout" | "mark_delivered" | "confirm_pin" | "send_dropoff_photo" | "approve_photo" | "auto_release" | "report_unreachable" | "redeliver" | "unreachable_timeout" | "open_dispute" | "admin_intervene" | "resolve_complete" | "resolve_cancel")[];
    acceptedAt: Date | null;
    startedAt: Date | null;
    deliveredAt: Date | null;
    completedAt: Date | null;
    cancelledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
};
export type ErrandView = ReturnType<typeof errandView>;
