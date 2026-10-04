import {
  AppError,
  NotFoundError,
  PermanentError,
  ProviderError,
  RateLimitedError,
  ValidationError,
  describeError,
} from '@revenue-os/shared';

/**
 * Normalized provider error taxonomy (docs/12 §108). Adapters translate vendor errors into one of these kinds, so
 * workers react the same way whatever the vendor. Kinds marked "did not act" are safe to retry or fall back on;
 * the rest may have reached the provider.
 */
export const PROVIDER_ERROR_KINDS = [
  'AUTH_REQUIRED',
  'PERMISSION_DENIED',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'UNAVAILABLE',
  'NOT_FOUND',
  'INVALID_REQUEST',
  'TRANSIENT',
  'UNKNOWN_OUTCOME',
  'PERMANENT',
] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

/** The provider refused before acting — nothing happened, so retrying or using another provider is safe. */
const DID_NOT_ACT: ReadonlySet<ProviderErrorKind> = new Set([
  'AUTH_REQUIRED',
  'PERMISSION_DENIED',
  'RATE_LIMITED',
  'QUOTA_EXCEEDED',
  'UNAVAILABLE',
  'INVALID_REQUEST',
  'NOT_FOUND',
]);

/** What an adapter throws. `raw` is sanitized technical detail for debugging — never secrets (docs/12 §109). */
export class ProviderCallError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly options: { retryAfterMs?: number; raw?: string; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ProviderCallError';
  }

  get didNotAct(): boolean {
    return DID_NOT_ACT.has(this.kind);
  }
}

/** Connection never established → the provider cannot have acted. */
const NOT_CONNECTED_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH']);

/**
 * Turns anything an adapter threw into a ProviderCallError. Timeouts and dropped connections are TRANSIENT for reads
 * but UNKNOWN_OUTCOME for side effects: the provider may have acted, so the caller must reconcile (docs/12 §30).
 */
export function normalizeProviderError(err: unknown, sideEffect: boolean): ProviderCallError {
  if (err instanceof ProviderCallError) return err;
  if (err instanceof RateLimitedError) return new ProviderCallError('RATE_LIMITED', err.message, { retryAfterMs: err.retryAfterMs, cause: err });
  if (err instanceof ProviderError) {
    return new ProviderCallError(err.code === 'PROVIDER_AUTH_REQUIRED' ? 'AUTH_REQUIRED' : 'UNAVAILABLE', err.message, { cause: err });
  }
  if (err instanceof ValidationError) return new ProviderCallError('INVALID_REQUEST', err.message, { cause: err });
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && NOT_CONNECTED_CODES.has(code)) {
    return new ProviderCallError('UNAVAILABLE', describeError(err), { cause: err });
  }
  return new ProviderCallError(sideEffect ? 'UNKNOWN_OUTCOME' : 'TRANSIENT', describeError(err), { cause: err });
}

/** The outcome of a side effect is unknown (timeout, dropped response). Retryable — but only after reconciling. */
export class ProviderOutcomeUnknownError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderOutcomeUnknownError';
  }
}

export type GatewayError = (AppError | PermanentError | ProviderOutcomeUnknownError) & { providerErrorKind: ProviderErrorKind };

/**
 * Maps a normalized provider error onto the shared error taxonomy, which workers and the ExternalAction state
 * machine already understand: RateLimited/Unavailable = definitely not sent → retry; AuthRequired → WAITING;
 * InvalidRequest/Permanent → FAILED; unknown outcome → reconcile.
 */
export function toGatewayError(err: ProviderCallError, provider: string): GatewayError {
  const message = `${provider}: ${err.message}`;
  let mapped: AppError | PermanentError | ProviderOutcomeUnknownError;
  switch (err.kind) {
    case 'RATE_LIMITED':
    case 'QUOTA_EXCEEDED':
      mapped = new RateLimitedError(message, err.options.retryAfterMs);
      break;
    case 'UNAVAILABLE':
      mapped = new ProviderError('PROVIDER_UNAVAILABLE', message, { cause: err });
      break;
    case 'AUTH_REQUIRED':
    case 'PERMISSION_DENIED':
      mapped = new ProviderError('PROVIDER_AUTH_REQUIRED', message, { cause: err });
      break;
    case 'INVALID_REQUEST':
      mapped = new ValidationError(message);
      break;
    case 'NOT_FOUND':
      mapped = new NotFoundError(message);
      break;
    case 'PERMANENT':
      mapped = new PermanentError(message, { cause: err });
      break;
    case 'TRANSIENT':
    case 'UNKNOWN_OUTCOME':
      mapped = new ProviderOutcomeUnknownError(message, { cause: err });
      break;
  }
  return Object.assign(mapped, { providerErrorKind: err.kind });
}
