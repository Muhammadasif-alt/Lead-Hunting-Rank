import { Global, Module } from '@nestjs/common';
import { loadConfig } from '@revenue-os/config';
import { APP_CONFIG } from './tokens.js';
import { PrismaService } from './prisma.service.js';
import { QueueService } from './queue.service.js';

/** Shared infrastructure (config, database, queues) available to every module. */
@Global()
@Module({
  providers: [{ provide: APP_CONFIG, useFactory: loadConfig }, PrismaService, QueueService],
  exports: [APP_CONFIG, PrismaService, QueueService],
})
export class InfraModule {}
