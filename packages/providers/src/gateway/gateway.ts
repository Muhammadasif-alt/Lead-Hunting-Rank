import { SIDE_EFFECT_CAPABILITIES, type Capability, type HealthState, type RoutingStrategy } from '../core/capabilities.js';
import { normalizeProviderError, ProviderCallError, toGatewayError, type ProviderErrorKind } from '../core/errors.js';
import type { CallOptions, CapabilityAdapters, CapabilityCheck, ProviderAdapter } from '../core/interfaces.js';
import type { ProviderStateStore } from './state-store.js';

/** One usable adapter for a workspace: a connected Integration (or a system-level provider) plus its limits. */
export interface ProviderBinding {
  /** Integration row; null for system-level providers that need no workspace connection. */
  integrationId: string | null;
  provider: string;
  capabilities: Capability[];
  adapter: ProviderAdapter;
  /** Our own throttle for this account + capability, shared by all workers (docs/12 §87-88). */
  rateLimit?: { limit: number; windowMs: number };
  timeoutMs?: number;
}

/** Router input → candidate bindings in preference order (docs/12 §11). Pinning an integration returns only it. */
export type BindingResolver = (query: { workspaceId: string; capability: Capability; integrationId?: string }) => Promise<ProviderBinding[]>;

/** One provider call, for usage/cost tracking (docs/12 §42, §110-111). */
export interface CallRecord {
  workspaceId: string;
  integrationId: string | null;
  provider: string;
  capability: Capability;
  operation: string;
  status: 'SUCCEEDED' | 'FAILED';
  errorKind: ProviderErrorKind | null;
  durationMs: number;
  units: number | null;
  costMinor: number | null;
  costIsEstimate: boolean;
  entityType: string | null;
  entityId: string | null;
  startedAt: Date;
}

export interface UsageSink {
  record(call: CallRecord): Promise<void>;
}

/** Passive (real call outcomes) and active (health checks) observations, per capability (docs/12 §83). */
export interface HealthObservation {
  workspaceId: string;
  integrationId: string | null;
  provider: string;
  capability: Capability;
  state: HealthState;
  reason: string | null;
}

export interface HealthSink {
  observe(observation: HealthObservation): Promise<void>;
}

export interface GatewayOptions {
  resolve: BindingResolver;
  store: ProviderStateStore;
  usage?: UsageSink;
  health?: HealthSink;
  logger?: { warn: (obj: object, msg: string) => void };
  defaultTimeoutMs?: number;
  /** Consecutive provider failures that open the circuit, and how long it stays open before one probe. */
  circuit?: { threshold: number; cooldownMs: number };
}

export interface CallRequest<C extends Capability> {
  workspaceId: string;
  capability: C;
  /** Short operation name for usage records, e.g. 'send_message'. */
  operation: string;
  /** Use exactly this integration (e.g. the mailbox an action was prepared for). */
  integrationId?: string;
  /** PRIMARY = first candidate only; FALLBACK = next candidate when one definitely did not act. Default PRIMARY. */
  strategy?: RoutingStrategy;
  entity?: { type: string; id: string };
  timeoutMs?: number;
}

export interface CallResult<T> {
  value: T;
  provider: string;
  integrationId: string | null;
}

export interface CheckedCapability extends CapabilityCheck {
  state: HealthState;
}

/** Failures that say something about the provider's health (not about our request). */
const HEALTH_FAILURES: ReadonlySet<ProviderErrorKind> = new Set(['UNAVAILABLE', 'TRANSIENT', 'UNKNOWN_OUTCOME']);
/** Failures after which another provider may be tried — the answer was "can't", not "no". */
const FALLBACK_ON: ReadonlySet<ProviderErrorKind> = new Set([
  'UNAVAILABLE',
  'TRANSIENT',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'AUTH_REQUIRED',
  'PERMISSION_DENIED',
]);

/**
 * The Provider Gateway (docs/12 §9, §150): every external call goes Domain → Gateway → capability interface →
 * adapter. The gateway owns routing, circuit breaking, rate limiting, timeouts, error normalization, usage records and
 * health. It does not retry — the queue worker owns retries, so retry layers never multiply (docs/12 §107).
 */
