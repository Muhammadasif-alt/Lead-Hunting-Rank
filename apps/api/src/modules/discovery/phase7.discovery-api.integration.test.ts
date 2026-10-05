import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BusinessRuleError, ConflictError, PERMISSION_KEYS, ValidationError } from '@revenue-os/shared';
import { hashPassword } from '@revenue-os/shared/server';
import { AppModule } from '../../app.module.js';
import { configureApp } from '../../app-setup.js';
import type { ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { CompanyService } from '../crm/company.service.js';
import { EntityResolutionService } from '../crm/entity-resolution.service.js';
import { WorkspaceService } from '../identity/workspace.service.js';
import { DiscoveryQueryService } from './discovery.query.js';
import { DiscoveryService } from './discovery.service.js';

const ALL = new Set(PERMISSION_KEYS);
const AUSTIN = { industry: 'landscapers', country: 'US', region: 'TX', city: 'Austin' };

/**
 * Phase 7 (docs/17 §46-51): the Lead Hunter API. A person previews (no writes), starts one mission per market,
 * pauses / resumes / stops it with optimistic concurrency, and reads results grouped per canonical company.
 */
describe('Phase 7 — Lead Hunter API', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let discovery: DiscoveryService, query: DiscoveryQueryService, companies: CompanyService;

  const newWorkspace = async () => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, {
      name: 'Hunter Test',
      slug: uniqueSlug('hunt'),
      owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Owner' },
    });
    return { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } } satisfies ServiceContext;
  };
  const connect = (workspaceId: string, provider: string, extra: { status?: 'ACTIVE' | 'DISABLED'; accountRef?: string; connectedAt?: Date; name?: string } = {}) =>
    prisma.client.integration.create({
      data: {
        workspaceId,
        provider,
        category: 'LEAD_DATA',
        name: extra.name ?? provider,
        capabilities: ['COMPANY_SEARCH'],
        status: extra.status ?? 'ACTIVE',
        accountRef: extra.accountRef ?? 'default',
        connectedAt: extra.connectedAt ?? new Date(),
      },
    });
  const mission = (id: string) => prisma.client.discoveryMission.findUniqueOrThrow({ where: { id } });

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    query = new DiscoveryQueryService(prisma);
    discovery = new DiscoveryService(prisma, query);
    companies = new CompanyService(prisma, new EntityResolutionService(prisma));
  });

  after(async () => close());

  test('preview understands a typed request, lists connected sources and writes nothing', async () => {
    const ctx = await newWorkspace();
    const leads = await connect(ctx.workspaceId, 'fake_leads', { name: 'Test lead source', connectedAt: new Date(Date.now() - 60_000) });
    await prisma.client.integrationCapabilityHealth.create({ data: { workspaceId: ctx.workspaceId, integrationId: leads.id, capability: 'COMPANY_SEARCH', state: 'HEALTHY' } });
    const dir = await connect(ctx.workspaceId, 'fake_directory', { name: 'Test business directory' });
    await connect(ctx.workspaceId, 'fake_directory', { status: 'DISABLED', accountRef: 'old' });

    const p = await discovery.preview(ctx, { request: 'Austin, Texas ke landscapers Market Exhaust mode mein find karo' });
    assert.equal(p.interpretation?.industry, 'landscaping');
    assert.deepEqual(p.interpretation?.missing, []);
    assert.equal(p.mode, 'MARKET_EXHAUST');
    assert.deepEqual([p.market.country, p.market.region, p.market.city], ['US', 'TX', 'Austin']);
    assert.equal(p.market.industryLabel, 'Landscaping');
    assert.equal(p.market.name, 'Landscaping · Austin, TX');
    assert.equal(p.market.existingMarketId, null);
    assert.equal(p.market.runningMissionId, null);
    assert.deepEqual(
      p.sources.map((s) => [s.integrationId, s.provider, s.health]),
      [
        [leads.id, 'fake_leads', 'HEALTHY'],
        [dir.id, 'fake_directory', 'UNKNOWN'],
      ],
      'disabled integration is not a source; routing order kept',
    );
    assert.equal(p.categories.available.length, 8);
    assert.deepEqual(p.categories.selected, p.categories.available, 'deeper modes search every related category by default');
    assert.equal(p.strategies, 2 * (1 + 8 + 5 + 3), 'primary + related + keyword + geo variants on both sources');
    assert.equal(p.profile.maxRounds, 8);
    assert.equal(await prisma.client.market.count({ where: { workspaceId: ctx.workspaceId } }), 0, 'preview writes nothing');

    // Explicit fields win; the "same market typed differently" resolves to the same key.
    const q = await discovery.preview(ctx, { industry: 'Landscaping', country: 'us', region: 'TX', city: 'Austin', mode: 'QUICK' });
    assert.equal(q.market.marketKey, p.market.marketKey);
    assert.deepEqual(q.categories.selected, [], 'Quick Hunt searches the main category only');
    assert.equal(q.strategies, 1);

    // Request together with structured fields: explicit fields win, the text only fills the gaps.
    const mixed = await discovery.preview(ctx, { request: 'Austin, Texas ke landscapers Market Exhaust mode mein find karo', industry: 'roofers', city: 'Round Rock' });
    assert.deepEqual([mixed.market.industry, mixed.market.country, mixed.market.region, mixed.market.city, mixed.mode], ['roofers', 'US', 'TX', 'Round Rock', 'MARKET_EXHAUST']);
    const uk = await discovery.preview(ctx, { request: 'Austin, Texas ke landscapers', country: 'GB', mode: 'DEEP' });
    assert.deepEqual([uk.market.country, uk.market.region, uk.market.city, uk.mode], ['GB', null, null, 'DEEP'], 'no Texas inherited into another country');

    await assert.rejects(discovery.preview(ctx, { request: 'find me some stuff' }), (e) => e instanceof ValidationError && e.details!.map((d) => d.path).join() === 'industry,country');
    await assert.rejects(discovery.preview(ctx, { ...AUSTIN, categories: ['pizza'] }), ValidationError);

    const empty = await newWorkspace();
    const none = await discovery.preview(empty, AUSTIN);
    assert.deepEqual(none.sources, []);
    assert.ok(none.warnings.some((w) => w.includes('No lead source connected')));
  });

  test('start creates the market once; one active mission per market; a finished market can be hunted again', async () => {
    const ctx = await newWorkspace();
    const first = await discovery.start(ctx, { ...AUSTIN, mode: 'MARKET_EXHAUST', request: 'Austin landscapers', categories: ['lawn care', 'Irrigation'] });
    assert.equal(first.status, 'PLANNING');
    assert.equal(first.mode, 'MARKET_EXHAUST');
    assert.deepEqual(first.categories, ['lawn care', 'irrigation']);
    assert.deepEqual([first.maxRounds, first.maxQueries, first.maxProviderCalls], [8, 80, 500]);
    assert.equal(first.createdBy?.name, 'Owner');
    assert.ok(first.startedAt);
    assert.equal(first.market.name, 'Landscaping · Austin, TX');

    const started = await prisma.client.domainEvent.findMany({ where: { aggregateId: first.id } });
    assert.deepEqual(started.map((e) => e.eventType), ['DiscoveryMissionStarted']);
    assert.ok((await prisma.client.outboxEvent.count({ where: { aggregateId: first.id, eventType: 'DiscoveryMissionStarted' } })) >= 1, 'outbox row routes the advance job');
    assert.equal(await prisma.client.domainEvent.count({ where: { aggregateId: first.marketId, eventType: 'MarketCreated' } }), 1);
    assert.equal(await prisma.client.auditLog.count({ where: { entityId: first.id, action: 'discovery_mission.started' } }), 1);

    await assert.rejects(discovery.start(ctx, { industry: 'landscaping', country: 'US', region: 'TX', city: 'Austin', mode: 'QUICK' }), (e) => e instanceof ConflictError && e.code === 'MISSION_ALREADY_RUNNING');

    // Paused still counts as active.
    const paused = await discovery.pause(ctx, first.id, first.version);
    await assert.rejects(discovery.start(ctx, { ...AUSTIN, mode: 'QUICK' }), (e) => e instanceof ConflictError && e.code === 'MISSION_ALREADY_RUNNING');

    await discovery.stop(ctx, first.id, paused.version);
    const again = await discovery.start(ctx, { ...AUSTIN, mode: 'QUICK' });
    assert.equal(again.marketId, first.marketId, 'same market reused');
    assert.deepEqual(again.categories, []);
    assert.equal(await prisma.client.market.count({ where: { workspaceId: ctx.workspaceId } }), 1);
    assert.equal(await prisma.client.domainEvent.count({ where: { workspaceId: ctx.workspaceId, eventType: 'MarketCreated' } }), 1);

    // Concurrent starts of a brand-new market → exactly one wins (advisory lock), one market row.
    const dallas = { industry: 'roofers', country: 'US', region: 'TX', city: 'Dallas', mode: 'DEEP' as const };
    const results = await Promise.allSettled([discovery.start(ctx, dallas), discovery.start(ctx, dallas), discovery.start(ctx, dallas)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of results) if (r.status === 'rejected') assert.ok(r.reason instanceof ConflictError && r.reason.code === 'MISSION_ALREADY_RUNNING', String(r.status === 'rejected' && r.reason));
    assert.equal(await prisma.client.market.count({ where: { workspaceId: ctx.workspaceId } }), 2);

    const markets = await query.markets(ctx.workspaceId);
    const austin = markets.items.find((m) => m.id === first.marketId)!;
    assert.equal(austin.missions, 2);
    assert.equal(austin.latestMission?.id, again.id);
    assert.ok(austin.lastDiscoveryAt, 'stop records the last discovery');
  });

  test('pause → resume restores the phase; stale versions conflict; stop completes with honest coverage', async () => {
    const ctx = await newWorkspace();
    const m = await discovery.start(ctx, { ...AUSTIN, mode: 'DEEP' });
    await prisma.client.discoveryMission.update({ where: { id: m.id }, data: { status: 'DISCOVERING' } }); // engine moved on

    const paused = await discovery.pause(ctx, m.id, m.version);
    assert.equal(paused.status, 'PAUSED');
    assert.equal((await mission(m.id)).resumeStatus, 'DISCOVERING');
    assert.equal(paused.version, m.version + 1);
    await assert.rejects(discovery.resume(ctx, m.id, m.version), (e) => e instanceof ConflictError && e.code === 'VERSION_CONFLICT');
    await assert.rejects(discovery.pause(ctx, m.id, paused.version), BusinessRuleError, 'already paused');

    const resumed = await discovery.resume(ctx, m.id, paused.version);
    assert.equal(resumed.status, 'DISCOVERING');
    assert.equal(resumed.statusReason, null);
    assert.equal((await mission(m.id)).resumeStatus, null);

    // WAITING keeps the phase the engine remembered.
    await prisma.client.discoveryMission.update({ where: { id: m.id }, data: { status: 'WAITING', resumeStatus: 'RESOLVING', retryAt: new Date(Date.now() + 60_000), statusReason: 'Rate limited' } });
    const p2 = await discovery.pause(ctx, m.id, resumed.version);
    assert.equal((await mission(m.id)).resumeStatus, 'RESOLVING');
    assert.equal(p2.retryAt, null);
    const r2 = await discovery.resume(ctx, m.id, p2.version);
    assert.equal(r2.status, 'RESOLVING');

    const events = await prisma.client.domainEvent.findMany({ where: { aggregateId: m.id } });
    assert.deepEqual(events.map((e) => e.eventType).sort(), ['DiscoveryMissionPaused', 'DiscoveryMissionPaused', 'DiscoveryMissionResumed', 'DiscoveryMissionResumed', 'DiscoveryMissionStarted']);
    const audit = await prisma.client.auditLog.findMany({ where: { entityId: m.id, entityType: 'DISCOVERY_MISSION' } });
    assert.equal(audit.length, 5);

    // Stop with no measured rounds → LOW confidence, never "complete coverage".
    const stopped = await discovery.stop(ctx, m.id, r2.version);
    assert.equal(stopped.status, 'COMPLETED');
    assert.equal(stopped.stopReason, 'STOPPED_BY_USER');
    assert.equal(stopped.coverageConfidence, 'LOW');
    assert.ok(stopped.completedAt);
    const done = await prisma.client.domainEvent.findFirstOrThrow({ where: { aggregateId: m.id, eventType: 'DiscoveryMissionCompleted' } });
    assert.equal((done.payload as { stopReason: string }).stopReason, 'STOPPED_BY_USER');
    await assert.rejects(discovery.pause(ctx, m.id, stopped.version), BusinessRuleError, 'terminal mission cannot be paused');
    await assert.rejects(discovery.resume(ctx, m.id, stopped.version), BusinessRuleError);
    await assert.rejects(discovery.stop(ctx, m.id, stopped.version), BusinessRuleError);
    const detail = await query.detail(ctx.workspaceId, m.id, ALL);
    assert.deepEqual(detail.allowedActions, []);
  });

  test('stop assesses coverage from the rounds already measured', async () => {
    const ctx = await newWorkspace();
    const m = await discovery.start(ctx, { ...AUSTIN, mode: 'DEEP' });
    await prisma.client.discoveryMission.update({ where: { id: m.id }, data: { status: 'PLANNING', currentRound: 2, observationsCount: 30, uniqueCompanies: 11, sourcesUsed: ['fake_leads', 'fake_directory'] } });
    const base = { workspaceId: ctx.workspaceId, missionId: m.id, marginalYield: 0, duplicateRate: 0, confidence: 'LOW' as const, decision: 'CONTINUE' as const, reasons: [], strategiesRemaining: 6 };
    await prisma.client.coverageAssessment.createMany({
      data: [
        { ...base, round: 1, queries: 2, observations: 15, newUnique: 10, cumulativeUnique: 10 },
        { ...base, round: 2, queries: 2, observations: 15, newUnique: 1, cumulativeUnique: 11 },
      ],
    });
    const detail = await query.detail(ctx.workspaceId, m.id, ALL);
    assert.deepEqual(detail.rounds.map((r) => r.round), [1, 2]);
    assert.deepEqual(detail.allowedActions, ['pause', 'stop']);
    assert.deepEqual((await query.detail(ctx.workspaceId, m.id, new Set(['market.read']))).allowedActions, []);

    const stopped = await discovery.stop(ctx, m.id, m.version);
    assert.equal(stopped.coverageConfidence, 'MEDIUM', 'two rounds, slowing down, not saturated → medium');
  });

  test('companies: one row per canonical company with outcome, sources, listings; filters and pagination', async () => {
    const ctx = await newWorkspace();
    const m = await discovery.start(ctx, { ...AUSTIN, mode: 'DEEP' });
    const alpha = await companies.create(ctx, { displayName: 'Alpha Lawn Care', website: 'alphalawn.com', phone: '512 555 0101', city: 'Austin', region: 'TX', country: 'US' });
    const bravo = await companies.create(ctx, { displayName: 'Bravo Turf', phone: '512 555 0102', city: 'Austin', region: 'TX', country: 'US' });
    const charlie = await companies.create(ctx, { displayName: 'Charlie Tree Service', website: 'charlietrees.com', city: 'Austin', region: 'TX', country: 'US' });
    const charlieOld = await companies.create(ctx, { displayName: 'Charlie Trees (old listing)', city: 'Round Rock', region: 'TX', country: 'US' });
    await prisma.client.company.update({ where: { id: charlieOld.id }, data: { mergedIntoId: charlie.id, mergedAt: new Date(), status: 'ARCHIVED', archivedAt: new Date() } });
    const other = await companies.create(ctx, { displayName: 'Delta Pending', city: 'Austin', country: 'US' });

    const mkQuery = (provider: string, round: number) =>
      prisma.client.discoveryQuery.create({
        data: { workspaceId: ctx.workspaceId, missionId: m.id, round, queryType: 'PRIMARY_CATEGORY', strategyKey: `PRIMARY_CATEGORY:landscaping:${round}`, queryText: 'landscaping — Austin, TX', category: 'landscaping', provider, pageLimit: 4, status: 'COMPLETED' },
      });
    const [q1, q2, q3] = await Promise.all([mkQuery('fake_leads', 1), mkQuery('fake_directory', 2), mkQuery('fake_leads', 2)]);
    let n = 0;
    const obs = (q: { id: string; provider: string; round: number }, companyId: string | null, extra: Record<string, unknown>) => ({
      workspaceId: ctx.workspaceId,
      missionId: m.id,
      queryId: q.id,
      round: q.round,
      provider: q.provider,
      sourceRecordId: `rec-${++n}`,
      name: 'x',
      rawPayload: {},
      observedAt: new Date(),
      status: 'RESOLVED' as const,
      companyId,
      ...extra,
    });
    await prisma.client.discoveryObservation.createMany({
      data: [
        obs(q1!, alpha.id, { outcome: 'CREATED' }),
        obs(q2!, alpha.id, { outcome: 'DUPLICATE_LISTING', flaggedForReview: true }),
        obs(q1!, bravo.id, { outcome: 'MATCHED_EXISTING' }),
        obs(q3!, charlie.id, { outcome: 'CREATED' }),
        obs(q2!, charlieOld.id, { outcome: 'MATCHED_EXISTING' }),
        obs(q1!, other.id, { status: 'PENDING', outcome: null }),
        obs(q1!, null, { status: 'REJECTED', outcome: null, rejectReason: 'Outside territory' }),
      ],
    });

    const all = await query.companies(ctx.workspaceId, m.id, { website: 'any', phone: 'any', limit: 50 });
    assert.equal(all.total, 3);
    assert.deepEqual(all.items.map((i) => i.displayName), ['Alpha Lawn Care', 'Bravo Turf', 'Charlie Tree Service']);
    const [a, b, c] = all.items;
    assert.deepEqual([a!.outcome, a!.listings, a!.firstRound, a!.flaggedForReview], ['CREATED', 2, 1, true]);
    assert.deepEqual(a!.sources, ['Test business directory', 'Test lead source']);
    assert.equal(a!.websiteDomain, 'alphalawn.com');
    assert.deepEqual([b!.outcome, b!.listings, b!.flaggedForReview], ['MATCHED_EXISTING', 1, false]);
    assert.deepEqual([c!.companyId, c!.outcome, c!.listings, c!.firstRound], [charlie.id, 'CREATED', 2, 2], 'merged record counts as its survivor');
    assert.equal(all.nextCursor, null);

    const names = async (q: Partial<Parameters<DiscoveryQueryService['companies']>[2]>) =>
      (await query.companies(ctx.workspaceId, m.id, { website: 'any', phone: 'any', limit: 50, ...q })).items.map((i) => i.displayName);
    assert.deepEqual(await names({ website: 'without' }), ['Bravo Turf']);
    assert.deepEqual(await names({ website: 'with' }), ['Alpha Lawn Care', 'Charlie Tree Service']);
    assert.deepEqual(await names({ phone: 'with' }), ['Alpha Lawn Care', 'Bravo Turf']);
    assert.deepEqual(await names({ outcome: 'MATCHED_EXISTING' }), ['Bravo Turf']);
    assert.deepEqual(await names({ outcome: 'CREATED', website: 'with' }), ['Alpha Lawn Care', 'Charlie Tree Service']);
    assert.deepEqual(await names({ q: 'char' }), ['Charlie Tree Service']);
    assert.deepEqual(await names({ q: '100%_' }), []);

    const p1 = await query.companies(ctx.workspaceId, m.id, { website: 'any', phone: 'any', limit: 2 });
    assert.equal(p1.items.length, 2);
    assert.equal(p1.total, 3);
    assert.ok(p1.nextCursor);
    const p2 = await query.companies(ctx.workspaceId, m.id, { website: 'any', phone: 'any', limit: 2, cursor: p1.nextCursor! });
    assert.deepEqual(p2.items.map((i) => i.displayName), ['Charlie Tree Service']);
    assert.equal(p2.total, 3);
    assert.equal(p2.nextCursor, null);
    await assert.rejects(query.companies(ctx.workspaceId, m.id, { website: 'any', phone: 'any', limit: 2, cursor: 'garbage' }), ValidationError);

    const detail = await query.detail(ctx.workspaceId, m.id, ALL);
    const leads = detail.sources.find((s) => s.provider === 'fake_leads')!;
    assert.deepEqual([leads.name, leads.queries, leads.observations, leads.uniqueCompanies], ['Test lead source', 2, 5, 3]);
    assert.equal(detail.queries.length, 3);
    assert.equal(detail.queries[0]!.providerName.startsWith('Test'), true);

    // Workspace isolation.
    const stranger = await newWorkspace();
    await assert.rejects(query.companies(stranger.workspaceId, m.id, { website: 'any', phone: 'any', limit: 10 }), /not found/);
  });

  describe('HTTP + permissions', () => {
    let app: INestApplication;
    let base: string;
    let workspaceId: string;
    const PASSWORD = 'green lawns in austin';
    const emails: Record<string, string> = {};
    const call = (path: string, init: RequestInit & { cookie?: string } = {}) =>
      fetch(`${base}/api/v1${path}`, { ...init, headers: { 'content-type': 'application/json', origin: 'http://localhost:3000', ...(init.cookie ? { cookie: init.cookie } : {}) } });
    const login = async (role: string) => {
      const res = await call('/auth/login', { method: 'POST', body: JSON.stringify({ email: emails[role], password: PASSWORD }) });
      assert.equal(res.status, 200);
      return res.headers.get('set-cookie')!.split(';')[0]!;
    };
    const json = async (res: Response) => ((await res.json()) as { data: any }).data;

    before(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
      app = moduleRef.createNestApplication({ logger: false });
      configureApp(app);
      await app.listen(0);
      base = (await app.getUrl()).replace('[::1]', 'localhost');

      const workspaces = new WorkspaceService(prisma);
      for (const r of ['owner', 'viewer', 'researcher']) emails[r] = `${uniqueSlug(r)}@example.com`;
      const ws = await workspaces.createWorkspace(SYSTEM_ACTOR, { name: 'Hunter HTTP', slug: uniqueSlug('hunthttp'), owner: { email: emails.owner!, name: 'Owner' } });
      workspaceId = ws.workspace.id;
      for (const [r, role] of [['viewer', 'VIEWER'], ['researcher', 'RESEARCHER']] as const) {
        await workspaces.addMember({ workspaceId, actor: SYSTEM_ACTOR }, { email: emails[r]!, name: r, role });
      }
      await prisma.client.user.updateMany({ where: { email: { in: Object.values(emails) } }, data: { passwordHash: await hashPassword(PASSWORD), status: 'ACTIVE' } });
      await prisma.client.workspaceMember.updateMany({ where: { workspaceId }, data: { status: 'ACTIVE' } });
      await connect(workspaceId, 'fake_leads');
    });

    after(async () => app.close());

    test('viewers read, researchers run; commands are version-checked over HTTP', async () => {
      const viewer = await login('viewer');
      const researcher = await login('researcher');
      const body = JSON.stringify({ ...AUSTIN, mode: 'QUICK' });

      assert.equal((await call('/discovery-missions', { cookie: viewer })).status, 200);
      const preview = await call('/discovery-missions/preview', { method: 'POST', cookie: viewer, body: JSON.stringify({ request: 'Austin, Texas ke landscapers Market Exhaust mode mein find karo' }) });
      assert.equal(preview.status, 200);
      assert.equal((await json(preview)).sources.length, 1);
      assert.equal((await call('/discovery-missions', { method: 'POST', cookie: viewer, body })).status, 403);
      assert.equal((await call('/discovery-missions', { method: 'POST', cookie: researcher, body: JSON.stringify({ ...AUSTIN, mode: 'QUICK', workspaceId }) })).status, 400, 'no mass-assignment');

      const started = await call('/discovery-missions', { method: 'POST', cookie: researcher, body });
      assert.equal(started.status, 202);
      const { mission } = await json(started);
      assert.equal(mission.status, 'PLANNING');
      assert.equal(mission.createdBy.name, 'researcher');
      const dup = await call('/discovery-missions', { method: 'POST', cookie: researcher, body });
      assert.equal(dup.status, 409);
      assert.equal(((await dup.json()) as { error: { code: string } }).error.code, 'MISSION_ALREADY_RUNNING');

      const list = await json(await call('/discovery-missions', { cookie: viewer }));
      assert.equal(list.items[0].id, mission.id);
      const asViewer = await json(await call(`/discovery-missions/${mission.id}`, { cookie: viewer }));
      assert.deepEqual(asViewer.allowedActions, []);
      const asResearcher = await json(await call(`/discovery-missions/${mission.id}`, { cookie: researcher }));
      assert.deepEqual(asResearcher.allowedActions, ['pause', 'stop']);

      assert.equal((await call(`/discovery-missions/${mission.id}/pause`, { method: 'POST', cookie: viewer, body: JSON.stringify({ version: mission.version }) })).status, 403);
      const paused = await call(`/discovery-missions/${mission.id}/pause`, { method: 'POST', cookie: researcher, body: JSON.stringify({ version: mission.version }) });
      assert.equal(paused.status, 200);
      assert.equal((await json(paused)).status, 'PAUSED');
      assert.equal((await call(`/discovery-missions/${mission.id}/resume`, { method: 'POST', cookie: researcher, body: JSON.stringify({ version: mission.version }) })).status, 409);
      const stopped = await call(`/discovery-missions/${mission.id}/stop`, { method: 'POST', cookie: researcher, body: JSON.stringify({ version: mission.version + 1 }) });
      assert.equal(stopped.status, 200);
      assert.equal((await json(stopped)).stopReason, 'STOPPED_BY_USER');
      assert.equal((await call(`/discovery-missions/${mission.id}/pause`, { method: 'POST', cookie: researcher, body: JSON.stringify({ version: mission.version + 2 }) })).status, 422);

      const results = await json(await call(`/discovery-missions/${mission.id}/companies?website=without&limit=10`, { cookie: viewer }));
      assert.deepEqual(results, { items: [], nextCursor: null, total: 0 });
      assert.equal((await call(`/discovery-missions/${mission.id}/companies?website=maybe`, { cookie: viewer })).status, 400);
      const markets = await json(await call('/markets', { cookie: viewer }));
      assert.equal(markets.items.length, 1);
      assert.equal(markets.items[0].latestMission.status, 'COMPLETED');
    });
  });
});
