"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var ErrandNotifier_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.ErrandNotifier = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@jiffo/shared");
const chat_service_1 = require("../chat/chat.service");
const push_service_1 = require("../push/push.service");
const realtime_gateway_1 = require("../realtime/realtime.gateway");
const amount = (r) => (0, shared_1.formatNaira)(Number(r.amountKobo ?? 0));
/** What each event tells the other side. Events missing here only update the screens. */
function noteFor(event, r) {
    switch (event) {
        case 'accept':
            return {
                to: 'customer',
                title: 'Agent on the way',
                body: 'An agent accepted your errand.',
                chat: 'Agent accepted the errand',
            };
        case 'withdraw':
            return {
                to: 'customer',
                title: 'Finding another agent',
                body: 'Your agent could not continue. We are finding you another.',
            };
        case 'release_agent':
            return { to: 'agent', title: 'Errand released', body: 'The customer asked for a different agent.' };
        case 'cancel':
            return r.before.agentId
                ? { to: 'agent', title: 'Errand cancelled', body: 'The customer cancelled the errand.' }
                : null;
        case 'expire':
            return {
                to: 'customer',
                title: 'No agent found',
                body: 'No agent took your urgent errand in time. Try again or raise the fee.',
            };
        case 'send_offer':
            return {
                to: 'customer',
                title: 'New price',
                body: `Your agent proposed ${amount(r.record)}.`,
                chat: `New price proposed: ${amount(r.record)}`,
            };
        case 'accept_offer':
            return {
                to: 'agent',
                title: 'Price accepted',
                body: `The customer accepted ${amount(r.record)}.`,
                chat: `New price accepted: ${amount(r.record)}`,
            };
        case 'decline_offer':
            return {
                to: 'agent',
                title: 'Price declined',
                body: 'The customer kept the original fee.',
                chat: 'New price declined',
            };
        case 'start':
            return {
                to: 'customer',
                title: 'Errand started',
                body: 'Your agent started the errand.',
                chat: 'Errand started',
            };
        case 'send_item_amount':
            return {
                to: 'customer',
                title: 'Lock the item amount',
                body: `Items cost ${amount(r.record)}. Check the photos and lock it.`,
                chat: `Item amount sent: ${amount(r.record)}`,
            };
        case 'lock_item_amount':
            return {
                to: 'agent',
                title: 'Item amount locked',
                body: 'You can head to the drop-off.',
                chat: 'Item amount locked',
            };
        case 'item_lock_timeout':
            return {
                to: 'agent',
                title: 'Item amount not locked',
                body: 'The customer did not lock the item amount in time. Support will step in.',
            };
        case 'mark_delivered':
            return {
                to: 'customer',
                title: 'Your agent has arrived',
                body: 'Open Jiffo to see your hand-off PIN.',
                chat: 'Marked as delivered',
            };
        case 'confirm_pin':
            return {
                to: 'customer',
                title: 'Errand complete',
                body: 'Hand-off confirmed with your PIN.',
                chat: 'Hand-off confirmed',
            };
        case 'send_dropoff_photo':
            return {
                to: 'customer',
                title: 'Drop-off photo',
                body: 'Your agent left the items. Check the photo and approve it.',
                chat: 'Drop-off photo sent',
            };
        case 'approve_photo':
            return {
                to: 'agent',
                title: 'Drop-off approved',
                body: 'The customer approved the drop-off.',
                chat: 'Drop-off approved',
            };
        case 'auto_release':
            return { to: 'agent', title: 'Errand complete', body: 'The drop-off was approved automatically.' };
        case 'report_unreachable':
            return {
                to: 'customer',
                title: 'We could not reach you',
                body: 'Your agent is at the drop-off. Ask for redelivery in the app.',
                chat: 'Customer unreachable',
            };
        case 'redeliver':
            return {
                to: 'agent',
                title: 'Redelivery',
                body: 'The customer asked for redelivery.',
                chat: 'Redelivery requested',
            };
        case 'open_dispute':
            return {
                to: r.record.by === 'customer' ? 'agent' : 'customer',
                title: 'Dispute opened',
                body: 'Support will review this errand.',
                chat: 'Dispute opened. Support will review it.',
            };
        default:
            return null;
    }
}
/** After an errand changes: updates open screens, opens and closes the chat, writes chat notes, sends pushes. */
let ErrandNotifier = ErrandNotifier_1 = class ErrandNotifier {
    realtime;
    chat;
    push;
    logger = new common_1.Logger(ErrandNotifier_1.name);
    constructor(realtime, chat, push) {
        this.realtime = realtime;
        this.chat = chat;
        this.push = push;
    }
    async transitioned(r) {
        try {
            await this.run(r);
        }
        catch (error) {
            // The errand change is already saved; a failed notification must not undo or fail it.
            this.logger.warn(`Notifying ${r.event} on ${r.after.id} failed: ${error.message}`);
        }
    }
    async run(r) {
        const { before, after, event } = r;
        const agentId = after.agentId ?? before.agentId;
        if (event === 'accept' && after.agentId) {
            await this.chat.open({ errandId: after.id, customerId: after.customerId, agentId: after.agentId });
        }
        const note = noteFor(event, r);
        if (note?.chat && agentId)
            await this.chat.system(after.id, agentId, note.chat, { event });
        const update = { errandId: after.id, status: after.status, version: after.version, event };
        this.realtime.toErrand(after.id, 'errand.updated', update);
        this.realtime.toUser(after.customerId, 'customer', 'errand.updated', update);
        if (agentId)
            this.realtime.toUser(agentId, 'agent', 'errand.updated', update);
        if ((event === 'withdraw' || event === 'release_agent') && before.agentId) {
            await this.chat.closeOpen(after.id);
            this.realtime.removeFromErrand(before.agentId, 'agent', after.id);
        }
        if (shared_1.TERMINAL_STATES.has(after.status))
            await this.chat.closeOpen(after.id);
        if (note) {
            const userId = note.to === 'customer' ? after.customerId : agentId;
            if (userId) {
                await this.push.notifyUser(userId, note.to, {
                    title: note.title,
                    body: note.body,
                    data: { type: 'errand.updated', errandId: after.id, event, status: after.status },
                });
            }
        }
    }
};
exports.ErrandNotifier = ErrandNotifier;
exports.ErrandNotifier = ErrandNotifier = ErrandNotifier_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [realtime_gateway_1.RealtimeGateway,
        chat_service_1.ChatService,
        push_service_1.PushService])
], ErrandNotifier);
//# sourceMappingURL=errand-notifier.js.map