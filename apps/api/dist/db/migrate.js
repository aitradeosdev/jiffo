"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runMigrations = runMigrations;
const node_path_1 = require("node:path");
const node_postgres_1 = require("drizzle-orm/node-postgres");
const migrator_1 = require("drizzle-orm/node-postgres/migrator");
const pg_1 = require("pg");
/** Applies every pending migration in apps/api/drizzle, in order. */
async function runMigrations(databaseUrl) {
    const pool = new pg_1.Pool({ connectionString: databaseUrl, max: 1 });
    try {
        await (0, migrator_1.migrate)((0, node_postgres_1.drizzle)(pool), { migrationsFolder: (0, node_path_1.join)(__dirname, '..', '..', 'drizzle') });
    }
    finally {
        await pool.end();
    }
}
//# sourceMappingURL=migrate.js.map