export class ProviderGateway {
  private readonly timeoutMs: number;
  private readonly circuitPolicy: { threshold: number; cooldownMs: number };

  constructor(private readonly options: GatewayOptions) {
    this.timeoutMs = options.defaultTimeoutMs ?? 30_000;
    this.circuitPolicy = options.circuit ?? { threshold: 5, cooldownMs: 30_000 };
  }

  async call<C extends Capability, T>(
    request: CallRequest<C>,
    fn: (adapter: CapabilityAdapters[C], options: CallOptions) => Promise<T>,
  ): Promise<CallResult<T>> {
    const { workspaceId, capability } = request;
    const bindings = (await this.options.resolve({ workspaceId, capability, integrationId: request.integrationId })).filter((b) =>
      b.capabilities.includes(capability),
    );
    if (bindings.length === 0) {
      const what = request.integrationId ? `Integration ${request.integrationId} is not active or lacks ${capability}` : `No connected integration provides ${capability}`;
      throw toGatewayError(new ProviderCallError('AUTH_REQUIRED', `${what} — connect one in Integrations`), 'gateway');
    }
    const candidates = request.strategy === 'FALLBACK' ? bindings : bindings.slice(0, 1);
    const sideEffect = SIDE_EFFECT_CAPABILITIES.has(capability);
    let last: { error: ProviderCallError; provider: string } | undefined;

    for (const binding of candidates) {
      const key = circuitKey(binding, capability);
      const ref = { workspaceId, integrationId: binding.integrationId, provider: binding.provider, capability };

      const circuit = await this.options.store.circuit(key);
      if (circuit.state === 'OPEN' || (circuit.state === 'HALF_OPEN' && !(await this.options.store.claimProbe(key, this.circuitPolicy.cooldownMs)))) {
        const retryAfterMs = circuit.openUntil ? Math.max(0, circuit.openUntil - Date.now()) : this.circuitPolicy.cooldownMs;
        last = { provider: binding.provider, error: new ProviderCallError('UNAVAILABLE', `Circuit open after repeated failures — retry in ${Math.ceil(retryAfterMs / 1000)}s`, { retryAfterMs }) };
        continue;
      }
      if (binding.rateLimit) {
        const { allowed, retryAfterMs } = await this.options.store.consume(key, binding.rateLimit.limit, binding.rateLimit.windowMs);
        if (!allowed) {
          last = { provider: binding.provider, error: new ProviderCallError('RATE_LIMITED', 'Workspace rate limit for this integration reached', { retryAfterMs }) };
          continue;
        }
      }

      const startedAt = new Date();
      const start = performance.now();
      try {
        const value = await withTimeout(
          (signal) => fn(binding.adapter as CapabilityAdapters[C], { signal }),
          request.timeoutMs ?? binding.timeoutMs ?? this.timeoutMs,
          sideEffect,
        );
        await this.options.store.recordSuccess(key);
        await this.track(request, binding, startedAt, start, null, value);
        await this.observe({ ...ref, state: 'HEALTHY', reason: null });
        return { value, provider: binding.provider, integrationId: binding.integrationId };
      } catch (err) {
        const error = normalizeProviderError(err, sideEffect);
        await this.track(request, binding, startedAt, start, error.kind, undefined);
        await this.onFailure(key, ref, error);
        last = { error, provider: binding.provider };
        // An unclear side effect may have happened: never try a second provider (that could send twice).
        if (!FALLBACK_ON.has(error.kind) || (sideEffect && !error.didNotAct)) break;
      }
    }
    throw toGatewayError(last!.error, last!.provider);
  }

