import { VersioningType, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Logger } from '@revenue-os/shared/server';
import { NestLoggerAdapter } from './common/nest-logger.js';
import { requestContextMiddleware } from './common/request-context.middleware.js';
import { LOGGER } from './infra/tokens.js';

/** HTTP setup shared by main.ts and the end-to-end tests, so tests exercise the real pipeline. */
export function configureApp(app: INestApplication): Logger {
  const logger = app.get<Logger>(LOGGER);
  app.useLogger(new NestLoggerAdapter(logger));
  // The web app proxies /api/* from localhost; trust X-Forwarded-For only from loopback so per-IP rate limits
  // see the real client address and a remote client can't spoof it.
  (app as NestExpressApplication).set('trust proxy', 'loopback');
  app.use(requestContextMiddleware(logger));
  app.setGlobalPrefix('api');
  // Business endpoints live under /api/v1/… ; infrastructure endpoints (health) are version-neutral.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  return logger;
}
