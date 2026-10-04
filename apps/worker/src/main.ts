import { hostname } from 'node:os';
import { loadConfig } from '@revenue-os/config';
import { createPrismaClient } from '@revenue-os/database';
import type { ActionExecutor } from '@revenue-os/events';
import {
  createQueueWorker,
  externalActionHandlers,
  QueueProducer,
  startHeartbeat,
  startOutboxLoop,
  WorkerMetrics,
  type JobHandler,
} from '@revenue-os/events/runtime';
import { FAKE_SEND_ACTION, FakeSideEffectProvider, RedisFakeProviderStore } from '@revenue-os/events/testing';
import { createEmailSendExecutor, EMAIL_SEND_ACTION } from '@revenue-os/providers';
import { checkAllIntegrations, createProviderRuntime } from '@revenue-os/providers/runtime';
import { describeError, JOBS, QUEUES, queuePrefix, type DiagnosticsPingResult } from '@revenue-os/shared';
import { createLogger } from '@revenue-os/shared/server';
import { Redis } from 'ioredis';

const config = loadConfig();
const logger = createLogger({ service: 'worker', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });
const workerId = `${hostname()}:${process.pid}`;
const prefix = queuePrefix(config.APP_ENV);

const db = createPrismaClient(config.DATABASE_URL);
// Workers block on Redis, so BullMQ requires maxRetriesPerRequest: null.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', () => undefined); // logged once per distinct error by the workers below
const producer = new QueueProducer(config.REDIS_URL, prefix);
const metrics = new WorkerMetrics();

// Provider Gateway (Phase 5): every provider call goes through it — routing, limits, circuit breaker, usage, health.
const providers = createProviderRuntime(db, {
  appEnv: config.APP_ENV,
  storagePath: config.STORAGE_LOCAL_PATH,
  redis: connection,
  prefix,
  logger: { warn: (obj, msg) => logger.warn(obj, msg) },
});

// Side-effect adapters by action type. Each one calls its capability through the gateway, never a vendor directly.
// The diagnostics fake backs the pipeline self-test and never runs in production.
const executors: Record<string, ActionExecutor> = {
  [EMAIL_SEND_ACTION]: createEmailSendExecutor(providers.gateway),
};
if (config.APP_ENV !== 'production') {
  executors[FAKE_SEND_ACTION] = new FakeSideEffectProvider(new RedisFakeProviderStore(connection, prefix), 150);
}
const actions = externalActionHandlers(db, { executors });

const providerHealthCheck: JobHandler = {
  timeoutMs: 120_000,
  handle: async () => ({ checked: await checkAllIntegrations(db, providers) }),
};

const ping: JobHandler = {
  timeoutMs: 5_000,
  handle: async (data): Promise<DiagnosticsPingResult> => ({
    workerId,
    processedAt: new Date().toISOString(),
    correlationId: data.correlationId,
  }),
};

// One BullMQ Worker per queue family; more queues are added as their phases land (docs/11 §55-57).
const workers = [
  createQueueWorker({
    queue: QUEUES.maintenance,
    prefix,
    connection,
    db,
    logger,
    metrics,
    handlers: {
      [JOBS.diagnosticsPing]: ping,
      [JOBS.externalActionReconcile]: actions[JOBS.externalActionReconcile],
      [JOBS.providerHealthCheck]: providerHealthCheck,
    },
  }),
  createQueueWorker({
    queue: QUEUES.outbound,
    prefix,
    connection,
    db,
    logger,
    metrics,
    concurrency: 2,
    handlers: { [JOBS.externalActionExecute]: actions[JOBS.externalActionExecute] },
  }),
];

// Redis reconnects every few seconds while down — log each distinct error once, not on every retry.
for (const worker of workers) {
  let lastError = '';
  worker.on('ready', () => {
    lastError = '';
    logger.info({ workerId, queue: worker.name }, 'worker listening');
  });
  worker.on('error', (err) => {
    const message = describeError(err);
    if (message !== lastError) logger.error({ queue: worker.name, error: message }, 'worker connection error');
    lastError = message;
  });
}

const outbox = startOutboxLoop(db, producer.publish, logger);
const heartbeat = startHeartbeat(connection, prefix, { workerId, queues: workers.map((w) => w.name) }, metrics);

// Crash-recovery sweep for external actions whose worker died mid-call. Idempotent; one schedule per environment.
producer
  .queue(QUEUES.maintenance)
  .upsertJobScheduler('external-action-reconcile', { every: 60_000 }, { name: JOBS.externalActionReconcile, data: { correlationId: 'scheduler' } })
  .catch((err) => logger.warn({ error: describeError(err) }, 'could not register reconcile schedule'));
producer
  .queue(QUEUES.maintenance)
  .upsertJobScheduler('provider-health-check', { every: 5 * 60_000 }, { name: JOBS.providerHealthCheck, data: { correlationId: 'scheduler' } })
  .catch((err) => logger.warn({ error: describeError(err) }, 'could not register provider health schedule'));

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down');
  // Stop claiming new work first, let in-flight jobs finish, then release connections (docs/11 §104).
  await outbox.stop();
  await Promise.all(workers.map((w) => w.close()));
  await heartbeat.stop();
  await producer.close();
  connection.disconnect();
  await db.$disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
