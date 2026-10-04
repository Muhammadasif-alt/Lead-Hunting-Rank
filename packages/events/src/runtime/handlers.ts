import type { PrismaClient } from '@revenue-os/database';
import { JOBS, PermanentError, type ExternalActionJobData } from '@revenue-os/shared';
import { executeExternalAction, expireStaleClaims, type ActionExecutor, type Revalidator } from '../external-action.js';
import type { JobHandler } from './queue-worker.js';

/** A worker that died mid-call leaves its action EXECUTING; after this long the sweep reconciles it. */
export const STALE_CLAIM_MS = 5 * 60_000;
const PROVIDER_TIMEOUT_MS = 30_000;

/** Job handlers for external actions: execution (outbound queue) and the crash-recovery sweep (maintenance queue). */
export function externalActionHandlers(db: PrismaClient, deps: { executors: Record<string, ActionExecutor>; revalidate?: Revalidator }) {
  const execute: JobHandler = {
    timeoutMs: PROVIDER_TIMEOUT_MS + 15_000,
    handle: async (data, ctx) => {
      const job = data as Partial<ExternalActionJobData>;
      if (job.schemaVersion !== 1 || typeof job.externalActionId !== 'string' || typeof job.workspaceId !== 'string') {
        throw new PermanentError(`Unsupported ${JOBS.externalActionExecute} payload (schemaVersion ${String(job.schemaVersion)})`);
      }
      const outcome = await executeExternalAction(
        db,
        { workspaceId: job.workspaceId, externalActionId: job.externalActionId },
        { ...deps, timeoutMs: PROVIDER_TIMEOUT_MS, finalAttempt: ctx.finalAttempt },
      );
      return { outcome };
    },
  };

  const reconcileSweep: JobHandler = {
    timeoutMs: 60_000,
    handle: async () => ({ expired: await expireStaleClaims(db, STALE_CLAIM_MS) }),
  };

  return { [JOBS.externalActionExecute]: execute, [JOBS.externalActionReconcile]: reconcileSweep };
}
