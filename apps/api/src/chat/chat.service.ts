import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { TERMINAL_STATES } from '@jiffo/shared';
import { DB, type Db } from '../db/database.module';
import { conversations, errands, users } from '../db/schema';
import { CHAT, type ChatAdapter, type ChatMessage } from '../adapters/chat';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PushService } from '../push/push.service';
import type { AuthContext } from '../auth/auth.types';
import { conflict, notFound } from '../common/errors';

export const messageView = (m: ChatMessage) => ({
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

@Injectable()
export class ChatService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CHAT) private readonly chat: ChatAdapter,
    private readonly realtime: RealtimeGateway,
    private readonly push: PushService,
  ) {}

  /** The caller's conversation on this errand: the customer sees the current agent's, an agent only their own. */
  private async conversationFor(errandId: string, auth: AuthContext) {
    const [errand] = await this.db.select().from(errands).where(eq(errands.id, errandId));
    const isCustomer = auth.app === 'customer' && errand?.customerId === auth.userId;
    if (!errand || (!isCustomer && auth.app !== 'agent')) throw notFound('errand_not_found', 'Errand not found');

    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(
        isCustomer
          ? eq(conversations.errandId, errandId)
          : and(eq(conversations.errandId, errandId), eq(conversations.agentId, auth.userId)),
      )
      .orderBy(desc(conversations.createdAt))
      .limit(1);
    if (!conversation) {
      if (!isCustomer) throw notFound('errand_not_found', 'Errand not found');
      throw notFound('chat_not_open', 'Chat opens once an agent accepts');
    }
    return { errand, conversation, role: isCustomer ? ('customer' as const) : ('agent' as const) };
  }

  async list(errandId: string, auth: AuthContext, afterId: number | undefined, limit: number) {
    const { errand, conversation } = await this.conversationFor(errandId, auth);
    const rows = await this.chat.list(conversation.id, { afterId, limit });
    return {
      conversation: {
        id: conversation.id,
        open: !conversation.closedAt && !TERMINAL_STATES.has(errand.status),
        access: await this.chat.clientAccess(conversation.id, auth.userId),
      },
      messages: rows.map(messageView),
    };
  }

  async send(errandId: string, auth: AuthContext, input: { body: string; clientId: string }) {
    const { errand, conversation, role } = await this.conversationFor(errandId, auth);
    if (conversation.closedAt || TERMINAL_STATES.has(errand.status)) {
      throw conflict('chat_closed', 'This chat has ended');
    }
    const { message, duplicate } = await this.chat.post({
      conversationId: conversation.id,
      senderId: auth.userId,
      senderRole: role,
      kind: 'text',
      body: input.body,
      clientId: input.clientId,
    });
    const view = messageView(message);
    if (!duplicate) {
      this.realtime.toErrand(errandId, 'message.created', { errandId, message: view });
      const [sender] = await this.db
        .select({ firstName: users.firstName })
        .from(users)
        .where(eq(users.id, auth.userId));
      const recipient = role === 'customer' ? conversation.agentId : conversation.customerId;
      await this.push.notifyUser(recipient, role === 'customer' ? 'agent' : 'customer', {
        title: sender?.firstName ?? (role === 'customer' ? 'Customer' : 'Your agent'),
        body: input.body.length > 120 ? `${input.body.slice(0, 117)}...` : input.body,
        data: { type: 'chat.message', errandId },
      });
    }
    return view;
  }

  open(input: { errandId: string; customerId: string; agentId: string }) {
    return this.chat.open(input);
  }

  async closeOpen(errandId: string) {
    const open = await this.db
      .select({ id: conversations.id, closedAt: conversations.closedAt })
      .from(conversations)
      .where(eq(conversations.errandId, errandId));
    await Promise.all(open.filter((c) => !c.closedAt).map((c) => this.chat.close(c.id)));
  }

  /** A timeline note in the chat, such as "New price proposed". */
  async system(errandId: string, agentId: string, body: string, data: Record<string, unknown> = {}) {
    const [conversation] = await this.db
      .select()
      .from(conversations)
      .where(and(eq(conversations.errandId, errandId), eq(conversations.agentId, agentId)));
    if (!conversation) return;
    const { message } = await this.chat.post({
      conversationId: conversation.id,
      senderId: null,
      senderRole: 'system',
      kind: 'system',
      body,
      data,
    });
    this.realtime.toErrand(errandId, 'message.created', { errandId, message: messageView(message) });
  }
}
