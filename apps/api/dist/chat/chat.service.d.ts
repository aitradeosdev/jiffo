import { type Db } from '../db/database.module';
import { type ChatAdapter, type ChatMessage } from '../adapters/chat';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PushService } from '../push/push.service';
import type { AuthContext } from '../auth/auth.types';
export declare const messageView: (m: ChatMessage) => {
    id: number;
    conversationId: string;
    senderId: string | null;
    senderRole: "customer" | "agent" | "system";
    kind: "system" | "text";
    body: string;
    data: Record<string, unknown>;
    clientId: string | null;
    createdAt: Date;
};
export declare class ChatService {
    private readonly db;
    private readonly chat;
    private readonly realtime;
    private readonly push;
    constructor(db: Db, chat: ChatAdapter, realtime: RealtimeGateway, push: PushService);
    /** The caller's conversation on this errand: the customer sees the current agent's, an agent only their own. */
    private conversationFor;
    list(errandId: string, auth: AuthContext, afterId: number | undefined, limit: number): Promise<{
        conversation: {
            id: string;
            open: boolean;
            access: import("../adapters/chat").ChatClientAccess;
        };
        messages: {
            id: number;
            conversationId: string;
            senderId: string | null;
            senderRole: "customer" | "agent" | "system";
            kind: "system" | "text";
            body: string;
            data: Record<string, unknown>;
            clientId: string | null;
            createdAt: Date;
        }[];
    }>;
    send(errandId: string, auth: AuthContext, input: {
        body: string;
        clientId: string;
    }): Promise<{
        id: number;
        conversationId: string;
        senderId: string | null;
        senderRole: "customer" | "agent" | "system";
        kind: "system" | "text";
        body: string;
        data: Record<string, unknown>;
        clientId: string | null;
        createdAt: Date;
    }>;
    open(input: {
        errandId: string;
        customerId: string;
        agentId: string;
    }): Promise<{
        conversationId: string;
    }>;
    closeOpen(errandId: string): Promise<void>;
    /** A timeline note in the chat, such as "New price proposed". */
    system(errandId: string, agentId: string, body: string, data?: Record<string, unknown>): Promise<void>;
}
