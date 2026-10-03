import { hostname } from 'node:os';
import { loadConfig } from '@revenue-os/config';
import {
  describeError,
  JOBS,
  QUEUES,
  type DiagnosticsPingData,
  type DiagnosticsPingResult,
} from '@revenue-os/shared';
import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

const config = loadConfig();
const workerId = `${hostname()}:${process.pid}`;
// Workers block on Redis, so BullMQ requires maxRetriesPerRequest: null.
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });

// One BullMQ Worker per queue family. Phase 0 only processes `maintenance`; discovery/research/… are added per phase.
const maintenance = new Worker<DiagnosticsPingData, DiagnosticsPingResult>(
  QUEUES.maintenance,
  async (job: Job<DiagnosticsPingData>) => {
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
  },
  { connection },
);

maintenance.on('ready', () => console.log(`[worker ${workerId}] listening on queue "${QUEUES.maintenance}"`));
maintenance.on('failed', (job, err) => console.error(`[worker] job ${job?.id} (${job?.name}) failed:`, err.message));
// Redis reconnects every few seconds while down — log each distinct error once, not on every retry.
let lastError = '';
maintenance.on('error', (err) => {
  const message = describeError(err);
  if (message !== lastError) console.error('[worker] connection error:', message);
  lastError = message;
});
maintenance.on('ready', () => (lastError = ''));

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, closing…`);
  await maintenance.close();
  connection.disconnect();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
