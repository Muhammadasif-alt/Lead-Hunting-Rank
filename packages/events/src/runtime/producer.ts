import type { QueueName } from '@revenue-os/shared';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { PublishJob, Publisher } from '../dispatcher.js';

/** Retention: Redis keeps a little history for debugging; Postgres (events, actions, DLQ) is the record. */
export const JOB_RETENTION = { removeOnComplete: { count: 1000, age: 24 * 3600 }, removeOnFail: { count: 5000, age: 7 * 24 * 3600 } };
export const DEFAULT_ATTEMPTS = 6;

/**
 * BullMQ producer for the outbox dispatcher and admin retries. Its Redis client fails fast instead of buffering
 * commands while Redis is down — the dispatcher must see the failure and keep the outbox row PENDING.
 */
export class QueueProducer {
  private readonly queues = new Map<QueueName, Queue>();
  readonly connection: Redis;

  constructor(
    redisUrl: string,
    readonly prefix: string,
  ) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
    this.connection.on('error', () => undefined); // reported through health checks and dispatch results
  }

  queue(name: QueueName): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.connection, prefix: this.prefix });
      queue.on('error', () => undefined);
      this.queues.set(name, queue);
    }
    return queue;
  }

  readonly publish: Publisher = async (jobs: PublishJob[]) => {
    for (const job of jobs) {
      await this.queue(job.queue).add(job.name, job.data, {
        jobId: job.jobId,
        priority: job.priority,
        attempts: DEFAULT_ATTEMPTS,
        backoff: { type: 'custom' },
        ...JOB_RETENTION,
      });
    }
  };

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.connection.disconnect();
  }
}
