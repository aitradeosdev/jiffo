/** Applies every pending migration in apps/api/drizzle, in order. */
export declare function runMigrations(databaseUrl: string): Promise<void>;
