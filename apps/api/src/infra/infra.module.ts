import { Global, Module } from '@nestjs/common';
import { loadConfig, type AppConfig } from '@revenue-os/config';
import { createLogger } from '@revenue-os/shared/server';
import { APP_CONFIG, LOGGER } from './tokens.js';
import { PrismaService } from './prisma.service.js';
import { QueueService } from './queue.service.js';

/** Shared infrastructure (config, logger, database, queues) available to every module. */
@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    {
      provide: LOGGER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        createLogger({ service: 'api', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY }),
    },
    PrismaService,
    QueueService,
  ],
  exports: [APP_CONFIG, LOGGER, PrismaService, QueueService],
})
export class InfraModule {}
