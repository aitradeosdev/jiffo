import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { ApiExceptionFilter } from './common/errors';

/** Shared by main.ts and the tests, so the tests run the app exactly as production does. */
export function configureApp(app: INestApplication) {
  const config = app.get<AppConfig>(APP_CONFIG);
  const express = app as NestExpressApplication;
  express.set('trust proxy', config.TRUST_PROXY_HOPS ?? 0);
  express.disable('x-powered-by');
  // Development storage receives photo uploads as raw bytes, like S3 would.
  if (config.STORAGE_PROVIDER === 'memory') {
    express.useBodyParser('raw', { type: ['image/*', 'application/octet-stream'], limit: '10mb' });
  }
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: config.CORS_ORIGINS === '*' ? true : config.CORS_ORIGINS.split(',').map((o) => o.trim()),
  });
  app.enableShutdownHooks();
  return app;
}
