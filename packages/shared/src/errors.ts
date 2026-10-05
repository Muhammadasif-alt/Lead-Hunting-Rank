/**
 * Shared error taxonomy (Tech Spec #13 Phase 1, API envelope per Tech Spec #10 §16).
 * Domain code throws these; the API turns them into `{ error: { code, message, details, requestId } }`.
 * Business failures are never 500s — e.g. sending to an unsubscribed contact is 422 SUPPRESSED.
 */
export const ERROR_CODES = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  AUTHORITY_EXCEEDED: 403,
  RESOURCE_NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  ALREADY_EXISTS: 409,
  IDEMPOTENCY_CONFLICT: 409,
  MISSION_ALREADY_RUNNING: 409,
  INVALID_STATE_TRANSITION: 422,
  SUPPRESSED: 422,
  POLICY_BLOCKED: 422,
  APPROVAL_REQUIRED: 422,
  BUDGET_EXCEEDED: 422,
  KNOWLEDGE_CONFLICT: 422,
  STALE_CONTEXT: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_AUTH_REQUIRED: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorDetail {
  path?: string;
  message: string;
}

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;

  constructor(
    message: string,
    readonly details?: ErrorDetail[],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }

  get httpStatus(): number {
    return ERROR_CODES[this.code];
  }
}

/** Input failed schema validation (wrong type, missing field, unknown field…). */
export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
}

export class UnauthenticatedError extends AppError {
  readonly code = 'UNAUTHENTICATED';
}

/** Actor lacks the permission (RBAC). Use AuthorityExceededError when permission exists but the limit is too low. */
export class ForbiddenError extends AppError {
  readonly code: 'FORBIDDEN' | 'AUTHORITY_EXCEEDED' = 'FORBIDDEN';
}

export class AuthorityExceededError extends ForbiddenError {
  override readonly code = 'AUTHORITY_EXCEEDED';
}

export class NotFoundError extends AppError {
  readonly code = 'RESOURCE_NOT_FOUND';
}

export class ConflictError extends AppError {
  constructor(
    readonly code: 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'ALREADY_EXISTS' | 'MISSION_ALREADY_RUNNING',
    message: string,
    details?: ErrorDetail[],
  ) {
    super(message, details);
  }
}

/** A domain rule rejected the command (e.g. invalid state transition, stale context). */
export class BusinessRuleError extends AppError {
  constructor(
    readonly code:
      | 'INVALID_STATE_TRANSITION'
      | 'BUDGET_EXCEEDED'
      | 'KNOWLEDGE_CONFLICT'
      | 'STALE_CONTEXT',
    message: string,
    details?: ErrorDetail[],
  ) {
    super(message, details);
  }
}

/** The Policy Engine / safety layer said no. Never retried automatically. */
export class PolicyError extends AppError {
  constructor(
    readonly code: 'POLICY_BLOCKED' | 'SUPPRESSED' | 'APPROVAL_REQUIRED',
    message: string,
    details?: ErrorDetail[],
  ) {
    super(message, details);
  }
}

/** An external provider (Gmail, Calendar, LLM, lead source…) is unavailable or needs re-auth. */
export class ProviderError extends AppError {
  constructor(
    readonly code: 'PROVIDER_UNAVAILABLE' | 'PROVIDER_AUTH_REQUIRED',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, undefined, options);
  }
}

export class RateLimitedError extends AppError {
  readonly code = 'RATE_LIMITED';

  constructor(
    message: string,
    /** Provider-advised wait (Retry-After), used by workers to back off. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
}

/** A job exceeded its time budget. Retryable — but for external actions the outcome is unknown (see ExternalAction). */
export class JobTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Timed out after ${timeoutMs} ms`);
    this.name = 'JobTimeoutError';
  }
}

/** A failure that retrying can never fix (bad payload, unsupported job). Goes straight to the dead-letter queue. */
export class PermanentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentError';
  }
}

/**
 * Failure classes from docs/11 §35-43 — a worker classifies before it decides to retry.
 * POLICY is not a technical failure: the business action is BLOCKED and the job completes.
 */
export type FailureCategory = 'TRANSIENT' | 'RATE_LIMIT' | 'AUTH' | 'VALIDATION' | 'POLICY' | 'NOT_FOUND' | 'PERMANENT' | 'UNKNOWN';

export interface FailureClassification {
  category: FailureCategory;
  retryable: boolean;
  retryAfterMs?: number;
}

const TRANSIENT_NODE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'UND_ERR_SOCKET']);
// Prisma: can't reach DB / timed out / transaction write conflict or deadlock / pool timeout.
const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2034']);

export function classifyFailure(err: unknown): FailureClassification {
  if (err instanceof RateLimitedError) return { category: 'RATE_LIMIT', retryable: true, retryAfterMs: err.retryAfterMs };
  if (err instanceof ProviderError) {
    return err.code === 'PROVIDER_AUTH_REQUIRED'
      ? { category: 'AUTH', retryable: false }
      : { category: 'TRANSIENT', retryable: true };
  }
  if (err instanceof PolicyError) return { category: 'POLICY', retryable: false };
  if (err instanceof NotFoundError) return { category: 'NOT_FOUND', retryable: false };
  if (err instanceof ConflictError) {
    return err.code === 'VERSION_CONFLICT' ? { category: 'TRANSIENT', retryable: true } : { category: 'VALIDATION', retryable: false };
  }
  if (err instanceof ValidationError || err instanceof BusinessRuleError) return { category: 'VALIDATION', retryable: false };
  if (err instanceof ForbiddenError || err instanceof UnauthenticatedError || err instanceof PermanentError) {
    return { category: 'PERMANENT', retryable: false };
  }
  if (err instanceof JobTimeoutError) return { category: 'TRANSIENT', retryable: true };

  const code = errorCode(err);
  if (code && (TRANSIENT_NODE_CODES.has(code) || TRANSIENT_PRISMA_CODES.has(code))) return { category: 'TRANSIENT', retryable: true };
  return { category: 'UNKNOWN', retryable: true };
}

function errorCode(err: unknown): string | undefined {
  for (let e: unknown = err, depth = 0; e && depth < 5; e = (e as { cause?: unknown }).cause, depth++) {
    const code = (e as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    if (e instanceof AggregateError && e.errors.length > 0) return errorCode(e.errors.at(-1));
  }
  return undefined;
}

/**
 * Turns any thrown value into a one-line human message.
 * Handles AggregateError (Node's dual-stack connect failures) and wrappers with empty messages
 * (e.g. Prisma), so health checks and logs say "connect ECONNREFUSED 127.0.0.1:6380" instead of "".
 */
export function describeError(err: unknown): string {
  if (err instanceof AppError) return err.message;
  if (err instanceof AggregateError && err.errors.length > 0) {
    return describeError(err.errors[err.errors.length - 1]);
  }
  if (err instanceof Error) {
    const message = err.message
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .at(-1);
    const code = (err as { code?: unknown }).code;
    const uninformative = !message || message.endsWith(':');
    if (uninformative && err.cause !== undefined) return describeError(err.cause);
    if (typeof code === 'string' && (uninformative || !message.includes(code))) {
      return uninformative ? `${code} (connection failed)` : `${code} — ${message}`;
    }
    return message ?? err.name;
  }
  return String(err);
}
