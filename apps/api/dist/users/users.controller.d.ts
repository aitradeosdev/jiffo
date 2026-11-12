import { z } from 'zod';
import { type Db } from '../db/database.module';
import type { AuthContext } from '../auth/auth.types';
declare const UpdateMeBody: z.ZodEffects<z.ZodObject<{
    firstName: z.ZodOptional<z.ZodString>;
    lastName: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    firstName?: string | undefined;
    lastName?: string | undefined;
    email?: string | null | undefined;
}, {
    firstName?: string | undefined;
    lastName?: string | undefined;
    email?: string | null | undefined;
}>, {
    firstName?: string | undefined;
    lastName?: string | undefined;
    email?: string | null | undefined;
}, {
    firstName?: string | undefined;
    lastName?: string | undefined;
    email?: string | null | undefined;
}>;
export declare class UsersController {
    private readonly db;
    constructor(db: Db);
    me(auth: AuthContext): Promise<{
        id: string;
        phone: string;
        countryCode: string;
        firstName: string | null;
        lastName: string | null;
        email: string | null;
        createdAt: Date;
    }>;
    update(auth: AuthContext, body: z.infer<typeof UpdateMeBody>): Promise<{
        id: string;
        phone: string;
        countryCode: string;
        firstName: string | null;
        lastName: string | null;
        email: string | null;
        createdAt: Date;
    }>;
}
export {};
