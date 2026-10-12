import type { PrismaClient } from '@revenue-os/database';
import type { ServiceContext } from '@revenue-os/domain';
import type { ProviderGateway } from '@revenue-os/providers';

/** What the Business Brain services need: the database, the Provider Gateway (embeddings, storage) and a clock. */
export interface BrainDeps {
  db: PrismaClient;
  providers: ProviderGateway;
  now?: () => Date;
}

export const TX = { timeout: 30_000, maxWait: 10_000 } as const;
export const DAY = 86_400_000;
export const systemCtx = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'SYSTEM', id: null } });
export const nowOf = (deps: { now?: () => Date }) => deps.now?.() ?? new Date();
