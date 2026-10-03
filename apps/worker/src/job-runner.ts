import type { Job } from 'bullmq';
import type { JobTracing } from '@revenue-os/shared';
import { describeError } from '@revenue-os/shared';
import { newId, runWithContext, type Logger } from '@revenue-os/shared/server';

/**
 * Wraps a job handler so it runs inside the job's execution context (correlationId from the payload,
 * jobId/jobType) and logs start/finish with duration and attempt (Tech Spec #7 §110-113).
 * Payload contents are never logged — only IDs.
 */
export function withJobContext<D extends Partial<JobTracing>, R>(
  logger: Logger,
  handler: (job: Job<D>) => Promise<R>,
) {
  return (job: Job<D>): Promise<R> =>
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
        logger.debug({ attempt }, `job ${job.name} started`);
        try {
          const result = await handler(job);
          logger.info(
            { attempt, durationMs: Math.round(performance.now() - start), result: 'succeeded' },
            `job ${job.name} succeeded`,
          );
          return result;
        } catch (err) {
          logger.error(
            {
              attempt,
              durationMs: Math.round(performance.now() - start),
              result: 'failed',
              error: describeError(err),
            },
            `job ${job.name} failed`,
          );
          throw err;
        }
      },
    );
}
