import { type Db } from '../db/database.module';
import { type AppName } from '../db/schema';
import { type PushAdapter, type PushNotification } from '../adapters/push';
export declare class PushService {
    private readonly db;
    private readonly push;
    private readonly logger;
    constructor(db: Db, push: PushAdapter);
    setToken(deviceId: string, token: string | null): Promise<void>;
    /** Sends to every signed-in phone the person has for that app. Push failures never fail the caller. */
    notifyUser(userId: string, app: AppName, notification: PushNotification): Promise<void>;
}
