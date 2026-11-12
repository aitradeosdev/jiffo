/**
 * Errand chat. The built-in adapter keeps messages in Postgres and delivers them over the realtime
 * socket. A hosted provider (Stream, Sendbird, ...) would be another implementation of this port:
 * it creates the channel, stores the messages and tells the apps how to connect.
 */
export interface ChatMessage {
    id: number;
    conversationId: string;
    senderId: string | null;
    senderRole: 'customer' | 'agent' | 'system';
    kind: 'text' | 'system';
    body: string;
    data: Record<string, unknown>;
    clientId: string | null;
    createdAt: Date;
}
export interface NewChatMessage {
    conversationId: string;
    senderId: string | null;
    senderRole: ChatMessage['senderRole'];
    kind: ChatMessage['kind'];
    body: string;
    data?: Record<string, unknown>;
    clientId?: string | null;
}
/** What the app needs to join the conversation. The built-in chat runs over the Jiffo realtime socket. */
export type ChatClientAccess = {
    provider: 'builtin';
    transport: 'realtime';
    conversationId: string;
};
export interface ChatAdapter {
    readonly name: string;
    open(input: {
        errandId: string;
        customerId: string;
        agentId: string;
    }): Promise<{
        conversationId: string;
    }>;
    close(conversationId: string): Promise<void>;
    post(message: NewChatMessage): Promise<{
        message: ChatMessage;
        duplicate: boolean;
    }>;
    list(conversationId: string, options: {
        afterId?: number;
        limit: number;
    }): Promise<ChatMessage[]>;
    clientAccess(conversationId: string, userId: string): Promise<ChatClientAccess>;
}
export declare const CHAT: unique symbol;
