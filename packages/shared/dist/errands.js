"use strict";
/**
 * The errand lifecycle. Every state, every event and who may trigger it lives here, once.
 * The backend runs every change through `nextState`, and the apps use `allowedEvents`
 * to decide which buttons to show.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransitionError = exports.ERRAND_EVENT_NAMES = exports.ERRAND_EVENTS = exports.TERMINAL_STATES = exports.ERRAND_STATES = void 0;
exports.isErrandEvent = isErrandEvent;
exports.nextState = nextState;
exports.allowedEvents = allowedEvents;
exports.canRevealPin = canRevealPin;
exports.ERRAND_STATES = [
    'requested', // waiting for an agent: pushed to nearby agents if urgent, otherwise on the board
    'accepted', // an agent accepted; the fee is held; new prices are allowed until Start service
    'started', // the agent tapped Start service; the fee is fixed
    'item_pending', // purchase errands: the item amount was sent with photos, waiting for the customer to lock it
    'items_locked', // purchase errands: the customer locked the item amount; the agent is on the way
    'delivered', // the agent marked it delivered; the customer can now see their PIN
    'photo_pending', // the agent sent a drop-off photo; waiting for the customer's approval
    'unreachable', // the agent marked the customer unreachable; the redelivery window is running
    'disputed', // admin decides
    'completed',
    'cancelled',
    'expired',
];
exports.TERMINAL_STATES = new Set(['completed', 'cancelled', 'expired']);
const IN_PROGRESS = ['started', 'item_pending', 'items_locked', 'delivered', 'photo_pending', 'unreachable'];
exports.ERRAND_EVENTS = {
    accept: { from: ['requested'], to: 'accepted', actors: ['agent'] },
    expire: { from: ['requested'], to: 'expired', actors: ['system'] },
    cancel: { from: ['requested', 'accepted'], to: 'cancelled', actors: ['customer'] },
    /** The agent leaves before starting; the errand goes back to matching. */
    withdraw: { from: ['accepted'], to: 'requested', actors: ['agent'] },
    send_offer: {
        from: ['accepted'],
        to: 'accepted',
        actors: ['agent'],
        guard: (c) => (c.pendingOffer ? 'A new price is already waiting for an answer' : null),
    },
    accept_offer: {
        from: ['accepted'],
        to: 'accepted',
        actors: ['customer'],
        guard: (c) => (c.pendingOffer ? null : 'There is no new price to answer'),
    },
    /** The customer declines the new price and keeps the agent at the old price. */
    decline_offer: {
        from: ['accepted'],
        to: 'accepted',
        actors: ['customer'],
        guard: (c) => (c.pendingOffer ? null : 'There is no new price to answer'),
    },
    /** "Get new agent": the session ends and the errand goes back to matching, with no cancellation fee. */
    release_agent: { from: ['accepted'], to: 'requested', actors: ['customer'] },
    start: {
        from: ['accepted'],
        to: 'started',
        actors: ['agent'],
        guard: (c) => (c.pendingOffer ? 'Wait for the customer to answer the new price' : null),
    },
    send_item_amount: {
        from: ['started'],
        to: 'item_pending',
        actors: ['agent'],
        guard: (c) => (c.buy ? null : 'This errand does not include buying items'),
    },
    lock_item_amount: { from: ['item_pending'], to: 'items_locked', actors: ['customer'] },
    /** The customer did not lock the item amount in time: admin decides who bears the cost. */
    item_lock_timeout: { from: ['item_pending'], to: 'disputed', actors: ['system'] },
    mark_delivered: {
        from: ['started', 'items_locked'],
        to: 'delivered',
        actors: ['agent'],
        guard: (c, from) => from === 'started' && c.buy ? 'Send the item amount and wait for it to be locked first' : null,
    },
    confirm_pin: { from: ['delivered'], to: 'completed', actors: ['agent'] },
    send_dropoff_photo: { from: ['delivered'], to: 'photo_pending', actors: ['agent'] },
    approve_photo: { from: ['photo_pending'], to: 'completed', actors: ['customer'] },
    auto_release: { from: ['photo_pending'], to: 'completed', actors: ['system'] },
    report_unreachable: { from: ['delivered'], to: 'unreachable', actors: ['agent'] },
    /** Redelivery at the same agreed fee. */
    redeliver: {
        from: ['unreachable'],
        to: (c) => (c.buy ? 'items_locked' : 'started'),
        actors: ['customer', 'admin'],
    },
    unreachable_timeout: { from: ['unreachable'], to: 'disputed', actors: ['system'] },
    open_dispute: { from: IN_PROGRESS, to: 'disputed', actors: ['customer', 'agent'] },
    admin_intervene: { from: ['item_pending', 'photo_pending', 'unreachable'], to: 'disputed', actors: ['admin'] },
    resolve_complete: { from: ['disputed'], to: 'completed', actors: ['admin'] },
    resolve_cancel: { from: ['disputed'], to: 'cancelled', actors: ['admin'] },
};
exports.ERRAND_EVENT_NAMES = Object.keys(exports.ERRAND_EVENTS);
class TransitionError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'TransitionError';
    }
}
exports.TransitionError = TransitionError;
function isErrandEvent(value) {
    return Object.prototype.hasOwnProperty.call(exports.ERRAND_EVENTS, value);
}
/** Works out the state after `event`, or throws a TransitionError explaining why it is not allowed. */
function nextState(from, event, ctx) {
    if (!isErrandEvent(event))
        throw new TransitionError('unknown_event', `Unknown errand event: ${event}`);
    const rule = exports.ERRAND_EVENTS[event];
    if (!rule.actors.includes(ctx.actor)) {
        throw new TransitionError('not_allowed', `A ${ctx.actor} cannot ${event.replace(/_/g, ' ')}`);
    }
    if (!rule.from.includes(from)) {
        throw new TransitionError('invalid_state', `Cannot ${event.replace(/_/g, ' ')} while the errand is ${from}`);
    }
    const blocked = rule.guard?.(ctx, from);
    if (blocked)
        throw new TransitionError('blocked', blocked);
    return typeof rule.to === 'function' ? rule.to(ctx) : rule.to;
}
/** The events this actor may trigger now: the apps use this to decide which actions to show. */
function allowedEvents(from, ctx) {
    return exports.ERRAND_EVENT_NAMES.filter((event) => {
        try {
            nextState(from, event, ctx);
            return true;
        }
        catch {
            return false;
        }
    });
}
/** The customer sees their hand-off PIN only once the agent has marked the errand delivered. */
function canRevealPin(state) {
    return state === 'delivered';
}
//# sourceMappingURL=errands.js.map