/** SMS and one-time codes. Each provider (Termii, Africa's Talking, ...) is one implementation. */
export interface MessagingAdapter {
    readonly name: string;
    sendOtp(phone: string, code: string, ttlSeconds: number): Promise<void>;
}
export declare const MESSAGING: unique symbol;
/** Development only: prints the code to the server log. */
export declare class ConsoleMessagingAdapter implements MessagingAdapter {
    readonly name = "console";
    private readonly logger;
    sendOtp(phone: string, code: string, ttlSeconds: number): Promise<void>;
}
/** Tests: keeps the codes in memory so a test can read them back. */
export declare class MemoryMessagingAdapter implements MessagingAdapter {
    readonly name = "memory";
    readonly sent: Array<{
        phone: string;
        code: string;
    }>;
    sendOtp(phone: string, code: string): Promise<void>;
    lastCodeFor(phone: string): string | undefined;
}
/** Termii SMS on the DND route, so codes reach numbers with do-not-disturb switched on. */
export declare class TermiiMessagingAdapter implements MessagingAdapter {
    private readonly apiKey;
    private readonly senderId;
    private readonly baseUrl;
    private readonly fetchImpl;
    readonly name = "termii";
    constructor(apiKey: string, senderId: string, baseUrl: string, fetchImpl?: typeof fetch);
    sendOtp(phone: string, code: string, ttlSeconds: number): Promise<void>;
}
