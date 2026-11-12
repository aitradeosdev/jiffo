import { and, asc, eq, gt } from 'drizzle-orm';
import type { Db } from '../db/database.module';
import { conversations, messages } from '../db/schema';
import type { ChatAdapter, ChatMessage, NewChatMessage } from '../adapters/chat';

/** Chat stored in Postgres and delivered over the Jiffo realtime socket. */
export class BuiltinChatAdapter implements ChatAdapter {
  readonly name = 'builtin';

  constructor(private readonly db: Db) {}

  async open(input: { errandId: string; customerId: string; agentId: string }) {
    const [row] = await this.db
      .insert(conversations)
      .values(input)
      .onConflictDoUpdate({ target: [conversations.errandId, conversations.agentId], set: { closedAt: null } })
      .returning({ id: conversations.id });
    return { conversationId: row!.id };
  }

  async close(conversationId: string) {
    await this.db.update(conversations).set({ closedAt: new Date() }).where(eq(conversations.id, conversationId));
  }

  async post(message: NewChatMessage) {
    const values = {
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      kind: message.kind,
      body: message.body,
      data: message.data ?? {},
      clientId: message.clientId ?? null,
    };
    const [inserted] = await this.db.insert(messages).values(values).onConflictDoNothing().returning();
    if (inserted) return { message: inserted as ChatMessage, duplicate: false };

    // The app retried a send that had already arrived: hand back the original.
    const [existing] = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, message.conversationId),
          eq(messages.senderId, message.senderId!),
          eq(messages.clientId, message.clientId!),
        ),
      );
    return { message: existing as ChatMessage, duplicate: true };
  }

  async list(conversationId: string, options: { afterId?: number; limit: number }) {
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          options.afterId ? gt(messages.id, options.afterId) : undefined,
        ),
      )
      .orderBy(asc(messages.id))
      .limit(options.limit);
    return rows as ChatMessage[];
  }

  async clientAccess(conversationId: string) {
    return { provider: 'builtin' as const, transport: 'realtime' as const, conversationId };
  }
}
