import { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Db } from '../db/database.module';
import { type AppName } from '../db/schema';
import { TokensService } from './tokens.service';
import type { AuthContext } from './auth.types';
/** Limits a route to sessions from these apps, e.g. @Apps('agent') for the job board. */
export declare const Apps: (...apps: AppName[]) => import("@nestjs/common").CustomDecorator<string>;
export declare class SessionVerifier {
    private readonly db;
    private readonly tokens;
    constructor(db: Db, tokens: TokensService);
    /** Checks the token and that its session is still live and the account active. */
    verify(token: string): Promise<AuthContext>;
}
export declare class AuthGuard implements CanActivate {
    private readonly verifier;
    private readonly reflector;
    constructor(verifier: SessionVerifier, reflector: Reflector);
    canActivate(context: ExecutionContext): Promise<boolean>;
}
/** The signed-in caller. Only valid on routes behind AuthGuard. */
export declare const CurrentAuth: (...dataOrPipes: unknown[]) => ParameterDecorator;
