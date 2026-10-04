import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AuthorityExceededError,
  classifyFailure,
  ConflictError,
  describeError,
  JobTimeoutError,
  NotFoundError,
  PermanentError,
  RateLimitedError,
  ForbiddenError,
  PolicyError,
  ProviderError,
  ValidationError,
} from './errors.js';

test('error classes carry spec codes and HTTP statuses', () => {
  assert.equal(new ValidationError('bad').httpStatus, 400);
  assert.equal(new ForbiddenError('no').code, 'FORBIDDEN');
  assert.equal(new AuthorityExceededError('limit').code, 'AUTHORITY_EXCEEDED');
  assert.equal(new AuthorityExceededError('limit').httpStatus, 403);
  assert.ok(new AuthorityExceededError('limit') instanceof ForbiddenError);
  // Business failure ≠ 500
  assert.equal(new PolicyError('SUPPRESSED', 'unsubscribed').httpStatus, 422);
  assert.equal(new ProviderError('PROVIDER_UNAVAILABLE', 'gmail down').httpStatus, 503);
});

test('error name matches the class', () => {
  assert.equal(new ValidationError('x').name, 'ValidationError');
});

test('describeError unwraps AggregateError to the last cause', () => {
  const err = new AggregateError(
    [new Error('connect ECONNREFUSED ::1:6380'), new Error('connect ECONNREFUSED 127.0.0.1:6380')],
    '',
  );
  assert.equal(describeError(err), 'connect ECONNREFUSED 127.0.0.1:6380');
});

test('describeError uses code when the message is uninformative', () => {
  const err = Object.assign(new Error('\nInvalid `prisma.$queryRaw()` invocation:\n\n'), { code: 'ECONNREFUSED' });
  assert.equal(describeError(err), 'ECONNREFUSED (connection failed)');
});

test('describeError returns AppError messages unchanged', () => {
  assert.equal(describeError(new ValidationError('Name is required')), 'Name is required');
});

test('classifyFailure decides retry vs give up per docs/11 §35-43', () => {
  assert.deepEqual(classifyFailure(new RateLimitedError('slow down', 30_000)), { category: 'RATE_LIMIT', retryable: true, retryAfterMs: 30_000 });
  assert.deepEqual(classifyFailure(new ProviderError('PROVIDER_UNAVAILABLE', '503')), { category: 'TRANSIENT', retryable: true });
  // Expired OAuth: stop the retry storm, ask a human to reconnect.
  assert.deepEqual(classifyFailure(new ProviderError('PROVIDER_AUTH_REQUIRED', 'token expired')), { category: 'AUTH', retryable: false });
  assert.deepEqual(classifyFailure(new ValidationError('bad email')), { category: 'VALIDATION', retryable: false });
  assert.deepEqual(classifyFailure(new PolicyError('SUPPRESSED', 'unsubscribed')), { category: 'POLICY', retryable: false });
  assert.deepEqual(classifyFailure(new NotFoundError('gone')), { category: 'NOT_FOUND', retryable: false });
  assert.deepEqual(classifyFailure(new ConflictError('VERSION_CONFLICT', 'stale')), { category: 'TRANSIENT', retryable: true });
  assert.deepEqual(classifyFailure(new ConflictError('IDEMPOTENCY_CONFLICT', 'payload changed')), { category: 'VALIDATION', retryable: false });
  assert.deepEqual(classifyFailure(new PermanentError('unknown job')), { category: 'PERMANENT', retryable: false });
  assert.deepEqual(classifyFailure(new JobTimeoutError(1000)), { category: 'TRANSIENT', retryable: true });
  assert.deepEqual(classifyFailure(Object.assign(new Error('x'), { code: 'ECONNRESET' })), { category: 'TRANSIENT', retryable: true });
  assert.deepEqual(classifyFailure(new Error('wrapped', { cause: Object.assign(new Error(''), { code: 'P2034' }) })), { category: 'TRANSIENT', retryable: true });
  assert.deepEqual(classifyFailure(new Error('???')), { category: 'UNKNOWN', retryable: true });
});
