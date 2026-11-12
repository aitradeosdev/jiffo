import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema';
export declare const DB: unique symbol;
export declare const PG_POOL: unique symbol;
export type Db = NodePgDatabase<typeof schema>;
/** A database handle that may be the root connection or an open transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;
export declare class DatabaseModule {
}
