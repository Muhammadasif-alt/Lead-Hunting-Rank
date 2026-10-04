import type { PrismaClient } from '@revenue-os/database';
import { describeError, type JobName, type QueueName } from '@revenue-os/shared';
import { backoffDelay, OUTBOX_BACKOFF } from './backoff.js';
import { eventDefinition, type DispatchedEvent } from './registry.js';

export interface PublishJob {
  queue: QueueName;
  name: JobName;
  /** Deterministic (outbox id + consumer): BullMQ ignores a duplicate add while the job exists. */
  jobId: string;
  priority: number;
  data: Record<string, unknown>;
}

/** Enqueues jobs (BullMQ in production, an array in tests). Must throw if any job could not be added. */
export type Publisher = (jobs: PublishJob[]) => Promise<void>;

export interface DispatchResult {
  claimed: number;
  published: number;
  retrying: number;
  dead: number;
}

export interface DispatchOptions {
  batchSize?: number;
  /** After this many failed publish attempts an outbox row is DEAD (visible on the diagnostics screen). */
  maxAttempts?: number;
}

/**
 * Outbox dispatcher (docs/07 §6, docs/11 §11-14): claim a batch of due PENDING rows with
 * FOR UPDATE SKIP LOCKED (so several dispatchers never take the same row), publish each row's consumer jobs,
 * mark it PUBLISHED. If publishing fails the row stays PENDING with a backoff; if the process crashes after
 * publishing but before commit, the row is published again — consumers are idempotent (at-least-once, §7).
 */
export async function dispatchOutboxBatch(db: PrismaClient, publish: Publisher, options: DispatchOptions = {}): Promise<DispatchResult> {
  const batchSize = options.batchSize ?? 50;
  const maxAttempts = options.maxAttempts ?? 20;
  const result: DispatchResult = { claimed: 0, published: 0, retrying: 0, dead: 0 };

  await db.$transaction(
    async (tx) => {
      const claimed = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "OutboxEvent"
        WHERE status = 'PENDING' AND "availableAt" <= now()
        ORDER BY "availableAt", "createdAt"
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED`;
      result.claimed = claimed.length;
      if (claimed.length === 0) return;

      const rows = await tx.outboxEvent.findMany({ where: { id: { in: claimed.map((r) => r.id) } }, orderBy: { createdAt: 'asc' } });
      for (const row of rows) {
        const event: DispatchedEvent = {
          outboxId: row.id,
          domainEventId: row.domainEventId,
          eventType: row.eventType,
          eventVersion: row.eventVersion,
          workspaceId: row.workspaceId,
          aggregateType: row.aggregateType,
          aggregateId: row.aggregateId,
          payload: (row.payload ?? {}) as Record<string, unknown>,
          correlationId: row.correlationId,
        };
        const definition = eventDefinition(row.eventType);
        if (!definition || definition.version !== row.eventVersion) {
          // Unknown type/version can't be routed safely — park it instead of guessing.
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: { status: 'DEAD', attemptCount: { increment: 1 }, lastError: `No registry entry for ${row.eventType} v${row.eventVersion}` },
          });
          result.dead++;
          continue;
        }

        try {
          const jobs = definition.routes.map(
            (route): PublishJob => ({
              queue: route.queue,
              name: route.job,
              jobId: `${row.id}.${route.consumer}`,
              priority: route.priority,
              data: {
                ...route.toJobData(event),
                workspaceId: row.workspaceId ?? undefined,
                correlationId: row.correlationId ?? row.id,
                causationId: row.domainEventId ?? row.id,
              },
            }),
          );
          if (jobs.length > 0) await publish(jobs);
          await tx.outboxEvent.update({ where: { id: row.id }, data: { status: 'PUBLISHED', publishedAt: new Date(), lastError: null } });
          result.published++;
        } catch (err) {
          const attempt = row.attemptCount + 1;
          const dead = attempt >= maxAttempts;
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: {
              status: dead ? 'DEAD' : 'PENDING',
              attemptCount: attempt,
              availableAt: new Date(Date.now() + backoffDelay(attempt, OUTBOX_BACKOFF)),
              lastError: describeError(err).slice(0, 1000),
            },
          });
          if (dead) result.dead++;
          else result.retrying++;
        }
      }
    },
    { timeout: 30_000 },
  );
  return result;
}
