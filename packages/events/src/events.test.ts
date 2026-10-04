import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backoffDelay, JOB_BACKOFF } from './backoff.js';
import { canTransition, EXTERNAL_ACTION_TRANSITIONS } from './external-action.js';
import { EVENTS, eventDefinition } from './registry.js';
import { payloadHash, stableStringify } from './writer.js';

test('ExternalAction: SUCCEEDED, BLOCKED and CANCELLED are terminal', () => {
  for (const s of ['SUCCEEDED', 'BLOCKED', 'CANCELLED'] as const) assert.deepEqual(EXTERNAL_ACTION_TRANSITIONS[s], []);
});

test('ExternalAction: only a claimed (EXECUTING) or reconciled action can succeed', () => {
  const into = Object.entries(EXTERNAL_ACTION_TRANSITIONS)
    .filter(([, to]) => to.includes('SUCCEEDED'))
    .map(([from]) => from)
    .sort();
  assert.deepEqual(into, ['EXECUTING', 'UNKNOWN_OUTCOME']);
  assert.equal(canTransition('QUEUED', 'SUCCEEDED'), false);
  assert.equal(canTransition('PREPARED', 'EXECUTING'), false);
  // An unknown outcome may never jump straight back to executing — it must be reconciled first.
  assert.equal(canTransition('UNKNOWN_OUTCOME', 'EXECUTING'), false);
  assert.equal(canTransition('WAITING_APPROVAL', 'QUEUED'), false);
});

test('backoff grows exponentially with jitter and respects the cap', () => {
  const lo = () => 0;
  const hi = () => 1;
  assert.equal(backoffDelay(1, JOB_BACKOFF, lo), 2_500);
  assert.equal(backoffDelay(1, JOB_BACKOFF, hi), 5_000);
  assert.equal(backoffDelay(2, JOB_BACKOFF, hi), 20_000);
  assert.equal(backoffDelay(3, JOB_BACKOFF, hi), 80_000);
  assert.equal(backoffDelay(50, JOB_BACKOFF, hi), JOB_BACKOFF.maxMs);
  assert.equal(backoffDelay(50, JOB_BACKOFF, lo), JOB_BACKOFF.maxMs / 2);
});

test('payload hash ignores key order and undefined fields', () => {
  assert.equal(stableStringify({ b: 1, a: { d: [1, { y: 2, x: 1 }], c: null } }), '{"a":{"c":null,"d":[1,{"x":1,"y":2}]},"b":1}');
  assert.equal(payloadHash({ to: 'a@b.co', subject: 'Hi' }), payloadHash({ subject: 'Hi', to: 'a@b.co', cc: undefined }));
  assert.notEqual(payloadHash({ subject: 'Hi' }), payloadHash({ subject: 'Hi!' }));
});

test('registry: past-tense names, unique consumers, routes only where intended', () => {
  const consumers = new Set<string>();
  for (const [type, def] of Object.entries(EVENTS)) {
    assert.match(type, /^[A-Z][A-Za-z]+(Created|Updated|Added|Attached|Recorded|Conflicted|Superseded|Prepared|Queued|Succeeded|Failed|Blocked|Cancelled|Waiting|Expired|Review|Connected|Disconnected|Disabled|Enabled|Degraded|Limited|Recovered|Unavailable)$/, type);
    assert.ok(def.version >= 1);
    for (const r of def.routes) {
      assert.ok(!consumers.has(r.consumer), `duplicate consumer ${r.consumer}`);
      consumers.add(r.consumer);
      assert.ok(!r.consumer.includes(':'), 'BullMQ job ids may not contain ":"');
    }
  }
  assert.equal(EVENTS.ExternalActionQueued.routes.length, 1);
  assert.equal(EVENTS.ExternalActionNeedsReview.routes.length, 0, 'needs-review must not loop back into execution');
  assert.equal(eventDefinition('toString'), undefined);
  assert.equal(eventDefinition('NoSuchEvent'), undefined);
});
