import { z } from 'zod';
import type { AuthContext } from '../auth/auth.types';
import { PushService } from './push.service';
declare const PushTokenBody: z.ZodObject<{
    token: z.ZodNullable<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    token: string | null;
}, {
    token: string | null;
}>;
export declare class PushController {
    private readonly push;
    constructor(push: PushService);
    /** The app sends its push token after sign-in and whenever it changes; null switches push off. */
    setToken(auth: AuthContext, body: z.infer<typeof PushTokenBody>): Promise<void>;
}
export {};
