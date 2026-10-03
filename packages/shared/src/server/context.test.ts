import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptExternalId, getContext, runWithContext, updateContext } from './context.js';

test('context is visible inside async work and isolated between runs', async () => {
  const seen = await Promise.all(
    ['a', 'b'].map((id) =>
      runWithContext({ correlationId: id }, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getContext()?.correlationId;
      }),
    ),
  );
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(getContext(), undefined);
});

test('updateContext adds fields to the current context', () => {
  runWithContext({ correlationId: 'c' }, () => {
    updateContext({ workspaceId: 'ws_1', actorId: 'user_1' });
    assert.equal(getContext()?.workspaceId, 'ws_1');
    assert.equal(getContext()?.correlationId, 'c');
  });
});

test('acceptExternalId only accepts short, plain IDs', () => {
  assert.equal(acceptExternalId('corr_abc-123'), 'corr_abc-123');
  assert.equal(acceptExternalId('a'.repeat(65)), undefined);
  assert.equal(acceptExternalId('bad id\nInjected: log'), undefined);
  assert.equal(acceptExternalId(undefined), undefined);
});
