"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_config_1 = require("../config/app-config");
const migrate_1 = require("./migrate");
(0, migrate_1.runMigrations)((0, app_config_1.loadConfig)().DATABASE_URL)
    .then(() => process.stdout.write('Migrations applied\n'))
    .catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=migrate-cli.js.map