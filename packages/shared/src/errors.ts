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
  IDEMPOTENCY_CONFLICT: 409,
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
    readonly code: 'VERSION_CONFLICT' | 'IDEMPOTENCY_CONFLICT',
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
