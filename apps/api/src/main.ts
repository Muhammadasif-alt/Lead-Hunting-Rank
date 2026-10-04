import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { loadConfig } from '@revenue-os/config';
import { AppModule } from './app.module.js';
import { configureApp } from './app-setup.js';

async function bootstrap() {
  const config = loadConfig(); // fails fast with a readable message if .env is wrong
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const logger = configureApp(app);
  app.enableShutdownHooks();

  await app.listen(config.API_PORT);
  logger.info({ url: `${config.API_URL}/api`, env: config.APP_ENV }, 'API started');
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
