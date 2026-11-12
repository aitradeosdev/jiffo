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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatService = exports.messageView = void 0;
const common_1 = require("@nestjs/common");
const drizzle_orm_1 = require("drizzle-orm");
const shared_1 = require("@jiffo/shared");
const database_module_1 = require("../db/database.module");
const schema_1 = require("../db/schema");
const chat_1 = require("../adapters/chat");
const realtime_gateway_1 = require("../realtime/realtime.gateway");
const push_service_1 = require("../push/push.service");
const errors_1 = require("../common/errors");
const messageView = (m) => ({
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    senderRole: m.senderRole,
    kind: m.kind,
    body: m.body,
    data: m.data,
    clientId: m.clientId,
    createdAt: m.createdAt,
});
exports.messageView = messageView;
let ChatService = class ChatService {
    db;
    chat;
    realtime;
    push;
    constructor(db, chat, realtime, push) {
        this.db = db;
        this.chat = chat;
        this.realtime = realtime;
        this.push = push;
    }
    /** The caller's conversation on this errand: the customer sees the current agent's, an agent only their own. */
    async conversationFor(errandId, auth) {
        const [errand] = await this.db.select().from(schema_1.errands).where((0, drizzle_orm_1.eq)(schema_1.errands.id, errandId));
        const isCustomer = auth.app === 'customer' && errand?.customerId === auth.userId;
        if (!errand || (!isCustomer && auth.app !== 'agent'))
            throw (0, errors_1.notFound)('errand_not_found', 'Errand not found');
        const [conversation] = await this.db
            .select()
            .from(schema_1.conversations)
            .where(isCustomer
            ? (0, drizzle_orm_1.eq)(schema_1.conversations.errandId, errandId)
            : (0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.conversations.errandId, errandId), (0, drizzle_orm_1.eq)(schema_1.conversations.agentId, auth.userId)))
            .orderBy((0, drizzle_orm_1.desc)(schema_1.conversations.createdAt))
            .limit(1);
        if (!conversation) {
            if (!isCustomer)
                throw (0, errors_1.notFound)('errand_not_found', 'Errand not found');
            throw (0, errors_1.notFound)('chat_not_open', 'Chat opens once an agent accepts');
        }
        return { errand, conversation, role: isCustomer ? 'customer' : 'agent' };
    }
    async list(errandId, auth, afterId, limit) {
        const { errand, conversation } = await this.conversationFor(errandId, auth);
        const rows = await this.chat.list(conversation.id, { afterId, limit });
        return {
            conversation: {
                id: conversation.id,
                open: !conversation.closedAt && !shared_1.TERMINAL_STATES.has(errand.status),
                access: await this.chat.clientAccess(conversation.id, auth.userId),
            },
            messages: rows.map(exports.messageView),
        };
    }
    async send(errandId, auth, input) {
        const { errand, conversation, role } = await this.conversationFor(errandId, auth);
        if (conversation.closedAt || shared_1.TERMINAL_STATES.has(errand.status)) {
            throw (0, errors_1.conflict)('chat_closed', 'This chat has ended');
        }
        const { message, duplicate } = await this.chat.post({
            conversationId: conversation.id,
            senderId: auth.userId,
            senderRole: role,
            kind: 'text',
            body: input.body,
            clientId: input.clientId,
        });
        const view = (0, exports.messageView)(message);
        if (!duplicate) {
            this.realtime.toErrand(errandId, 'message.created', { errandId, message: view });
            const [sender] = await this.db
                .select({ firstName: schema_1.users.firstName })
                .from(schema_1.users)
                .where((0, drizzle_orm_1.eq)(schema_1.users.id, auth.userId));
            const recipient = role === 'customer' ? conversation.agentId : conversation.customerId;
            await this.push.notifyUser(recipient, role === 'customer' ? 'agent' : 'customer', {
                title: sender?.firstName ?? (role === 'customer' ? 'Customer' : 'Your agent'),
                body: input.body.length > 120 ? `${input.body.slice(0, 117)}...` : input.body,
                data: { type: 'chat.message', errandId },
            });
        }
        return view;
    }
    open(input) {
        return this.chat.open(input);
    }
    async closeOpen(errandId) {
        const open = await this.db
            .select({ id: schema_1.conversations.id, closedAt: schema_1.conversations.closedAt })
            .from(schema_1.conversations)
            .where((0, drizzle_orm_1.eq)(schema_1.conversations.errandId, errandId));
        await Promise.all(open.filter((c) => !c.closedAt).map((c) => this.chat.close(c.id)));
    }
    /** A timeline note in the chat, such as "New price proposed". */
    async system(errandId, agentId, body, data = {}) {
        const [conversation] = await this.db
            .select()
            .from(schema_1.conversations)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.conversations.errandId, errandId), (0, drizzle_orm_1.eq)(schema_1.conversations.agentId, agentId)));
        if (!conversation)
            return;
        const { message } = await this.chat.post({
            conversationId: conversation.id,
            senderId: null,
            senderRole: 'system',
            kind: 'system',
            body,
            data,
        });
        this.realtime.toErrand(errandId, 'message.created', { errandId, message: (0, exports.messageView)(message) });
    }
};
exports.ChatService = ChatService;
exports.ChatService = ChatService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Inject)(database_module_1.DB)),
    __param(1, (0, common_1.Inject)(chat_1.CHAT)),
    __metadata("design:paramtypes", [Object, Object, realtime_gateway_1.RealtimeGateway,
        push_service_1.PushService])
], ChatService);
//# sourceMappingURL=chat.service.js.map