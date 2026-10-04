import type { PrismaClient } from '@revenue-os/database';
import { classifyFailure, describeError, JobTimeoutError, PermanentError, type JobTracing, type QueueName } from '@revenue-os/shared';
import { newId, runWithContext, type Logger } from '@revenue-os/shared/server';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { backoffDelay } from '../backoff.js';
import { recordDeadLetter, resolveDeadLetter } from '../dead-letter.js';
import type { WorkerMetrics } from './metrics.js';

export interface JobContext {
  attempt: number;
  /** Last attempt before the job is dead-lettered — handlers use it to settle business state (e.g. FAILED). */
  finalAttempt: boolean;
  signal: AbortSignal;
}

export interface JobHandler {
  /** Hard ceiling for one attempt. Exceeding it counts as a retryable failure. */
  timeoutMs: number;
  handle: (data: Record<string, unknown> & JobTracing, ctx: JobContext) => Promise<unknown>;
}

export interface QueueWorkerOptions {
  queue: QueueName;
  prefix: string;
  connection: Redis;
  db: PrismaClient;
  logger: Logger;
  metrics: WorkerMetrics;
  handlers: Record<string, JobHandler>;
  concurrency?: number;
}

/**
 * The shared worker wrapper (docs/13 Phase 4, docs/11 §35-47, §110). Every job gets:
 * - its workflow's correlation/causation IDs in the logging context;
 * - a time budget;
 * - failure classification: permanent failures stop immediately, transient ones back off with jitter
 *   (or honour a provider's Retry-After);
 * - a Postgres dead-letter record when it will not be retried again;
 * - metrics, published with the worker heartbeat.
 * Payload contents are never logged — only IDs.
 */
export function createQueueWorker(options: QueueWorkerOptions): Worker {
  const { db, logger, metrics, handlers } = options;

  const processor = (job: Job<Record<string, unknown> & JobTracing>) =>
    runWithContext(
      {
        correlationId: job.data.correlationId ?? newId(),
        causationId: job.data.causationId,
        workspaceId: job.data.workspaceId,
        jobId: job.id,
        jobType: job.name,
        actorType: 'system',
      },
      async () => {
        const start = performance.now();
        const attempt = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts ?? 1;
        const elapsed = () => Math.round(performance.now() - start);
        try {
          const handler = handlers[job.name];
          if (!handler) throw new PermanentError(`No handler for job ${job.name} on queue ${options.queue}`);
          const result = await withTimeout(handler, job.data, { attempt, finalAttempt: attempt >= maxAttempts });
          metrics.record(job.name, 'succeeded', elapsed());
          if (typeof job.data.deadLetterId === 'string') await resolveDeadLetter(db, job.data.deadLetterId);
          logger.info({ attempt, durationMs: elapsed(), result: 'succeeded' }, `job ${job.name} succeeded`);
          return result;
        } catch (err) {
          const failure = classifyFailure(err);
          const error = describeError(err);
          const durationMs = elapsed();

          if (failure.category === 'POLICY') {
            // A policy "no" is a business outcome, not a technical failure: complete the job, no DLQ (docs/11 §42).
            metrics.record(job.name, 'blocked', durationMs, error);
            logger.warn({ attempt, durationMs, result: 'blocked', error }, `job ${job.name} blocked by policy`);
            return { blocked: error };
          }

          const final = !failure.retryable || attempt >= maxAttempts;
          if (final) {
            metrics.record(job.name, 'deadLettered', durationMs, error);
            try {
              const id = await recordDeadLetter(db, {
                queue: options.queue,
                jobName: job.name,
                jobId: job.id,
                jobData: job.data,
                failureCategory: failure.category,
                lastError: error,
                attempts: attempt,
              });
              logger.error({ attempt, durationMs, result: 'dead-lettered', category: failure.category, error, deadLetterId: id }, `job ${job.name} dead-lettered`);
            } catch (dlqErr) {
              logger.error({ error, dlqError: describeError(dlqErr) }, `job ${job.name} failed and could not be dead-lettered`);
            }
            if (!failure.retryable) throw new UnrecoverableError(error);
            throw err;
          }

          metrics.record(job.name, 'retried', durationMs, error);
          logger.warn({ attempt, maxAttempts, durationMs, result: 'retrying', category: failure.category, error }, `job ${job.name} failed, will retry`);
          throw err;
        }
      },
    );

  return new Worker(options.queue, processor, {
    connection: options.connection,
    prefix: options.prefix,
    concurrency: options.concurrency ?? 5,
    settings: {
      backoffStrategy: (attemptsMade: number, _type?: string, err?: Error) => {
        const retryAfter = (err as { retryAfterMs?: unknown } | undefined)?.retryAfterMs;
        return typeof retryAfter === 'number' && retryAfter > 0 ? retryAfter : backoffDelay(attemptsMade);
      },
    },
  });
}

async function withTimeout(handler: JobHandler, data: Record<string, unknown> & JobTracing, ctx: Omit<JobContext, 'signal'>): Promise<unknown> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new JobTimeoutError(handler.timeoutMs));
    }, handler.timeoutMs);
  });
  try {
    return await Promise.race([handler.handle(data, { ...ctx, signal: controller.signal }), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
