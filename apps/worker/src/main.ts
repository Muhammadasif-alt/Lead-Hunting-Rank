import { hostname } from 'node:os';
import { loadConfig } from '@revenue-os/config';
import {
  describeError,
  JOBS,
  QUEUES,
  type DiagnosticsPingData,
  type DiagnosticsPingResult,
} from '@revenue-os/shared';
import { createLogger } from '@revenue-os/shared/server';
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { withJobContext } from './job-runner.js';

const config = loadConfig();
const logger = createLogger({ service: 'worker', level: config.LOG_LEVEL, pretty: config.LOG_PRETTY });
const workerId = `${hostname()}:${process.pid}`;
// Workers block on Redis, so BullMQ requires maxRetriesPerRequest: null.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

// One BullMQ Worker per queue family. Phase 0 only processes `maintenance`; discovery/research/… are added per phase.
const maintenance = new Worker<DiagnosticsPingData, DiagnosticsPingResult>(
  QUEUES.maintenance,
  withJobContext(logger, async (job) => {
    switch (job.name) {
      case JOBS.diagnosticsPing:
        return {
          workerId,
          processedAt: new Date().toISOString(),
          correlationId: job.data.correlationId,
        };
      default:
        throw new Error(`Unknown maintenance job: ${job.name}`);
    }
  }),
  { connection },
);

// Redis reconnects every few seconds while down — log each distinct error once, not on every retry.
let lastError = '';
maintenance.on('ready', () => {
  lastError = '';
  logger.info({ workerId, queue: QUEUES.maintenance }, 'worker listening');
});
maintenance.on('error', (err) => {
  const message = describeError(err);
  if (message !== lastError) logger.error({ error: message }, 'worker connection error');
  lastError = message;
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'worker shutting down');
  await maintenance.close();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
