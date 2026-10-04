import type { Redis } from 'ioredis';

export interface JobTypeMetrics {
  succeeded: number;
  retried: number;
  deadLettered: number;
  blocked: number;
  totalMs: number;
  lastError?: string;
  lastFinishedAt?: string;
}

/** In-process counters per job type, published with the worker heartbeat (docs/11 §93-96). */
export class WorkerMetrics {
  private readonly byJob = new Map<string, JobTypeMetrics>();

  record(jobName: string, outcome: 'succeeded' | 'retried' | 'deadLettered' | 'blocked', durationMs: number, error?: string): void {
    const m = this.byJob.get(jobName) ?? { succeeded: 0, retried: 0, deadLettered: 0, blocked: 0, totalMs: 0 };
    m[outcome]++;
    m.totalMs += durationMs;
    m.lastFinishedAt = new Date().toISOString();
    if (error) m.lastError = error;
    this.byJob.set(jobName, m);
  }

  snapshot(): Record<string, JobTypeMetrics> {
    return Object.fromEntries(this.byJob);
  }
}

export interface WorkerHeartbeat {
  workerId: string;
  queues: string[];
  startedAt: string;
  lastHeartbeatAt: string;
  metrics: Record<string, JobTypeMetrics>;
}

const HEARTBEAT_TTL_S = 30;
const key = (prefix: string, workerId: string) => `${prefix}:workers:${workerId}`;

/** Writes a short-lived heartbeat key every 10 s; a crashed worker's key simply expires. */
export function startHeartbeat(redis: Redis, prefix: string, info: { workerId: string; queues: string[] }, metrics: WorkerMetrics) {
  const startedAt = new Date().toISOString();
  const beat = () => {
    const hb: WorkerHeartbeat = { ...info, startedAt, lastHeartbeatAt: new Date().toISOString(), metrics: metrics.snapshot() };
    redis.set(key(prefix, info.workerId), JSON.stringify(hb), 'EX', HEARTBEAT_TTL_S).catch(() => undefined);
  };
  beat();
  const timer = setInterval(beat, 10_000);
  return {
    async stop() {
      clearInterval(timer);
      await redis.del(key(prefix, info.workerId)).catch(() => undefined);
    },
  };
}

export async function readHeartbeats(redis: Redis, prefix: string): Promise<WorkerHeartbeat[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', key(prefix, '*'), 'COUNT', 100);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  if (keys.length === 0) return [];
  const values = await redis.mget(...keys);
  return values.flatMap((v) => (v ? [JSON.parse(v) as WorkerHeartbeat] : []));
}
