import { z } from 'zod';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AuthService } from './auth.service';
import type { AuthContext, AuthedRequest } from './auth.types';
declare const RequestCodeBody: z.ZodObject<{
    phone: z.ZodString;
}, "strip", z.ZodTypeAny, {
    phone: string;
}, {
    phone: string;
}>;
declare const VerifyCodeBody: z.ZodObject<{
    phone: z.ZodString;
    code: z.ZodString;
    app: z.ZodEnum<["customer", "agent"]>;
    device: z.ZodObject<{
        key: z.ZodString;
        platform: z.ZodEnum<["ios", "android", "web"]>;
        name: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        key: string;
        platform: "ios" | "android" | "web";
        name?: string | undefined;
    }, {
        key: string;
        platform: "ios" | "android" | "web";
        name?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
    code: string;
    phone: string;
    app: "customer" | "agent";
    device: {
        key: string;
        platform: "ios" | "android" | "web";
        name?: string | undefined;
    };
}, {
    code: string;
    phone: string;
    app: "customer" | "agent";
    device: {
        key: string;
        platform: "ios" | "android" | "web";
        name?: string | undefined;
    };
}>;
declare const RefreshBody: z.ZodObject<{
    refreshToken: z.ZodString;
}, "strip", z.ZodTypeAny, {
    refreshToken: string;
}, {
    refreshToken: string;
}>;
export declare class AuthController {
    private readonly auth;
    private readonly realtime;
    constructor(auth: AuthService, realtime: RealtimeGateway);
    request(body: z.infer<typeof RequestCodeBody>, req: AuthedRequest): Promise<{
        expiresInSeconds: number;
        resendInSeconds: number;
        phone: string;
    }>;
    verify(body: z.infer<typeof VerifyCodeBody>): Promise<{
        user: {
            id: string;
            phone: string;
            countryCode: string;
            firstName: string | null;
            lastName: string | null;
            email: string | null;
            createdAt: Date;
        };
        isNewUser: boolean;
        accessToken: string;
        accessTokenExpiresIn: number;
        refreshToken: string;
    }>;
    refresh(body: z.infer<typeof RefreshBody>): Promise<{
        accessToken: string;
        accessTokenExpiresIn: number;
        refreshToken: string;
    } | undefined>;
    logout(auth: AuthContext): Promise<void>;
    logoutOthers(auth: AuthContext): Promise<void>;
}
export {};
