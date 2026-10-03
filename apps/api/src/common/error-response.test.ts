import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotFoundException } from '@nestjs/common';
import { PolicyError, ValidationError } from '@revenue-os/shared';
import { z } from 'zod';
import { mapError } from './error-response.js';
import { ZodValidationPipe } from './zod-validation.pipe.js';

test('AppError maps to its own code and status', () => {
  const mapped = mapError(new PolicyError('SUPPRESSED', 'Contact unsubscribed'));
  assert.deepEqual(
    { status: mapped.status, code: mapped.code, unexpected: mapped.unexpected },
    { status: 422, code: 'SUPPRESSED', unexpected: false },
  );
});

test('Nest 404 maps to RESOURCE_NOT_FOUND', () => {
  const mapped = mapError(new NotFoundException('Cannot GET /api/v1/nope'));
  assert.equal(mapped.code, 'RESOURCE_NOT_FOUND');
  assert.equal(mapped.status, 404);
});

test('malformed JSON body maps to VALIDATION_ERROR', () => {
  const mapped = mapError(Object.assign(new SyntaxError('Unexpected token'), { status: 400 }));
  assert.equal(mapped.code, 'VALIDATION_ERROR');
  assert.equal(mapped.message, 'Request body is not valid JSON');
});

test('unknown errors become INTERNAL_ERROR without leaking details', () => {
  const mapped = mapError(new Error('password authentication failed for user "postgres"'));
  assert.equal(mapped.status, 500);
  assert.equal(mapped.code, 'INTERNAL_ERROR');
  assert.equal(mapped.unexpected, true);
  assert.doesNotMatch(mapped.message, /password|postgres/);
});

test('ZodValidationPipe rejects unknown fields and reports paths', () => {
  const pipe = new ZodValidationPipe(z.strictObject({ name: z.string().min(1) }));
  assert.deepEqual(pipe.transform({ name: 'GreenScape' }), { name: 'GreenScape' });
  assert.throws(
    () => pipe.transform({ name: '', workspaceId: 'someone-else' }),
    (err: unknown) => {
      assert.ok(err instanceof ValidationError);
      const paths = err.details?.map((d) => d.path ?? '') ?? [];
      assert.ok(paths.includes('name'));
      assert.ok(err.details?.some((d) => /workspaceId/.test(d.message)));
      return true;
    },
  );
});
