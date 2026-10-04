import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { prepareExternalAction, queueExternalAction } from '@revenue-os/events';
import { createQueueWorker, externalActionHandlers, QueueProducer, startHeartbeat, startOutboxLoop, WorkerMetrics, type OutboxLoop } from '@revenue-os/events/runtime';
import { FAKE_SEND_ACTION, FakeSideEffectProvider, MemoryFakeProviderStore } from '@revenue-os/events/testing';
import { JOBS, QUEUES, queuePrefix } from '@revenue-os/shared';
import { createLogger, hashPassword, newId } from '@revenue-os/shared/server';
import type { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { AppModule } from '../../app.module.js';
import { configureApp } from '../../app-setup.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'green lawns in austin';

/**
 * Phase 4 Definition of Done (docs/17 §26-33), for real:
 * HTTP command → DB transaction → Outbox → Dispatcher → BullMQ (Redis) → Worker → Fake provider → Result → Event.
 * Runs with APP_ENV=test so its queues (rhl:test:*) never mix with a running dev worker's.
 */
describe('Phase 4 — end-to-end event pipeline', () => {
  let app: INestApplication;
  let base: string;
  let cleanup: () => Promise<void>;
  let owner: string, sales: string, viewer: string, workspaceId: string;
  let store: MemoryFakeProviderStore;
  let prisma: PrismaService;

  const call = (path: string, init: RequestInit & { cookie?: string } = {}) =>
    fetch(`${base}/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', origin: ORIGIN, ...(init.cookie ? { cookie: init.cookie } : {}) },
    });
  const login = async (email: string) => {
    const res = await call('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password: PASSWORD }) });
    assert.equal(res.status, 200);
    return res.headers.get('set-cookie')!.split(';')[0]!;
  };
  const json = async (res: Response) => ((await res.json()) as any).data;
  async function waitFor<T>(fn: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await fn();
      if (done(value)) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting; last value: ${JSON.stringify(value)}`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    const db = await setupTestDatabase();
    prisma = db.prisma;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApp(app);
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');

    // The worker side, wired exactly like apps/worker but with an in-memory fake provider we can inspect.
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380';
    const prefix = queuePrefix('test');
    const producer = new QueueProducer(redisUrl, prefix);
    await Promise.all([QUEUES.outbound, QUEUES.maintenance].map((q) => producer.queue(q).obliterate({ force: true })));
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const logger = createLogger({ service: 'worker-test', level: 'fatal' });
    const metrics = new WorkerMetrics();
    store = new MemoryFakeProviderStore();
    const handlers = externalActionHandlers(prisma.client, { executors: { [FAKE_SEND_ACTION]: new FakeSideEffectProvider(store, 20) } });
    const workers: Worker[] = [
      createQueueWorker({ queue: QUEUES.outbound, prefix, connection, db: prisma.client, logger, metrics, handlers: { [JOBS.externalActionExecute]: handlers[JOBS.externalActionExecute] } }),
    ];
    const outbox: OutboxLoop = startOutboxLoop(prisma.client, producer.publish, logger, { idleMs: 100 });
    const heartbeat = startHeartbeat(connection, prefix, { workerId: 'e2e-worker', queues: [QUEUES.outbound] }, metrics);

    cleanup = async () => {
      await outbox.stop();
      await Promise.all(workers.map((w) => w.close()));
      await heartbeat.stop();
      await producer.close();
      connection.disconnect();
      await app.close();
      await db.close();
    };

    const workspaces = new WorkspaceService(prisma);
    owner = `${uniqueSlug('owner')}@example.com`;
    sales = `${uniqueSlug('sales')}@example.com`;
    viewer = `${uniqueSlug('viewer')}@example.com`;
    const ws = await workspaces.createWorkspace(SYSTEM_ACTOR, { name: 'Pipeline E2E', slug: uniqueSlug('pipe'), owner: { email: owner, name: 'Owner' } });
    workspaceId = ws.workspace.id;
    await workspaces.addMember({ workspaceId, actor: SYSTEM_ACTOR }, { email: sales, name: 'Sales', role: 'SALES' });
    await workspaces.addMember({ workspaceId, actor: SYSTEM_ACTOR }, { email: viewer, name: 'Viewer', role: 'VIEWER' });
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.client.user.updateMany({ where: { email: { in: [owner, sales, viewer] } }, data: { passwordHash, status: 'ACTIVE' } });
    await prisma.client.workspaceMember.updateMany({ where: { workspaceId }, data: { status: 'ACTIVE' } });
  });

  after(async () => cleanup());

  test('API command → outbox → dispatcher → BullMQ → worker → fake provider → SUCCEEDED + events', async () => {
    const cookie = await login(owner);
    const res = await call('/v1/system/pipeline/test', { method: 'POST', cookie, body: '{}' });
    assert.equal(res.status, 201);
    const { externalActionId, correlationId } = await json(res);
    assert.ok(correlationId);

    const detail = await waitFor(
      async () => json(await call(`/v1/system/external-actions/${externalActionId}`, { cookie })),
      (d) => d.action.status === 'SUCCEEDED',
    );
    assert.equal(detail.action.attemptCount, 1);
    assert.match(detail.action.responseRef, /^fake-/);
    assert.deepEqual(
      detail.events.map((e: any) => e.eventType),
      ['ExternalActionPrepared', 'ExternalActionQueued', 'ExternalActionSucceeded'],
    );
    const action = await prisma.client.externalAction.findUniqueOrThrow({ where: { id: externalActionId } });
    assert.equal(store.calls.get(action.idempotencyKey), 1, 'provider acted exactly once');
  });

  test('lost provider response: retried by BullMQ, reconciled, still exactly one effect', async () => {
    const cookie = await login(owner);
    const { externalActionId } = await json(await call('/v1/system/pipeline/test', { method: 'POST', cookie, body: JSON.stringify({ simulate: 'lost-response' }) }));
    const detail = await waitFor(
      async () => json(await call(`/v1/system/external-actions/${externalActionId}`, { cookie })),
      (d) => d.action.status === 'SUCCEEDED',
    );
    assert.equal(detail.action.statusReason, 'Reconciled with provider');
    const action = await prisma.client.externalAction.findUniqueOrThrow({ where: { id: externalActionId } });
    assert.equal(store.calls.get(action.idempotencyKey), 1);
  });

  test('a permanently failing job lands in the DLQ; admins can inspect, retry and dismiss it', async () => {
    const cookie = await login(owner);
    // An action type no executor knows → PermanentError → dead letter without retries.
    const ctx = { workspaceId, actor: SYSTEM_ACTOR };
    const id = await prisma.client.$transaction(async (tx) => {
      const { action } = await prepareExternalAction(tx, ctx, {
        actionType: 'unsupported.channel',
        provider: 'none',
        entityType: 'WORKSPACE',
        entityId: workspaceId,
        idempotencyKey: `test:${newId()}`,
        payload: {},
      });
      await queueExternalAction(tx, ctx, action.id);
      return action.id;
    });

    const findMine = async () => ((await json(await call('/v1/system/dead-letters', { cookie }))) as any[]).find((d) => d.entityId === id);
    const dead = await waitFor(findMine, (d) => d !== undefined);
    assert.equal(dead.failureCategory, 'PERMANENT');
    assert.equal(dead.attempts, 1);
    assert.match(dead.lastError, /No executor registered/);
    assert.equal(dead.entityType, 'EXTERNAL_ACTION');
    assert.ok(dead.correlationId);

    const retry = await call(`/v1/system/dead-letters/${dead.id}/retry`, { method: 'POST', cookie });
    assert.equal(retry.status, 201);
    const again = await waitFor(
      () => prisma.client.deadLetterRecord.findUniqueOrThrow({ where: { id: dead.id } }),
      (d) => d.status === 'OPEN' && d.retryCount === 1,
    );
    assert.equal(again.retryCount, 1, 'the retry failed again and updated the same record');

    const ignore = await call(`/v1/system/dead-letters/${dead.id}/ignore`, { method: 'POST', cookie, body: JSON.stringify({ note: 'channel not supported' }) });
    assert.equal(ignore.status, 201);
    assert.equal((await prisma.client.deadLetterRecord.findUniqueOrThrow({ where: { id: dead.id } })).status, 'IGNORED');
    assert.equal(await prisma.client.auditLog.count({ where: { workspaceId, action: { in: ['dead_letter.retried', 'dead_letter.ignored'] } } }), 2);
  });

  test('pipeline overview shows outbox, actions, workers and queues', async () => {
    const cookie = await login(owner);
    const overview = await json(await call('/v1/system/pipeline', { cookie }));
    assert.ok(overview.externalActions.SUCCEEDED >= 2);
    assert.ok(overview.workers.some((w: any) => w.workerId === 'e2e-worker'));
    assert.deepEqual(overview.queues.map((q: any) => q.name).sort(), ['maintenance', 'outbound']);
  });

  test('system routes are permissioned: sales cannot read, viewer cannot run the test', async () => {
    assert.equal((await call('/v1/system/pipeline', { cookie: await login(sales) })).status, 403);
    const viewerCookie = await login(viewer);
    assert.equal((await call('/v1/system/pipeline/test', { method: 'POST', cookie: viewerCookie, body: '{}' })).status, 403);
    assert.equal((await call('/v1/system/dead-letters', { cookie: viewerCookie })).status, 403);
  });
});
