/**
 * The errand lifecycle. Every state, every event and who may trigger it lives here, once.
 * The backend runs every change through `nextState`, and the apps use `allowedEvents`
 * to decide which buttons to show.
 */
export declare const ERRAND_STATES: readonly ["requested", "accepted", "started", "item_pending", "items_locked", "delivered", "photo_pending", "unreachable", "disputed", "completed", "cancelled", "expired"];
export type ErrandState = (typeof ERRAND_STATES)[number];
export declare const TERMINAL_STATES: ReadonlySet<ErrandState>;
export type Actor = 'customer' | 'agent' | 'system' | 'admin';
export interface TransitionContext {
    actor: Actor;
    /** The errand includes buying items (the "Agent buys items" switch). */
    buy: boolean;
    /** A new price from the agent is waiting for the customer's answer. */
    pendingOffer: boolean;
}
export declare const ERRAND_EVENTS: {
    readonly accept: {
        readonly from: readonly ["requested"];
        readonly to: "accepted";
        readonly actors: readonly ["agent"];
    };
    readonly expire: {
        readonly from: readonly ["requested"];
        readonly to: "expired";
        readonly actors: readonly ["system"];
    };
    readonly cancel: {
        readonly from: readonly ["requested", "accepted"];
        readonly to: "cancelled";
        readonly actors: readonly ["customer"];
    };
    /** The agent leaves before starting; the errand goes back to matching. */
    readonly withdraw: {
        readonly from: readonly ["accepted"];
        readonly to: "requested";
        readonly actors: readonly ["agent"];
    };
    readonly send_offer: {
        readonly from: readonly ["accepted"];
        readonly to: "accepted";
        readonly actors: readonly ["agent"];
        readonly guard: (c: TransitionContext) => "A new price is already waiting for an answer" | null;
    };
    readonly accept_offer: {
        readonly from: readonly ["accepted"];
        readonly to: "accepted";
        readonly actors: readonly ["customer"];
        readonly guard: (c: TransitionContext) => "There is no new price to answer" | null;
    };
    /** The customer declines the new price and keeps the agent at the old price. */
    readonly decline_offer: {
        readonly from: readonly ["accepted"];
        readonly to: "accepted";
        readonly actors: readonly ["customer"];
        readonly guard: (c: TransitionContext) => "There is no new price to answer" | null;
    };
    /** "Get new agent": the session ends and the errand goes back to matching, with no cancellation fee. */
    readonly release_agent: {
        readonly from: readonly ["accepted"];
        readonly to: "requested";
        readonly actors: readonly ["customer"];
    };
    readonly start: {
        readonly from: readonly ["accepted"];
        readonly to: "started";
        readonly actors: readonly ["agent"];
        readonly guard: (c: TransitionContext) => "Wait for the customer to answer the new price" | null;
    };
    readonly send_item_amount: {
        readonly from: readonly ["started"];
        readonly to: "item_pending";
        readonly actors: readonly ["agent"];
        readonly guard: (c: TransitionContext) => "This errand does not include buying items" | null;
    };
    readonly lock_item_amount: {
        readonly from: readonly ["item_pending"];
        readonly to: "items_locked";
        readonly actors: readonly ["customer"];
    };
    /** The customer did not lock the item amount in time: admin decides who bears the cost. */
    readonly item_lock_timeout: {
        readonly from: readonly ["item_pending"];
        readonly to: "disputed";
        readonly actors: readonly ["system"];
    };
    readonly mark_delivered: {
        readonly from: readonly ["started", "items_locked"];
        readonly to: "delivered";
        readonly actors: readonly ["agent"];
        readonly guard: (c: TransitionContext, from: "requested" | "accepted" | "started" | "item_pending" | "items_locked" | "delivered" | "photo_pending" | "unreachable" | "disputed" | "completed" | "cancelled" | "expired") => "Send the item amount and wait for it to be locked first" | null;
    };
    readonly confirm_pin: {
        readonly from: readonly ["delivered"];
        readonly to: "completed";
        readonly actors: readonly ["agent"];
    };
    readonly send_dropoff_photo: {
        readonly from: readonly ["delivered"];
        readonly to: "photo_pending";
        readonly actors: readonly ["agent"];
    };
    readonly approve_photo: {
        readonly from: readonly ["photo_pending"];
        readonly to: "completed";
        readonly actors: readonly ["customer"];
    };
    readonly auto_release: {
        readonly from: readonly ["photo_pending"];
        readonly to: "completed";
        readonly actors: readonly ["system"];
    };
    readonly report_unreachable: {
        readonly from: readonly ["delivered"];
        readonly to: "unreachable";
        readonly actors: readonly ["agent"];
    };
    /** Redelivery at the same agreed fee. */
    readonly redeliver: {
        readonly from: readonly ["unreachable"];
        readonly to: (c: TransitionContext) => "started" | "items_locked";
        readonly actors: readonly ["customer", "admin"];
    };
    readonly unreachable_timeout: {
        readonly from: readonly ["unreachable"];
        readonly to: "disputed";
        readonly actors: readonly ["system"];
    };
    readonly open_dispute: {
        readonly from: readonly ["started", "item_pending", "items_locked", "delivered", "photo_pending", "unreachable"];
        readonly to: "disputed";
        readonly actors: readonly ["customer", "agent"];
    };
    readonly admin_intervene: {
        readonly from: readonly ["item_pending", "photo_pending", "unreachable"];
        readonly to: "disputed";
        readonly actors: readonly ["admin"];
    };
    readonly resolve_complete: {
        readonly from: readonly ["disputed"];
        readonly to: "completed";
        readonly actors: readonly ["admin"];
    };
    readonly resolve_cancel: {
        readonly from: readonly ["disputed"];
        readonly to: "cancelled";
        readonly actors: readonly ["admin"];
    };
};
export type ErrandEvent = keyof typeof ERRAND_EVENTS;
export declare const ERRAND_EVENT_NAMES: ErrandEvent[];
export type TransitionErrorCode = 'unknown_event' | 'invalid_state' | 'not_allowed' | 'blocked';
export declare class TransitionError extends Error {
    readonly code: TransitionErrorCode;
    constructor(code: TransitionErrorCode, message: string);
}
export declare function isErrandEvent(value: string): value is ErrandEvent;
/** Works out the state after `event`, or throws a TransitionError explaining why it is not allowed. */
export declare function nextState(from: ErrandState, event: string, ctx: TransitionContext): ErrandState;
/** The events this actor may trigger now: the apps use this to decide which actions to show. */
export declare function allowedEvents(from: ErrandState, ctx: TransitionContext): ErrandEvent[];
/** The customer sees their hand-off PIN only once the agent has marked the errand delivered. */
export declare function canRevealPin(state: ErrandState): boolean;
