export interface PushNotification {
    title: string;
    body: string;
    /** String values only: both FCM and APNs deliver data as strings. */
    data?: Record<string, string>;
}
export interface PushResult {
    /** Tokens the provider says are dead (app removed, token rotated). They are cleared from the device. */
    invalidTokens: string[];
}
/** Push notifications. FCM covers Android and iOS; another provider is one more implementation. */
export interface PushAdapter {
    readonly name: string;
    send(tokens: string[], notification: PushNotification): Promise<PushResult>;
}
export declare const PUSH: unique symbol;
export declare class ConsolePushAdapter implements PushAdapter {
    readonly name = "console";
    private readonly logger;
    send(tokens: string[], n: PushNotification): Promise<{
        invalidTokens: never[];
    }>;
}
export declare class MemoryPushAdapter implements PushAdapter {
    readonly name = "memory";
    readonly sent: Array<{
        token: string;
    } & PushNotification>;
    /** Tokens to report as dead, for tests of token clean-up. */
    readonly dead: Set<string>;
    send(tokens: string[], n: PushNotification): Promise<{
        invalidTokens: string[];
    }>;
}
/** Firebase Cloud Messaging, HTTP v1 API, authenticated with a service account. */
export declare class FcmPushAdapter implements PushAdapter {
    private readonly fetchImpl;
    readonly name = "fcm";
    private readonly account;
    private accessToken;
    private readonly logger;
    constructor(serviceAccountJson: string, fetchImpl?: typeof fetch);
    private token;
    send(tokens: string[], n: PushNotification): Promise<PushResult>;
}
