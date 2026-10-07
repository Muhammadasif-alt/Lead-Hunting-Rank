import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  dispatchOutboxBatch,
  executeExternalAction,
  expireStaleClaims,
  prepareExternalAction,
  processOnce,
  queueExternalAction,
  recordDeadLetter,
  recordEvent,
  resolveDeadLetter,
  RetryLaterError,
  type ExecutionOutcome,
  type PublishJob,
} from '@revenue-os/events';
import { FAKE_SEND_ACTION, FakeSideEffectProvider } from '@revenue-os/events/testing';
import { ConflictError, JOBS, QUEUES, ValidationError } from '@revenue-os/shared';
import { newId, runWithContext } from '@revenue-os/shared/server';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { CompanyService } from '../crm/company.service.js';
import { EntityResolutionService } from '../crm/entity-resolution.service.js';
import { WorkspaceService } from '../identity/workspace.service.js';

/** Phase 4 (docs/17 §26-33): transactional outbox, dispatcher, ExternalAction idempotency, reconciliation, DLQ, inbox. */
describe('Phase 4 — events, outbox and external actions', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let ctx: ServiceContext;
  let companies: CompanyService;

  before(async () => {
    ({ prisma, close } = await setupTestDatabase());
    companies = new CompanyService(prisma, new EntityResolutionService(prisma));
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, {
      name: 'Events Test',
      slug: uniqueSlug('events'),
      owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Owner' },
    });
    ctx = { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } };
  });

  after(async () => close());

  /** Prepares + queues a fake send and returns its id. */
  async function queuedAction(payload: Record<string, unknown> = {}) {
    return prisma.client.$transaction(async (tx) => {
      const { action } = await prepareExternalAction(tx, ctx, {
        actionType: FAKE_SEND_ACTION,
        provider: 'fake',
        entityType: 'WORKSPACE',
        entityId: ctx.workspaceId,
        idempotencyKey: `test:${newId()}`,
        payload: { to: 'owner@example.com', ...payload },
      });
      await queueExternalAction(tx, ctx, action.id);
      return action.id;
    });
  }
  const run = (id: string, provider: FakeSideEffectProvider, extra: { finalAttempt?: boolean } = {}) =>
    executeExternalAction(prisma.client, { workspaceId: ctx.workspaceId, externalActionId: id }, { executors: { [FAKE_SEND_ACTION]: provider }, timeoutMs: 300, ...extra });
  const statusOf = async (id: string) => (await prisma.client.externalAction.findUniqueOrThrow({ where: { id } })).status;
  const eventsFor = (id: string) => prisma.client.domainEvent.findMany({ where: { aggregateId: id }, orderBy: { occurredAt: 'asc' } });

  test('a business mutation and its event commit together, sharing the request correlationId', async () => {
    const correlationId = newId();
    const company = await runWithContext({ correlationId, requestId: 'req-1' }, () => companies.create(ctx, { displayName: 'Outbox Landscaping' }));
    const [event] = await eventsFor(company.id);
    assert.equal(event?.eventType, 'CompanyCreated');
    assert.equal(event?.correlationId, correlationId);
    assert.equal(event?.causationId, 'req-1');
    const outbox = await prisma.client.outboxEvent.findFirstOrThrow({ where: { domainEventId: event!.id } });
    assert.equal(outbox.status, 'PENDING');
    assert.equal(outbox.correlationId, correlationId);
  });

  test('if the transaction fails, neither the change nor the event persists', async () => {
    const aggregateId = newId();
    await assert.rejects(
      prisma.client.$transaction(async (tx) => {
        await recordEvent(tx, ctx, 'CompanyCreated', aggregateId, { companyId: aggregateId, displayName: 'Ghost', websiteDomain: null });
        throw new Error('business rule failed after the event was written');
      }),
    );
    assert.equal(await prisma.client.domainEvent.count({ where: { aggregateId } }), 0);
    assert.equal(await prisma.client.outboxEvent.count({ where: { aggregateId } }), 0);
  });

  test('dispatcher routes events to consumer jobs with deterministic ids, once, even with competing dispatchers', async () => {
    const id = await queuedAction();
    const company = await companies.create(ctx, { displayName: 'No Consumers Yet Inc' });
    const published: PublishJob[] = [];
    const publish = async (jobs: PublishJob[]) => void published.push(...jobs);

    // Two dispatchers at once: SKIP LOCKED means each row is claimed by exactly one of them.
    await Promise.all([dispatchOutboxBatch(prisma.client, publish, { batchSize: 500 }), dispatchOutboxBatch(prisma.client, publish, { batchSize: 500 })]);
    while ((await dispatchOutboxBatch(prisma.client, publish, { batchSize: 500 })).claimed > 0);

    // Queued fans out to execution (once) and to campaign bookkeeping (Phase 11), each with its own job id.
    const mine = published.filter((j) => j.data.externalActionId === id && j.name === JOBS.externalActionExecute);
    assert.equal(mine.length, 1);
    assert.equal(published.filter((j) => j.data.externalActionId === id).length, 2);
    assert.equal(mine[0]!.queue, QUEUES.outbound);
    assert.equal(mine[0]!.name, JOBS.externalActionExecute);
    assert.match(mine[0]!.jobId, /^[0-9a-f-]+\.outbound\.execute-external-action$/);
    assert.equal(mine[0]!.data.workspaceId, ctx.workspaceId);
    assert.ok(mine[0]!.data.correlationId);
    // Events without consumers are still marked published.
    const companyOutbox = await prisma.client.outboxEvent.findFirstOrThrow({ where: { aggregateId: company.id } });
    assert.equal(companyOutbox.status, 'PUBLISHED');
  });

  test('when publishing fails the outbox row stays pending with a backoff; unknown event types are parked', async () => {
    // Drain rows left by earlier tests/runs so this batch contains ours.
    while ((await dispatchOutboxBatch(prisma.client, async () => undefined, { batchSize: 500 })).claimed > 0);
    await queuedAction();
    await prisma.client.outboxEvent.create({ data: { workspaceId: ctx.workspaceId, eventType: 'BogusThingHappened', aggregateType: 'X', aggregateId: newId(), payload: {} } });
    const r = await dispatchOutboxBatch(prisma.client, async () => {
      throw new Error('Redis unavailable');
    }, { batchSize: 500 });
    assert.ok(r.retrying >= 1);
    const pending = await prisma.client.outboxEvent.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId, status: 'PENDING', eventType: 'ExternalActionQueued' } });
    assert.equal(pending.attemptCount, 1);
    assert.match(pending.lastError ?? '', /Redis unavailable/);
    assert.ok(pending.availableAt > new Date());
    const bogus = await prisma.client.outboxEvent.findFirstOrThrow({ where: { workspaceId: ctx.workspaceId, eventType: 'BogusThingHappened' } });
    assert.equal(bogus.status, 'DEAD');
  });

  test('prepare is idempotent per key; a different payload under the same key is a conflict', async () => {
    const key = `test:${newId()}`;
    const input = { actionType: FAKE_SEND_ACTION, provider: 'fake', entityType: 'WORKSPACE' as const, entityId: ctx.workspaceId, idempotencyKey: key };
    const first = await prisma.client.$transaction((tx) => prepareExternalAction(tx, ctx, { ...input, payload: { a: 1, b: 2 } }));
    const again = await prisma.client.$transaction((tx) => prepareExternalAction(tx, ctx, { ...input, payload: { b: 2, a: 1 } }));
    assert.equal(first.created, true);
    assert.equal(again.created, false);
    assert.equal(again.action.id, first.action.id);
    await assert.rejects(prisma.client.$transaction((tx) => prepareExternalAction(tx, ctx, { ...input, payload: { a: 1, b: 3 } })), (e) => e instanceof ConflictError && e.code === 'IDEMPOTENCY_CONFLICT');
    assert.equal(await prisma.client.domainEvent.count({ where: { aggregateId: first.action.id, eventType: 'ExternalActionPrepared' } }), 1);
  });

  test('same logical send delivered 10 times → exactly one external effect', async () => {
    const provider = new FakeSideEffectProvider();
    const id = await queuedAction();
    const outcomes: ExecutionOutcome[] = [];
    for (let i = 0; i < 10; i++) outcomes.push(await run(id, provider));
    assert.equal(provider.effects, 1);
    assert.deepEqual(outcomes, ['SUCCEEDED', ...Array(9).fill('ALREADY_SUCCEEDED')]);
    assert.equal(await statusOf(id), 'SUCCEEDED');
    assert.equal((await eventsFor(id)).filter((e) => e.eventType === 'ExternalActionSucceeded').length, 1);
  });

  test('10 concurrent deliveries race for the claim → exactly one external effect', async () => {
    const provider = new FakeSideEffectProvider(undefined, 30);
    const id = await queuedAction();
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => run(id, provider)));
    assert.equal(provider.effects, 1);
    assert.equal(outcomes.filter((o) => o === 'SUCCEEDED').length, 1);
    assert.ok(outcomes.every((o) => ['SUCCEEDED', 'CLAIM_LOST', 'IN_PROGRESS', 'ALREADY_SUCCEEDED'].includes(o)), outcomes.join());
    const action = await prisma.client.externalAction.findUniqueOrThrow({ where: { id } });
    assert.equal(action.attemptCount, 1);
  });

  test('provider refusal (429) puts the action back in the queue; the retry sends once', async () => {
    const provider = new FakeSideEffectProvider().failNext('rate-limit');
    const id = await queuedAction();
    await assert.rejects(run(id, provider), (e) => e instanceof RetryLaterError && e.retryAfterMs === 50);
    assert.equal(await statusOf(id), 'QUEUED');
    assert.equal(await run(id, provider), 'SUCCEEDED');
    assert.equal(provider.effects, 1);
  });

  test('crash after send (response lost) → UNKNOWN_OUTCOME → reconciled with the provider, never resent', async () => {
    const provider = new FakeSideEffectProvider().failNext('lost-response');
    const id = await queuedAction();
    await assert.rejects(run(id, provider), RetryLaterError);
    assert.equal(await statusOf(id), 'UNKNOWN_OUTCOME');
    assert.equal(provider.effects, 1);
    assert.equal(await run(id, provider), 'RECONCILED_SUCCEEDED');
    assert.equal(await run(id, provider), 'ALREADY_SUCCEEDED');
    assert.equal(provider.effects, 1, 'reconciliation must not resend');
  });

  test('a timeout without effect is reconciled as NOT_FOUND and then safely retried', async () => {
    const provider = new FakeSideEffectProvider().failNext('hang');
    const id = await queuedAction();
    await assert.rejects(run(id, provider), RetryLaterError);
    assert.equal(await statusOf(id), 'UNKNOWN_OUTCOME');
    assert.equal(provider.effects, 0);
    assert.equal(await run(id, provider), 'SUCCEEDED');
    assert.equal(provider.effects, 1);
  });

  test('a worker that died mid-call is found by the sweep, reconciled via its event, and not resent', async () => {
    const provider = new FakeSideEffectProvider();
    const id = await queuedAction();
    const action = await prisma.client.externalAction.findUniqueOrThrow({ where: { id } });
    // Simulate: claimed 10 minutes ago, provider performed the effect, worker crashed before saving.
    await prisma.client.externalAction.update({ where: { id }, data: { status: 'EXECUTING', claimedAt: new Date(Date.now() - 10 * 60_000), attemptCount: 1 } });
    await provider.store.setSent(action.idempotencyKey, 'fake-ref-from-before-crash');

    assert.ok((await expireStaleClaims(prisma.client, 5 * 60_000)) >= 1);
    assert.equal(await statusOf(id), 'UNKNOWN_OUTCOME');
    const expired = await prisma.client.outboxEvent.findFirstOrThrow({ where: { aggregateId: id, eventType: 'ExternalActionClaimExpired' } });
    assert.equal(expired.status, 'PENDING');

    assert.equal(await run(id, provider), 'RECONCILED_SUCCEEDED');
    assert.equal(provider.effects, 0);
    assert.equal((await prisma.client.externalAction.findUniqueOrThrow({ where: { id } })).responseRef, 'fake-ref-from-before-crash');
  });

  test('revalidation right before execution blocks the action without calling the provider', async () => {
    const provider = new FakeSideEffectProvider();
    const id = await queuedAction();
    const outcome = await executeExternalAction(prisma.client, { workspaceId: ctx.workspaceId, externalActionId: id }, {
      executors: { [FAKE_SEND_ACTION]: provider },
      revalidate: async () => ({ ok: false, status: 'BLOCKED', reason: 'Contact unsubscribed after the action was queued' }),
    });
    assert.equal(outcome, 'BLOCKED');
    assert.equal(provider.effects, 0);
    const action = await prisma.client.externalAction.findUniqueOrThrow({ where: { id } });
    assert.equal(action.status, 'BLOCKED');
    assert.match(action.statusReason ?? '', /unsubscribed/);
    assert.ok((await eventsFor(id)).some((e) => e.eventType === 'ExternalActionBlocked'));
    assert.equal(await run(id, provider), 'NOT_EXECUTABLE', 'a stale job for a blocked action does nothing');
  });

  test('retries exhausted → FAILED; a permanent provider error fails without retry', async () => {
    const provider = new FakeSideEffectProvider().failNext('unavailable');
    const id = await queuedAction();
    await assert.rejects(run(id, provider, { finalAttempt: true }), RetryLaterError);
    assert.equal(await statusOf(id), 'FAILED');

    const invalid = await queuedAction();
    const rejecting = { execute: async () => Promise.reject(new ValidationError('Recipient address is malformed')) };
    const outcome = await executeExternalAction(prisma.client, { workspaceId: ctx.workspaceId, externalActionId: invalid }, { executors: { [FAKE_SEND_ACTION]: rejecting } });
    assert.equal(outcome, 'FAILED');
    assert.equal(await statusOf(invalid), 'FAILED');
  });

  test('the database refuses to re-run a SUCCEEDED action or edit a domain event', async () => {
    const id = await queuedAction();
    await run(id, new FakeSideEffectProvider());
    await assert.rejects(prisma.client.externalAction.update({ where: { id }, data: { status: 'QUEUED' } }), /already SUCCEEDED/);
    const [event] = await eventsFor(id);
    await assert.rejects(prisma.client.domainEvent.update({ where: { id: event!.id }, data: { eventType: 'Edited' } }), /append-only/);
    await assert.rejects(prisma.client.domainEvent.delete({ where: { id: event!.id } }), /append-only/);
  });

  test('inbox receipt: a redelivered event runs its consumer once, even concurrently', async () => {
    const eventId = newId();
    let effects = 0;
    const consume = () =>
      processOnce(prisma.client, 'test.consumer', eventId, async () => {
        effects++;
        await new Promise((r) => setTimeout(r, 20));
        return 'done';
      });
    const results = await Promise.all([consume(), consume(), consume()]);
    assert.equal(effects, 1);
    assert.equal(results.filter((r) => r.processed).length, 1);
    assert.equal((await consume()).processed, false);
  });

  test('dead letters keep failure, attempts, entity and correlation; a retried job updates the same record', async () => {
    const externalActionId = newId();
    const correlationId = newId();
    const id = await recordDeadLetter(prisma.client, {
      queue: QUEUES.outbound,
      jobName: JOBS.externalActionExecute,
      jobId: 'job-1',
      jobData: { workspaceId: ctx.workspaceId, externalActionId, correlationId, schemaVersion: 1 },
      failureCategory: 'TRANSIENT',
      lastError: 'Fake provider: 503',
      attempts: 6,
    });
    const row = await prisma.client.deadLetterRecord.findUniqueOrThrow({ where: { id } });
    assert.deepEqual([row.entityType, row.entityId, row.correlationId, row.attempts, row.status], ['EXTERNAL_ACTION', externalActionId, correlationId, 6, 'OPEN']);

    const again = await recordDeadLetter(prisma.client, {
      queue: QUEUES.outbound,
      jobName: JOBS.externalActionExecute,
      jobId: 'job-2',
      jobData: { ...(row.jobData as object), deadLetterId: id },
      failureCategory: 'TRANSIENT',
      lastError: 'still down',
      attempts: 6,
    });
    assert.equal(again, id);
    assert.equal((await prisma.client.deadLetterRecord.findUniqueOrThrow({ where: { id } })).lastError, 'still down');
    await resolveDeadLetter(prisma.client, id);
    assert.equal((await prisma.client.deadLetterRecord.findUniqueOrThrow({ where: { id } })).status, 'RESOLVED');
  });
});
