import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { AppConfig } from '@revenue-os/config';
import { executeExternalAction, prepareExternalAction, queueExternalAction, RetryLaterError } from '@revenue-os/events';
import { createEmailSendExecutor, EMAIL_SEND_ACTION, type FakeEmailProvider } from '@revenue-os/providers';
import { createProviderRuntime, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { BusinessRuleError, ConflictError, NotFoundError, ProviderError, ValidationError } from '@revenue-os/shared';
import { hashPassword, newId } from '@revenue-os/shared/server';
import { AppModule } from '../../app.module.js';
import { configureApp } from '../../app-setup.js';
import type { ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';
import { IntegrationService } from './integration.service.js';

const SEND = { from: 'sales@agency.example', to: ['owner@lawns.example'], subject: 'Quick question', text: 'Hi there' };

/**
 * Phase 5 (docs/17 §34-39): integrations, capability health, usage tracking, and the first real capability path —
 * ExternalAction(email.send) → executor → Provider Gateway → fake email provider — with exactly-once semantics.
 */
describe('Phase 5 — provider gateway + integrations', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let storage: string;
  let runtime: ProviderRuntime;
  let service: IntegrationService;

  const newWorkspace = async () => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, {
      name: 'Providers Test',
      slug: uniqueSlug('prov'),
      owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Owner' },
    });
    return { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } } satisfies ServiceContext;
  };
  const eventTypes = async (aggregateId: string) =>
    (await prisma.client.domainEvent.findMany({ where: { aggregateId }, orderBy: { occurredAt: 'asc' } })).map((e) => e.eventType);

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    storage = await mkdtemp(join(tmpdir(), 'rhl-phase5-'));
    // No Redis: in-memory limiter/circuit and mailbox; same Prisma sinks as production wiring.
    runtime = createProviderRuntime(prisma.client, { appEnv: 'test', storagePath: storage });
    service = new IntegrationService(prisma, { APP_ENV: 'test' } as AppConfig, runtime);
  });

  after(async () => {
    await close();
    await rm(storage, { recursive: true, force: true });
  });

  test('catalog: test providers connectable outside production, planned vendors not', () => {
    const catalog = service.catalog();
    assert.equal(catalog.find((p) => p.key === 'fake_email')?.connectable, true);
    assert.equal(catalog.find((p) => p.key === 'gmail')?.connectable, false);
    const prod = new IntegrationService(prisma, { APP_ENV: 'production' } as AppConfig, runtime).catalog();
    assert.equal(prod.find((p) => p.key === 'fake_email')?.connectable, false);
  });

  test('connect: ACTIVE, every capability health-checked, audited, event emitted; no duplicates', async () => {
    const ctx = await newWorkspace();
    const { integration, checks } = await service.connect(ctx, 'fake_email', {});
    assert.equal(integration.status, 'ACTIVE');
    assert.deepEqual(checks?.map((c) => [c.capability, c.state]), [['EMAIL_SEND', 'HEALTHY'], ['EMAIL_READ', 'HEALTHY']]);
    assert.deepEqual(integration.health.map((h) => h.state), ['HEALTHY', 'HEALTHY']);
    assert.ok(integration.lastHealthCheckAt);
    assert.deepEqual(await eventTypes(integration.id), ['IntegrationConnected']);
    const audit = await prisma.client.auditLog.findFirst({ where: { entityId: integration.id, action: 'integration.connected' } });
    assert.ok(audit);
    const record = await prisma.client.providerCallRecord.findFirst({ where: { integrationId: integration.id, operation: 'health_check' } });
    assert.equal(record?.status, 'SUCCEEDED');
    assert.equal(JSON.stringify(integration).includes('credentialRef'), false, 'no credential fields leave the API');

    await assert.rejects(service.connect(ctx, 'fake_email', {}), (e) => e instanceof ConflictError && e.code === 'ALREADY_EXISTS');
    await assert.rejects(service.connect(ctx, 'gmail', {}), (e) => e instanceof ValidationError && /Phase 10/.test(e.message));
    await assert.rejects(service.connect(ctx, 'nope', {}), NotFoundError);
  });

  test('disable stops routing; enable re-checks; disconnect + reconnect keeps the same identity', async () => {
    const ctx = await newWorkspace();
    const { integration } = await service.connect(ctx, 'fake_leads', { name: 'Leads A' });
    const search = () =>
      runtime.gateway.call({ workspaceId: ctx.workspaceId, capability: 'COMPANY_SEARCH', operation: 'search' }, (p, o) =>
        p.searchCompanies({ location: { country: 'US', city: 'Austin' }, industry: 'roofing' }, o),
      );
    assert.ok((await search()).value.observations.length > 0);

    assert.equal((await service.disable(ctx, integration.id)).integration.status, 'DISABLED');
    await assert.rejects(search(), (e) => e instanceof ProviderError && e.code === 'PROVIDER_AUTH_REQUIRED');
    await assert.rejects(service.test(ctx, integration.id), BusinessRuleError);
    await assert.rejects(service.disable(ctx, integration.id), BusinessRuleError);

    assert.equal((await service.enable(ctx, integration.id)).integration.status, 'ACTIVE');
    await search();

    assert.equal((await service.disconnect(ctx, integration.id)).integration.status, 'DISCONNECTED');
    const again = await service.connect(ctx, 'fake_leads', {});
    assert.equal(again.integration.id, integration.id, 'reconnect restores the existing integration');
    assert.equal(again.integration.name, 'Leads A');
    assert.deepEqual(await eventTypes(integration.id), [
      'IntegrationConnected',
      'IntegrationDisabled',
      'IntegrationEnabled',
      'IntegrationDisconnected',
      'IntegrationConnected',
    ]);
    const usage = await service.usage(ctx.workspaceId, 7);
    const row = usage.rows.find((r) => r.capability === 'COMPANY_SEARCH');
    assert.ok(row && row.calls >= 2 && row.units > 0);
  });

  describe('email.send through ExternalAction → gateway → fake mailbox', () => {
    let ctx: ServiceContext;
    let integrationId: string;
    let mailbox: FakeEmailProvider;
    const executors = () => ({ [EMAIL_SEND_ACTION]: createEmailSendExecutor(runtime.gateway) });

    before(async () => {
      ctx = await newWorkspace();
      const { integration } = await service.connect(ctx, 'fake_email', {});
      integrationId = integration.id;
      const row = await prisma.client.integration.findUniqueOrThrow({ where: { id: integrationId } });
      mailbox = runtime.factory.forIntegration(row) as FakeEmailProvider;
    });

    async function queued(payload: Record<string, unknown> = SEND, providerAccountId: string | undefined = integrationId) {
      return prisma.client.$transaction(async (tx) => {
        const { action } = await prepareExternalAction(tx, ctx, {
          actionType: EMAIL_SEND_ACTION,
          provider: 'fake_email',
          providerAccountId,
          entityType: 'WORKSPACE',
          entityId: ctx.workspaceId,
          idempotencyKey: `test:email:${newId()}`,
          payload,
        });
        await queueExternalAction(tx, ctx, action.id);
        return action.id;
      });
    }
    const run = (id: string) => executeExternalAction(prisma.client, { workspaceId: ctx.workspaceId, externalActionId: id }, { executors: executors(), timeoutMs: 2000 });
    const action = (id: string) => prisma.client.externalAction.findUniqueOrThrow({ where: { id } });

    test('sends once, records usage against the entity, and a replay does nothing', async () => {
      const before = mailbox.sends;
      const id = await queued();
      assert.equal(await run(id), 'SUCCEEDED');
      assert.equal(await run(id), 'ALREADY_SUCCEEDED');
      assert.equal(mailbox.sends - before, 1);
      const a = await action(id);
      assert.match(a.responseRef ?? '', /^fake-msg-/);
      const record = await prisma.client.providerCallRecord.findFirstOrThrow({ where: { integrationId, operation: 'send_message' }, orderBy: { startedAt: 'desc' } });
      assert.equal(record.status, 'SUCCEEDED');
      assert.equal(record.entityId, ctx.workspaceId);
      assert.ok(await mailbox.getMessage(a.responseRef!));
    });

    test('lost response → UNKNOWN_OUTCOME → reconciled from the mailbox, still one message', async () => {
      const before = mailbox.sends;
      const id = await queued();
      mailbox.failNext('lost-response');
      await assert.rejects(run(id), RetryLaterError);
      assert.equal((await action(id)).status, 'UNKNOWN_OUTCOME');
      assert.equal(await run(id), 'RECONCILED_SUCCEEDED');
      assert.equal(mailbox.sends - before, 1);
    });

    test('provider refuses credentials → action WAITING, integration AUTH_EXPIRED; recovery → ACTIVE', async () => {
      const id = await queued();
      mailbox.failNext('auth');
      assert.equal(await run(id), 'WAITING');
      let integration = await prisma.client.integration.findUniqueOrThrow({ where: { id: integrationId }, include: { health: true } });
      assert.equal(integration.status, 'AUTH_EXPIRED');
      assert.equal(integration.health.find((h) => h.capability === 'EMAIL_SEND')?.state, 'AUTH_REQUIRED');

      await service.test(ctx, integrationId); // reconnect/health check succeeds
      integration = await prisma.client.integration.findUniqueOrThrow({ where: { id: integrationId }, include: { health: true } });
      assert.equal(integration.status, 'ACTIVE');
      const types = await eventTypes(integrationId);
      assert.ok(types.includes('IntegrationAuthExpired'));
      assert.equal(types.at(-1), 'ProviderRecovered');
    });

    test('a 429 puts the action back in the queue (definitely not sent)', async () => {
      const id = await queued();
      mailbox.failNext('rate-limit');
      await assert.rejects(run(id), (e) => e instanceof RetryLaterError && e.retryAfterMs === 50);
      assert.equal((await action(id)).status, 'QUEUED');
      assert.equal(await run(id), 'SUCCEEDED');
    });

    test('invalid payload fails permanently; a disconnected mailbox makes the action wait', async () => {
      const bad = await queued({ ...SEND, to: ['not-an-email'] });
      assert.equal(await run(bad), 'FAILED');

      const other = await newWorkspace();
      const orphan = await prisma.client.$transaction(async (tx) => {
        const { action } = await prepareExternalAction(tx, other, {
          actionType: EMAIL_SEND_ACTION,
          provider: 'fake_email',
          entityType: 'WORKSPACE',
          entityId: other.workspaceId,
          idempotencyKey: `test:email:${newId()}`,
          payload: SEND,
        });
        await queueExternalAction(tx, other, action.id);
        return action.id;
      });
      const outcome = await executeExternalAction(prisma.client, { workspaceId: other.workspaceId, externalActionId: orphan }, { executors: executors() });
      assert.equal(outcome, 'WAITING');
      assert.match((await action(orphan)).statusReason ?? '', /No connected integration provides EMAIL_SEND/);
    });
  });

  describe('HTTP + permissions', () => {
    let app: INestApplication;
    let base: string;
    let owner: string, viewer: string;
    const PASSWORD = 'green lawns in austin';
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) =>
      fetch(`${base}/api/v1${path}`, { ...init, headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...(init.cookie ? { cookie: init.cookie } : {}) } });
    const login = async (email: string) => {
      const res = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email, password: PASSWORD }) });
      assert.equal(res.status, 200);
      return res.headers.get('set-cookie')!.split(';')[0]!;
    };

    before(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
      app = moduleRef.createNestApplication({ logger: false });
      configureApp(app);
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');

      const workspaces = new WorkspaceService(prisma);
      owner = `${uniqueSlug('owner')}@example.com`;
      viewer = `${uniqueSlug('viewer')}@example.com`;
      const ws = await workspaces.createWorkspace(SYSTEM_ACTOR, { name: 'Integrations HTTP', slug: uniqueSlug('ihttp'), owner: { email: owner, name: 'Owner' } });
      await workspaces.addMember({ workspaceId: ws.workspace.id, actor: SYSTEM_ACTOR }, { email: viewer, name: 'Viewer', role: 'VIEWER' });
      await prisma.client.user.updateMany({ where: { email: { in: [owner, viewer] } }, data: { passwordHash: await hashPassword(PASSWORD), status: 'ACTIVE' } });
      await prisma.client.workspaceMember.updateMany({ where: { workspaceId: ws.workspace.id }, data: { status: 'ACTIVE' } });
    });

    after(async () => app.close());

    test('viewer can read integrations but not connect; owner connects, tests and disconnects', async () => {
      const viewerCookie = await login(viewer);
      assert.equal((await call('/integrations', { cookie: viewerCookie })).status, 200);
      assert.equal((await call('/integrations/fake_calendar/connect', { method: 'POST', cookie: viewerCookie, body: '{}' })).status, 403);

      const cookie = await login(owner);
      const connected = await call('/integrations/fake_calendar/connect', { method: 'POST', cookie, body: '{}' });
      assert.equal(connected.status, 201);
      const { integration } = ((await connected.json()) as any).data;
      assert.equal((await call(`/integrations/${integration.id}/test`, { method: 'POST', cookie, body: '{}' })).status, 201);
      const list = ((await (await call('/integrations', { cookie })).json()) as any).data;
      assert.equal(list[0].usage24h.calls >= 2, true);
      assert.equal(list[0].usage24h.costMinor, null, 'free provider reports no cost — shown as unknown, not invented');
      assert.equal((await call(`/integrations/${integration.id}`, { method: 'DELETE', cookie })).status, 200);
      assert.equal((await call('/integrations/gmail/connect', { method: 'POST', cookie, body: '{}' })).status, 400);
      assert.equal((await call('/integrations/BAD KEY/connect', { method: 'POST', cookie, body: '{}' })).status, 400);
    });
  });
});
