import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  describeError,
  JOBS,
  QUEUES,
  type ComponentHealth,
  type DiagnosticsPingData,
  type DiagnosticsPingResult,
  type SystemHealth,
} from '@revenue-os/shared';
import { PrismaService } from '../infra/prisma.service.js';
import { QueueService } from '../infra/queue.service.js';

const WORKER_TIMEOUT_MS = 5_000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: QueueService,
  ) {}

  async check(): Promise<SystemHealth> {
    const [postgres, redis, worker] = await Promise.all([
      timed(() => this.prisma.client.$queryRaw`SELECT 1`),
      timed(() => this.queues.maintenance.getVersion()),
      timed(() => this.pingWorker()),
    ]);
    const components = { api: { status: 'up' as const }, postgres, redis, worker };
    const allUp = Object.values(components).every((c) => c.status === 'up');
    return { status: allUp ? 'up' : 'down', checkedAt: new Date().toISOString(), components };
  }

  /** Enqueues a ping job and waits for a worker to finish it — proves the full queue round trip. */
  private async pingWorker(): Promise<DiagnosticsPingResult> {
    const data: DiagnosticsPingData = {
      requestedAt: new Date().toISOString(),
      correlationId: randomUUID(),
    };
    const job = await this.queues.maintenance.add(JOBS.diagnosticsPing, data, {
      removeOnComplete: 100,
      removeOnFail: 100,
    });
    try {
      return await job.waitUntilFinished(
        this.queues.queueEvents(QUEUES.maintenance),
        WORKER_TIMEOUT_MS,
      );
    } catch (err) {
      // Don't leave an orphaned ping for a worker that starts later.
      await job.remove().catch(() => undefined);
      throw new Error(`No worker answered within ${WORKER_TIMEOUT_MS / 1000}s — is it running?`, {
        cause: err,
      });
    }
  }
}

const CHECK_TIMEOUT_MS = WORKER_TIMEOUT_MS + 1_000;

async function timed(fn: () => Promise<unknown>): Promise<ComponentHealth> {
  const start = performance.now();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out — service unreachable')), CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([fn(), timeout]);
    return { status: 'up', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { status: 'down', error: describeError(err) };
  } finally {
    clearTimeout(timer);
  }
}
