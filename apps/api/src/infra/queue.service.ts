import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { AppConfig } from '@revenue-os/config';
import { QUEUES, queuePrefix, type QueueName } from '@revenue-os/shared';
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { APP_CONFIG } from './tokens.js';

/** Lazily creates BullMQ producers. The API only enqueues — workers do the processing. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly queues = new Map<QueueName, Queue>();
  private readonly events = new Map<QueueName, QueueEvents>();
  private readonly redisUrl: string;
  /** Environment-scoped Redis key prefix — must match the worker's (docs/11 §110-113). */
  readonly prefix: string;
  // BullMQ in native ESM needs ready-made ioredis clients. Producers share one; each QueueEvents
  // gets its own because it holds a blocking connection.
  private readonly connection: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.redisUrl = config.REDIS_URL;
    this.prefix = queuePrefix(config.APP_ENV);
    this.connection = new Redis(this.redisUrl, { maxRetriesPerRequest: 1 });
    this.connection.on('error', () => undefined); // surfaced through /api/health instead of crashing
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

  queueEvents(name: QueueName): QueueEvents {
    let events = this.events.get(name);
    if (!events) {
      const connection = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
      connection.on('error', () => undefined);
      events = new QueueEvents(name, { connection, prefix: this.prefix });
      events.on('error', () => undefined);
      this.events.set(name, events);
    }
    return events;
  }

  /** Shared non-blocking Redis client, also used for short-lived counters (e.g. login rate limits). */
  get redis(): Redis {
    return this.connection;
  }

  get maintenance(): Queue {
    return this.queue(QUEUES.maintenance);
  }

  async onModuleDestroy() {
    await Promise.all([...this.events.values()].map((e) => e.close()));
    await Promise.all([...this.queues.values()].map((q) => q.close()));
    this.connection.disconnect();
  }
}