  /**
   * Active, side-effect-free health probe of one binding (docs/12 §118 "Test connection"). Reports each capability's
   * state and resets the circuit when the provider answers.
   */
  async checkHealth(workspaceId: string, binding: ProviderBinding): Promise<CheckedCapability[]> {
    const startedAt = new Date();
    const start = performance.now();
    const request = { workspaceId, capability: binding.capabilities[0]!, operation: 'health_check' };
    let checks: CheckedCapability[];
    try {
      const results = await withTimeout((signal) => binding.adapter.healthCheck({ signal }), binding.timeoutMs ?? 10_000, false);
      await this.track(request, binding, startedAt, start, null, undefined);
      checks = binding.capabilities.map((capability) => {
        const r = results.find((c) => c.capability === capability) ?? { capability, ok: false, detail: 'Provider did not report this capability' };
        return { ...r, state: r.ok ? 'HEALTHY' : 'DEGRADED' };
      });
    } catch (err) {
      const error = normalizeProviderError(err, false);
      await this.track(request, binding, startedAt, start, error.kind, undefined);
      checks = binding.capabilities.map((capability) => ({ capability, ok: false, detail: error.message, state: stateFor(error.kind) ?? 'UNAVAILABLE' }));
    }
    for (const c of checks) {
      if (c.ok) await this.options.store.recordSuccess(circuitKey(binding, c.capability));
      await this.observe({ workspaceId, integrationId: binding.integrationId, provider: binding.provider, capability: c.capability, state: c.state, reason: c.ok ? null : (c.detail ?? null) });
    }
    return checks;
  }

  private async onFailure(key: string, ref: Omit<HealthObservation, 'state' | 'reason'>, error: ProviderCallError) {
    let state = stateFor(error.kind);
    if (HEALTH_FAILURES.has(error.kind)) {
      const circuit = await this.options.store.recordFailure(key, this.circuitPolicy.threshold, this.circuitPolicy.cooldownMs);
      state = circuit.state === 'CLOSED' ? 'DEGRADED' : 'UNAVAILABLE';
    }
    if (state) await this.observe({ ...ref, state, reason: error.message });
  }

  private async track(request: Pick<CallRequest<Capability>, 'workspaceId' | 'capability' | 'operation' | 'entity'>, binding: ProviderBinding, startedAt: Date, start: number, errorKind: ProviderErrorKind | null, value: unknown) {
    if (!this.options.usage) return;
    const usage = (value && typeof value === 'object' ? value : {}) as { units?: unknown; costMinor?: unknown; costIsEstimate?: unknown };
    try {
      await this.options.usage.record({
        workspaceId: request.workspaceId,
        integrationId: binding.integrationId,
        provider: binding.provider,
        capability: request.capability,
        operation: request.operation,
        status: errorKind ? 'FAILED' : 'SUCCEEDED',
        errorKind,
        durationMs: Math.round(performance.now() - start),
        units: typeof usage.units === 'number' ? usage.units : null,
        costMinor: typeof usage.costMinor === 'number' ? usage.costMinor : null,
        costIsEstimate: usage.costIsEstimate === true,
        entityType: request.entity?.type ?? null,
        entityId: request.entity?.id ?? null,
        startedAt,
      });
    } catch (err) {
      // Usage tracking must never fail the business call it describes.
      this.options.logger?.warn({ error: String(err), provider: binding.provider }, 'could not record provider usage');
    }
  }

  private async observe(observation: HealthObservation) {
    if (!this.options.health) return;
    try {
      await this.options.health.observe(observation);
    } catch (err) {
      this.options.logger?.warn({ error: String(err), provider: observation.provider }, 'could not record provider health');
    }
  }
}

function circuitKey(binding: ProviderBinding, capability: Capability): string {
  return `${binding.integrationId ?? binding.provider}:${capability}`;
}

function stateFor(kind: ProviderErrorKind): HealthState | null {
  switch (kind) {
    case 'AUTH_REQUIRED':
    case 'PERMISSION_DENIED':
      return 'AUTH_REQUIRED';
    case 'RATE_LIMITED':
    case 'QUOTA_EXCEEDED':
      return 'RATE_LIMITED';
    case 'UNAVAILABLE':
      return 'UNAVAILABLE';
    case 'TRANSIENT':
    case 'UNKNOWN_OUTCOME':
      return 'DEGRADED';
    default:
      return null; // our request was wrong, not the provider
  }
}

/** Every provider call has a hard timeout; adapters get the signal so they can stop work (docs/12 §106). */
async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number, sideEffect: boolean): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ProviderCallError(sideEffect ? 'UNKNOWN_OUTCOME' : 'TRANSIENT', `Provider timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fn(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
