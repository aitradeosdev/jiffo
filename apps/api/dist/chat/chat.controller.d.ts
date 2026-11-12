import { z } from 'zod';
import type { AuthContext } from '../auth/auth.types';
import { ChatService } from './chat.service';
declare const SendBody: z.ZodObject<{
    body: z.ZodString;
    /** Set by the app per message, so a retried send never shows twice. */
    clientId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    clientId: string;
    body: string;
}, {
    clientId: string;
    body: string;
}>;
declare const ListQuery: z.ZodObject<{
    after: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    limit: number;
    after?: number | undefined;
}, {
    limit?: number | undefined;
    after?: number | undefined;
}>;
export declare class ChatController {
    private readonly chat;
    constructor(chat: ChatService);
    list(auth: AuthContext, id: string, query: z.infer<typeof ListQuery>): Promise<{
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
    send(auth: AuthContext, id: string, body: z.infer<typeof SendBody>): Promise<{
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
}
export {};
