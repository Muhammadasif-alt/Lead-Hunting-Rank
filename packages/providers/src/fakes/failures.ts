import { ProviderCallError } from '../core/errors.js';

/**
 * Failure injection shared by the fake providers, so tests and the dev UI can exercise every path the gateway and
 * workers must handle — without a real vendor misbehaving on cue.
 */
export type FakeFailure =
  /** 429 — refused before acting. */
  | 'rate-limit'
  /** 503 — refused before acting. */
  | 'unavailable'
  /** 401 — credentials no longer accepted. */
  | 'auth'
  /** Acts, then the response is lost (side-effect calls only) — what reconciliation exists for. */
  | 'lost-response'
  /** Never answers until the gateway's timeout aborts it. */
  | 'hang';

export class FailureQueue {
  private readonly queue: FakeFailure[] = [];

  push(...failures: FakeFailure[]) {
    this.queue.push(...failures);
  }

  /** Applies the next queued failure that happens before the provider acts. Returns 'lost-response' to apply after. */
  async before(signal: AbortSignal): Promise<'lost-response' | null> {
    const failure = this.queue.shift();
    switch (failure) {
      case 'rate-limit':
        throw new ProviderCallError('RATE_LIMITED', 'Fake provider: 429 Too Many Requests', { retryAfterMs: 50 });
      case 'unavailable':
        throw new ProviderCallError('UNAVAILABLE', 'Fake provider: 503 Service Unavailable');
      case 'auth':
        throw new ProviderCallError('AUTH_REQUIRED', 'Fake provider: 401 credentials revoked');
      case 'hang':
        await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
        throw new Error('aborted');
      case 'lost-response':
        return 'lost-response';
      default:
        return null;
    }
  }

  static lost(): never {
    throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  }
}

/** Small deterministic PRNG (mulberry32) so fake data is identical on every run for the same input. */
export function seededRandom(seedText: string): () => number {
  let seed = 0;
  for (let i = 0; i < seedText.length; i++) seed = (Math.imul(31, seed) + seedText.charCodeAt(i)) | 0;
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
