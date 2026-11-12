import type { Db } from '../db/database.module';
import type { ChatAdapter, ChatMessage, NewChatMessage } from '../adapters/chat';
/** Chat stored in Postgres and delivered over the Jiffo realtime socket. */
export declare class BuiltinChatAdapter implements ChatAdapter {
    private readonly db;
    readonly name = "builtin";
    constructor(db: Db);
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
    clientAccess(conversationId: string): Promise<{
        provider: "builtin";
        transport: "realtime";
        conversationId: string;
    }>;
}
