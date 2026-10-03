import 'reflect-metadata';
import { VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '@revenue-os/config';
import type { Logger } from '@revenue-os/shared/server';
import { AppModule } from './app.module.js';
import { NestLoggerAdapter } from './common/nest-logger.js';
import { requestContextMiddleware } from './common/request-context.middleware.js';
import { LOGGER } from './infra/tokens.js';

async function bootstrap() {
  const config = loadConfig(); // fails fast with a readable message if .env is wrong
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = app.get<Logger>(LOGGER);

  app.useLogger(new NestLoggerAdapter(logger));
  app.use(requestContextMiddleware(logger));
  app.setGlobalPrefix('api');
  // Business endpoints live under /api/v1/… ; infrastructure endpoints (health) are version-neutral.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();

  await app.listen(config.API_PORT);
  logger.info({ url: `${config.API_URL}/api`, env: config.APP_ENV }, 'API started');
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
