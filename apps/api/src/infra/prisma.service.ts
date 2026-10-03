import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { AppConfig } from '@revenue-os/config';
import { createPrismaClient, type PrismaClient } from '@revenue-os/database';
import { APP_CONFIG } from './tokens.js';

/** Single Prisma client for the API process. Only application services use it — never controllers. */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = createPrismaClient(config.DATABASE_URL);
  }

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
