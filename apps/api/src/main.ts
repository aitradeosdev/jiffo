import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { RedactingLogger } from './common/logger';
import { loadConfig } from './config/app-config';
import { runMigrations } from './db/migrate';

async function bootstrap() {
  const config = loadConfig();
  if (config.RUN_MIGRATIONS) await runMigrations(config.DATABASE_URL);
  const app = configureApp(
    await NestFactory.create(AppModule, {
      rawBody: true,
      logger: new RedactingLogger({ json: config.NODE_ENV === 'production' }),
    }),
  );
  await app.listen(config.PORT);
}

bootstrap().catch((error: unknown) => {
  new RedactingLogger().error(error);
  process.exit(1);
});
