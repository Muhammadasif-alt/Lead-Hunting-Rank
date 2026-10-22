import type { PrismaClient } from '@revenue-os/database';
import type { ServiceContext } from '@revenue-os/domain';

/** What analytics needs: the database and a clock. Analytics never calls a provider and never sends anything. */
export interface AnalyticsDeps {
  db: PrismaClient;
  now?: () => Date;
}

export const TX = { timeout: 60_000, maxWait: 10_000 } as const;
export const DAY = 86_400_000;
export const systemCtx = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'SYSTEM', id: null } });
export const nowOf = (deps: { now?: () => Date }) => deps.now?.() ?? new Date();
export const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;
export const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Web routes a number can drill into (apps/web/src/app/(app)) — no dead-end numbers (screen #10 §50). */
export const HREF = {
  company: (id: string) => `/companies/${id}`,
  opportunity: (id: string) => `/opportunities/${id}`,
  campaign: (id: string) => `/campaigns/${id}`,
  conversation: (id: string) => `/inbox?c=${id}`,
  meeting: (id: string) => `/meetings/${id}`,
  signal: (id: string) => `/signals/${id}`,
  mission: (id: string) => `/lead-hunter/${id}`,
  market: (id: string) => `/analytics?tab=markets&marketId=${id}`,
};
