import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from './schema';

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');
export type Db = NodePgDatabase<typeof schema>;
/** A database handle that may be the root connection or an open transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;
