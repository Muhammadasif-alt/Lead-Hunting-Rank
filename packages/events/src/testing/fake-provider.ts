import { ProviderError, RateLimitedError } from '@revenue-os/shared';
import type { Redis } from 'ioredis';
import type { ActionExecutor, ExternalActionView, ReconcileResult } from '../external-action.js';

/** Action type used by the pipeline self-test and Phase 4 tests. Real providers arrive in Phase 5. */
export const FAKE_SEND_ACTION = 'diagnostics.fake_send';

/** Where the fake provider keeps what it "sent" — in memory for tests, Redis for the dev worker. */
export interface FakeProviderStore {
  /** Records one provider call and returns how many calls this key has had (including this one). */
  recordCall(key: string): Promise<number>;
  getSent(key: string): Promise<string | null>;
  setSent(key: string, providerRef: string): Promise<void>;
}

export class MemoryFakeProviderStore implements FakeProviderStore {
  readonly calls = new Map<string, number>();
  readonly sent = new Map<string, string>();

  async recordCall(key: string) {
    const n = (this.calls.get(key) ?? 0) + 1;
    this.calls.set(key, n);
    return n;
  }
  async getSent(key: string) {
    return this.sent.get(key) ?? null;
  }
  async setSent(key: string, ref: string) {
    this.sent.set(key, ref);
  }
}

/** Redis-backed store so the dev worker's "sent" record survives restarts and the API can show the call count. */
export class RedisFakeProviderStore implements FakeProviderStore {
  constructor(
    private readonly redis: Redis,
    private readonly prefix: string,
  ) {}

  async recordCall(key: string) {
    return this.redis.incr(fakeProviderKey(this.prefix, 'calls', key));
  }
  async getSent(key: string) {
    return this.redis.get(fakeProviderKey(this.prefix, 'sent', key));
  }
  async setSent(key: string, ref: string) {
    await this.redis.set(fakeProviderKey(this.prefix, 'sent', key), ref, 'EX', 7 * 24 * 3600);
  }
}

export function fakeProviderKey(prefix: string, kind: 'calls' | 'sent', idempotencyKey: string): string {
  return `${prefix}:fake-provider:${kind}:${idempotencyKey}`;
}

export type FakeFailure =
  /** Provider refuses (429) — definitely did not act. */
  | 'rate-limit'
  /** Provider unavailable (503) — definitely did not act. */
  | 'unavailable'
  /** Provider acts, then the response is lost — the dangerous case reconciliation exists for. */
  | 'lost-response'
  /** Provider hangs past the timeout without acting. */
  | 'hang';

/**
 * A side-effect provider that does NOT deduplicate by itself, so tests prove that our idempotency — not the
 * provider's — guarantees one effect. Every call that "acts" is counted per idempotency key.
 */
export class FakeSideEffectProvider implements ActionExecutor {
  private readonly failures: FakeFailure[] = [];
  /** Number of times the provider actually performed the side effect (across all keys). */
  effects = 0;

  constructor(
    readonly store: FakeProviderStore = new MemoryFakeProviderStore(),
    private readonly latencyMs = 0,
  ) {}

  /** Queue failures for the next calls, in order. */
  failNext(...failures: FakeFailure[]): this {
    this.failures.push(...failures);
    return this;
  }

  async execute(action: ExternalActionView, signal: AbortSignal): Promise<{ providerRef: string }> {
    // The pipeline self-test can ask for a failure on its first attempt via payload.simulate.
    const simulate = (action.payload as { simulate?: FakeFailure } | null)?.simulate;
    const failure = this.failures.shift() ?? (action.attemptCount === 1 ? simulate : undefined);
    if (failure === 'rate-limit') throw new RateLimitedError('Fake provider: 429 Too Many Requests', 50);
    if (failure === 'unavailable') throw new ProviderError('PROVIDER_UNAVAILABLE', 'Fake provider: 503 Service Unavailable');
    if (failure === 'hang') {
      await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
      throw new Error('aborted');
    }
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));

    const n = await this.store.recordCall(action.idempotencyKey);
    this.effects++;
    const ref = `fake-${action.id.slice(0, 8)}-${n}`;
    await this.store.setSent(action.idempotencyKey, ref);
    if (failure === 'lost-response') throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    return { providerRef: ref };
  }

  async reconcile(action: ExternalActionView): Promise<ReconcileResult> {
    const ref = await this.store.getSent(action.idempotencyKey);
    return ref ? { status: 'SUCCEEDED', providerRef: ref } : { status: 'NOT_FOUND' };
  }
}
