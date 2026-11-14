import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { APP_CONFIG, type AppConfig } from './config/app-config';
import { adminPortOnly } from './common/admin-port';
import { ApiExceptionFilter } from './common/errors';
import { allowedOrigins } from './common/origins';
import { securityHeaders } from './common/security-headers';
import { ConfiguredIoAdapter } from './realtime/io-adapter';

/** The only API version (docs/security-plan.md, S8): there are no older ones left running. */
export const API_PREFIX = 'v1';
/** Routes outside the version: the load balancer's check, and how to report a security problem. */
export const UNPREFIXED = ['health', '.well-known/security.txt', 'security'] as const;

/** Shared by main.ts and the tests, so the tests run the app exactly as production does. */
export function configureApp(app: INestApplication) {
  const config = app.get<AppConfig>(APP_CONFIG);
  const express = app as NestExpressApplication;
  express.set('trust proxy', config.TRUST_PROXY_HOPS ?? 0);
  express.disable('x-powered-by');
  express.use(securityHeaders(config.NODE_ENV === 'production'));
  // The admin API on its own port, the rest on the public one (docs/security-plan.md, D1).
  if (config.ADMIN_API_PORT) express.use(adminPortOnly(config.ADMIN_API_PORT, API_PREFIX));
  // Development storage receives photo uploads as raw bytes, like S3 would.
  if (config.STORAGE_PROVIDER === 'memory') {
    express.useBodyParser('raw', { type: ['image/*', 'application/octet-stream'], limit: '10mb' });
  }
  app.setGlobalPrefix(API_PREFIX, { exclude: [...UNPREFIXED] });
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({ origin: allowedOrigins(config.CORS_ORIGINS) });
  app.useWebSocketAdapter(new ConfiguredIoAdapter(app, config));
  app.enableShutdownHooks();
  return app;
}
