import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AuthorityExceededError,
  describeError,
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
