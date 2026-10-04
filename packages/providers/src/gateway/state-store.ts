import type { Redis } from 'ioredis';

/**
 * Shared limiter + circuit-breaker state (docs/12 §84-88). Keys include integration + capability, never just the
 * provider name, so one noisy mailbox doesn't throttle another. In production every worker uses the Redis store,
 * so "10 calls left" is one number, not one per worker.
 */
export interface CircuitSnapshot {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  /** When an OPEN circuit allows a probe again. */
  openUntil: number | null;
}

export interface ProviderStateStore {
  /** Fixed-window rate limit: counts this call and says whether it fits. */
  consume(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; retryAfterMs: number }>;
  circuit(key: string): Promise<CircuitSnapshot>;
  /** In HALF_OPEN only one caller may probe the provider; the rest keep waiting (docs/12 §85, controlled recovery). */
  claimProbe(key: string, ttlMs: number): Promise<boolean>;
  recordFailure(key: string, threshold: number, cooldownMs: number): Promise<CircuitSnapshot>;
  recordSuccess(key: string): Promise<void>;
}

function snapshot(failures: number, openUntil: number | null, now: number): CircuitSnapshot {
  if (openUntil === null) return { state: 'CLOSED', failures, openUntil };
  return { state: openUntil > now ? 'OPEN' : 'HALF_OPEN', failures, openUntil };
}

export class MemoryProviderStateStore implements ProviderStateStore {
  private readonly windows = new Map<string, { window: number; count: number }>();
  private readonly circuits = new Map<string, { failures: number; openUntil: number | null }>();
  private readonly probes = new Map<string, number>();

  constructor(private readonly now: () => number = Date.now) {}

  async consume(key: string, limit: number, windowMs: number) {
    const t = this.now();
    const window = Math.floor(t / windowMs);
    const entry = this.windows.get(key);
    const count = entry?.window === window ? entry.count + 1 : 1;
    this.windows.set(key, { window, count });
    return { allowed: count <= limit, retryAfterMs: count <= limit ? 0 : (window + 1) * windowMs - t };
  }

  async circuit(key: string) {
    const c = this.circuits.get(key);
    return snapshot(c?.failures ?? 0, c?.openUntil ?? null, this.now());
  }

  async claimProbe(key: string, ttlMs: number) {
    const t = this.now();
    if ((this.probes.get(key) ?? 0) > t) return false;
    this.probes.set(key, t + ttlMs);
    return true;
  }

  async recordFailure(key: string, threshold: number, cooldownMs: number) {
    const t = this.now();
    const c = this.circuits.get(key) ?? { failures: 0, openUntil: null };
    c.failures += 1;
    // A failed probe (HALF_OPEN) re-opens immediately; otherwise open after `threshold` consecutive failures.
    if (c.failures >= threshold || (c.openUntil !== null && c.openUntil <= t)) c.openUntil = t + cooldownMs;
    this.circuits.set(key, c);
    this.probes.delete(key);
    return snapshot(c.failures, c.openUntil, t);
  }

  async recordSuccess(key: string) {
    this.circuits.delete(key);
    this.probes.delete(key);
  }
}

export class RedisProviderStateStore implements ProviderStateStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  private k(kind: string, key: string) {
    return `${this.prefix}:provider:${kind}:${key}`;
  }

  async consume(key: string, limit: number, windowMs: number) {
    const t = Date.now();
    const window = Math.floor(t / windowMs);
    const redisKey = this.k('rl', `${key}:${window}`);
    const [[, count]] = (await this.redis.multi().incr(redisKey).pexpire(redisKey, windowMs).exec()) as [[null, number], unknown];
    return { allowed: count <= limit, retryAfterMs: count <= limit ? 0 : (window + 1) * windowMs - t };
  }

  async circuit(key: string) {
    const raw = await this.redis.hgetall(this.k('circuit', key));
    return snapshot(Number(raw.failures ?? 0), raw.openUntil ? Number(raw.openUntil) : null, Date.now());
  }

  async claimProbe(key: string, ttlMs: number) {
    return (await this.redis.set(this.k('probe', key), '1', 'PX', ttlMs, 'NX')) === 'OK';
  }

  async recordFailure(key: string, threshold: number, cooldownMs: number) {
    const t = Date.now();
    const redisKey = this.k('circuit', key);
    const failures = await this.redis.hincrby(redisKey, 'failures', 1);
    const openUntilRaw = await this.redis.hget(redisKey, 'openUntil');
    let openUntil = openUntilRaw ? Number(openUntilRaw) : null;
    if (failures >= threshold || (openUntil !== null && openUntil <= t)) {
      openUntil = t + cooldownMs;
      await this.redis.hset(redisKey, 'openUntil', String(openUntil));
    }
    await this.redis.pexpire(redisKey, Math.max(cooldownMs * 10, 600_000));
    await this.redis.del(this.k('probe', key));
    return snapshot(failures, openUntil, t);
  }

  async recordSuccess(key: string) {
    await this.redis.del(this.k('circuit', key), this.k('probe', key));
  }
}
