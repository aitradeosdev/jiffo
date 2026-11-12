"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("reflect-metadata");
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const app_setup_1 = require("./app.setup");
const app_config_1 = require("./config/app-config");
const migrate_1 = require("./db/migrate");
async function bootstrap() {
    const config = (0, app_config_1.loadConfig)();
    if (config.RUN_MIGRATIONS)
        await (0, migrate_1.runMigrations)(config.DATABASE_URL);
    const app = (0, app_setup_1.configureApp)(await core_1.NestFactory.create(app_module_1.AppModule, { bufferLogs: false }));
    await app.listen(config.PORT);
}
bootstrap().catch((error) => {
    console.error(error);
    process.exit(1);
});
//# sourceMappingURL=main.js.map