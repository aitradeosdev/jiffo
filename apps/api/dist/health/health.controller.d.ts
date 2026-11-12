import { type Db } from '../db/database.module';
export declare class HealthController {
    private readonly db;
    constructor(db: Db);
    /** For the load balancer: 200 when the API can reach its database. */
    check(): Promise<{
        status: string;
    }>;
}
