import { OnGatewayConnection } from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { type Db } from '../db/database.module';
import { type AppName } from '../db/schema';
import { SessionVerifier } from '../auth/auth.guard';
import type { AuthContext } from '../auth/auth.types';
type Ack = {
    ok: true;
} | {
    ok: false;
    error: {
        code: string;
        message: string;
    };
};
/**
 * One socket per signed-in app. Clients join their own user room on connect and subscribe to the
 * errands they are part of. Tokens go in the handshake: io(url + '/realtime', { auth: { token } }).
 */
export declare class RealtimeGateway implements OnGatewayConnection {
    private readonly verifier;
    private readonly db;
    private readonly server;
    constructor(verifier: SessionVerifier, db: Db);
    handleConnection(client: Socket): Promise<void>;
    subscribe(client: Socket, body: unknown): Promise<Ack>;
    unsubscribe(client: Socket, body: unknown): Promise<Ack>;
    toErrand(errandId: string, event: string, payload: unknown): void;
    toUser(userId: string, app: AppName, event: string, payload: unknown): void;
    /** An agent who left an errand stops receiving its updates straight away. */
    removeFromErrand(userId: string, app: AppName, errandId: string): void;
    /** Drops sockets whose session just ended (logout, or "sign out other phones"). */
    disconnectWhere(match: (auth: AuthContext) => boolean): void;
}
export {};
