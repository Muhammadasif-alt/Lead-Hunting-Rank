import type { FactoryProvider } from '@nestjs/common';
import { googleOAuthConfig, type AppConfig } from '@revenue-os/config';
import { createProviderRuntime, type ProviderRuntime } from '@revenue-os/providers/runtime';
import type { Logger } from '@revenue-os/shared/server';
import { PrismaService } from '../../infra/prisma.service.js';
import { QueueService } from '../../infra/queue.service.js';
import { APP_CONFIG, LOGGER } from '../../infra/tokens.js';

export const PROVIDER_RUNTIME = Symbol('PROVIDER_RUNTIME');

/** The API's Provider Gateway — same wiring as the worker's, sharing limits and the fake mailbox through Redis. */
export const providerRuntimeProvider: FactoryProvider<ProviderRuntime> = {
  provide: PROVIDER_RUNTIME,
  inject: [PrismaService, QueueService, APP_CONFIG, LOGGER],
  useFactory: (prisma: PrismaService, queues: QueueService, config: AppConfig, logger: Logger) =>
    createProviderRuntime(prisma.client, {
      appEnv: config.APP_ENV,
      storagePath: config.STORAGE_LOCAL_PATH,
      redis: queues.redis,
      prefix: queues.prefix,
      llm: { provider: config.LLM_PROVIDER, apiKey: config.LLM_API_KEY },
      credentials: { db: prisma.client, encryptionKey: config.ENCRYPTION_KEY, google: googleOAuthConfig(config) ?? undefined },
      logger: { warn: (obj, msg) => logger.warn(obj, msg) },
    }),
};
