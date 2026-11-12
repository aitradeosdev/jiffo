"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuiltinChatAdapter = void 0;
const drizzle_orm_1 = require("drizzle-orm");
const schema_1 = require("../db/schema");
/** Chat stored in Postgres and delivered over the Jiffo realtime socket. */
class BuiltinChatAdapter {
    db;
    name = 'builtin';
    constructor(db) {
        this.db = db;
    }
    async open(input) {
        const [row] = await this.db
            .insert(schema_1.conversations)
            .values(input)
            .onConflictDoUpdate({ target: [schema_1.conversations.errandId, schema_1.conversations.agentId], set: { closedAt: null } })
            .returning({ id: schema_1.conversations.id });
        return { conversationId: row.id };
    }
    async close(conversationId) {
        await this.db.update(schema_1.conversations).set({ closedAt: new Date() }).where((0, drizzle_orm_1.eq)(schema_1.conversations.id, conversationId));
    }
    async post(message) {
        const values = {
            conversationId: message.conversationId,
            senderId: message.senderId,
            senderRole: message.senderRole,
            kind: message.kind,
            body: message.body,
            data: message.data ?? {},
            clientId: message.clientId ?? null,
        };
        const [inserted] = await this.db.insert(schema_1.messages).values(values).onConflictDoNothing().returning();
        if (inserted)
            return { message: inserted, duplicate: false };
        // The app retried a send that had already arrived: hand back the original.
        const [existing] = await this.db
            .select()
            .from(schema_1.messages)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.messages.conversationId, message.conversationId), (0, drizzle_orm_1.eq)(schema_1.messages.senderId, message.senderId), (0, drizzle_orm_1.eq)(schema_1.messages.clientId, message.clientId)));
        return { message: existing, duplicate: true };
    }
    async list(conversationId, options) {
        const rows = await this.db
            .select()
            .from(schema_1.messages)
            .where((0, drizzle_orm_1.and)((0, drizzle_orm_1.eq)(schema_1.messages.conversationId, conversationId), options.afterId ? (0, drizzle_orm_1.gt)(schema_1.messages.id, options.afterId) : undefined))
            .orderBy((0, drizzle_orm_1.asc)(schema_1.messages.id))
            .limit(options.limit);
        return rows;
    }
    async clientAccess(conversationId) {
        return { provider: 'builtin', transport: 'realtime', conversationId };
    }
}
exports.BuiltinChatAdapter = BuiltinChatAdapter;
//# sourceMappingURL=builtin-chat.adapter.js.map