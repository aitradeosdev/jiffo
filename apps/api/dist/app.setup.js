"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.configureApp = configureApp;
const app_config_1 = require("./config/app-config");
const errors_1 = require("./common/errors");
/** Shared by main.ts and the tests, so the tests run the app exactly as production does. */
function configureApp(app) {
    const config = app.get(app_config_1.APP_CONFIG);
    const express = app;
    express.set('trust proxy', config.TRUST_PROXY_HOPS);
    express.disable('x-powered-by');
    app.setGlobalPrefix('v1', { exclude: ['health'] });
    app.useGlobalFilters(new errors_1.ApiExceptionFilter());
    app.enableCors({
        origin: config.CORS_ORIGINS === '*' ? true : config.CORS_ORIGINS.split(',').map((o) => o.trim()),
    });
    app.enableShutdownHooks();
    return app;
}
//# sourceMappingURL=app.setup.js.map