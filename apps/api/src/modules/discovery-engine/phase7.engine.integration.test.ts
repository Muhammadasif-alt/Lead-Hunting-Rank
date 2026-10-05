import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import type { DiscoveryMode } from '@revenue-os/database';
import { advanceMission, createCompanyTx, NO_SOURCE_REASON, sweepDiscoveryMissions, type AdvanceResult, type SweepJob } from '@revenue-os/domain';
import { FakeLeadProvider, type ProviderGateway } from '@revenue-os/providers';
import { createProviderRuntime, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { DISCOVERY_MODES, marketKey, marketName, normalizePhone, relatedCategories } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';

const AUSTIN = { country: 'US', region: 'TX', city: 'Austin' };
const SETTLED = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'WAITING', 'BLOCKED', 'PAUSED']);

/**
 * Phase 7 engine (docs/17 §46-51, docs/03, docs/09 §16): a mission hunts a market round by round through the
 * Provider Gateway, resolves every listing to one canonical company with evidence, and stops on measured
 * saturation or a budget — reporting coverage confidence with reasons, never "100%".
 */
describe('Phase 7 — discovery engine', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let storage: string;
  let runtime: ProviderRuntime;
  let exhaust: { ctx: ServiceContext; marketId: string; missionId: string } | undefined;

  const newWorkspace = async () => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, {
      name: 'Discovery Test',
      slug: uniqueSlug('disc'),
      owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Owner' },
    });
    return { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } } satisfies ServiceContext;
  };
  const connect = (ctx: ServiceContext, provider: 'fake_leads' | 'fake_directory', priority = 100) =>
    prisma.client.integration.create({
      data: { workspaceId: ctx.workspaceId, provider, category: 'LEAD_DATA', name: provider, capabilities: ['COMPANY_SEARCH'], status: 'ACTIVE', priority, connectedAt: new Date() },
    });
  /** What the API's start command does, minimal: market by key + a PLANNING mission with the mode's budgets. */
  const startMission = async (ctx: ServiceContext, mode: DiscoveryMode & keyof typeof DISCOVERY_MODES, industry = 'landscaping') => {
    const key = marketKey(AUSTIN, industry);
    const market = await prisma.client.market.upsert({
      where: { workspaceId_marketKey: { workspaceId: ctx.workspaceId, marketKey: key } },
      create: { workspaceId: ctx.workspaceId, marketKey: key, name: marketName(AUSTIN, industry), ...AUSTIN, industry, relatedCategories: relatedCategories(industry) },
      update: {},
    });
    const profile = DISCOVERY_MODES[mode];
    const mission = await prisma.client.discoveryMission.create({
      data: {
        workspaceId: ctx.workspaceId,
        marketId: market.id,
        mode,
        status: 'PLANNING',
        categories: mode === 'QUICK' ? [] : relatedCategories(industry),
        maxRounds: profile.maxRounds,
        maxQueries: profile.maxQueries,
        maxProviderCalls: profile.maxProviderCalls,
        startedAt: new Date(),
      },
    });
    return { marketId: market.id, missionId: mission.id };
  };
  const deps = (gateway: ProviderGateway = runtime.gateway) => ({ db: prisma.client, gateway, workerId: 'test-worker' });
  /** Drives the mission like the worker would (one advance per job) until it settles. */
  const runToEnd = async (missionId: string, gateway?: ProviderGateway) => {
    const results: AdvanceResult[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await advanceMission(deps(gateway), missionId);
      results.push(r);
      if (r.outcome === 'SKIPPED' || (r.status && SETTLED.has(r.status))) break;
    }
    return { results, mission: await prisma.client.discoveryMission.findUniqueOrThrow({ where: { id: missionId } }) };
  };
  const eventTypes = async (aggregateId: string) =>
    (await prisma.client.domainEvent.findMany({ where: { aggregateId }, orderBy: { occurredAt: 'asc' } })).map((e) => e.eventType);

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    storage = await mkdtemp(join(tmpdir(), 'rhl-phase7-'));
    runtime = createProviderRuntime(prisma.client, { appEnv: 'test', storagePath: storage });
  });

  after(async () => {
    await close();
    await rm(storage, { recursive: true, force: true });
  });

  test('Market Exhaust over two sources: rounds until saturation, one company per business, evidence per listing', async (t) => {
    const ctx = await newWorkspace();
    await connect(ctx, 'fake_leads', 10);
    await connect(ctx, 'fake_directory', 20);
    const { marketId, missionId } = await startMission(ctx, 'MARKET_EXHAUST');
    const started = performance.now();
    const { mission } = await runToEnd(missionId);
    exhaust = { ctx, marketId, missionId };

    assert.equal(mission.status, 'COMPLETED');
    assert.ok(mission.stopReason, 'stop reason recorded');
    assert.ok(mission.coverageConfidence === 'HIGH' || mission.coverageConfidence === 'MEDIUM', `confidence ${mission.coverageConfidence}`);
    assert.equal(mission.leaseOwner, null);
    assert.ok(mission.completedAt);

    const rounds = await prisma.client.coverageAssessment.findMany({ where: { missionId }, orderBy: { round: 'asc' } });
    assert.equal(rounds.length, mission.currentRound);
    assert.ok(rounds.length >= 2);
    assert.ok(rounds.at(-1)!.newUnique < rounds[0]!.newUnique, 'new unique businesses per round decline');
    assert.ok(rounds.every((r) => r.reasons.length > 0));
    assert.equal(rounds.at(-1)!.decision, 'COMPLETE');
    assert.equal(rounds.at(-1)!.cumulativeUnique, mission.uniqueCompanies);
    t.diagnostic(`rounds: ${JSON.stringify(rounds.map((r) => ({ round: r.round, queries: r.queries, observations: r.observations, newUnique: r.newUnique, cumulative: r.cumulativeUnique, yield: Number(r.marginalYield.toFixed(3)), decision: r.decision })))}`);
    t.diagnostic(`stop=${mission.stopReason} confidence=${mission.coverageConfidence} reasons=${JSON.stringify(rounds.at(-1)!.reasons)}`);

    // One canonical company per business, however many listings described it.
    const observations = await prisma.client.discoveryObservation.findMany({ where: { missionId } });
    assert.equal(observations.length, mission.observationsCount);
    assert.ok(observations.every((o) => o.status !== 'PENDING'));
    const companies = await prisma.client.company.findMany({ where: { id: { in: observations.flatMap((o) => (o.companyId ? [o.companyId] : [])) } } });
    const canonical = new Set(companies.map((c) => c.mergedIntoId ?? c.id));
    assert.equal(mission.uniqueCompanies, canonical.size);
    assert.ok(mission.observationsCount > mission.uniqueCompanies, 'listings deduplicated across sources and duplicate listings');
    assert.ok(mission.duplicateObservations > 0);
    assert.equal(mission.newCompanies + mission.matchedExisting, mission.uniqueCompanies);
    assert.equal(mission.newCompanies, mission.uniqueCompanies, 'empty workspace: every business is new');
    assert.equal(mission.withWebsite + mission.withoutWebsite, mission.uniqueCompanies);
    assert.ok(mission.withoutWebsite > 0, 'businesses without a website are found too');
    assert.deepEqual(mission.sourcesUsed, ['fake_directory', 'fake_leads']);
    const live = await prisma.client.company.count({ where: { workspaceId: ctx.workspaceId, mergedIntoId: null } });
    assert.equal(live, mission.uniqueCompanies, 'no company created beyond the unique businesses');
    t.diagnostic(`observations=${mission.observationsCount} unique=${mission.uniqueCompanies} duplicates=${mission.duplicateObservations} review=${mission.reviewCandidates} withWebsite=${mission.withWebsite} queries=${mission.queriesExecuted} calls=${mission.providerCalls} in ${Math.round(performance.now() - started)} ms`);

    // Every listing is evidence on its company, with the provider and an external id mapping.
    const evidence = await prisma.client.evidence.findMany({ where: { workspaceId: ctx.workspaceId, evidenceType: 'LISTING' } });
    const resolved = observations.filter((o) => o.status === 'RESOLVED');
    assert.equal(evidence.length, resolved.length);
    assert.ok(evidence.every((e) => e.provider && e.sourceType === 'LEAD_SOURCE' && e.sourceName));
    const mappings = await prisma.client.externalEntityMapping.findMany({ where: { workspaceId: ctx.workspaceId, entityType: 'COMPANY' } });
    assert.equal(mappings.length, resolved.length);
    for (const id of canonical) {
      assert.ok(evidence.some((e) => e.entityId === id), `evidence for ${id}`);
      assert.ok(mappings.some((m) => m.entityId === id), `mapping for ${id}`);
    }
    const providersBy = new Map<string, Set<string>>();
    for (const e of evidence) providersBy.set(e.entityId, (providersBy.get(e.entityId) ?? new Set()).add(e.provider!));
    assert.ok([...providersBy.values()].some((s) => s.size === 2), 'some business is confirmed by both sources');
    const facts = await prisma.client.fact.count({ where: { workspaceId: ctx.workspaceId, field: 'phone', status: { in: ['ACTIVE', 'CONFLICTED'] } } });
    assert.ok(facts >= canonical.size);

    const queries = await prisma.client.discoveryQuery.findMany({ where: { missionId } });
    assert.equal(queries.reduce((n, q) => n + q.newUniqueCount, 0), mission.uniqueCompanies);
    assert.ok(queries.every((q) => q.status === 'COMPLETED' || q.status === 'SKIPPED'));
    const events = await eventTypes(missionId);
    assert.equal(events.filter((e) => e === 'DiscoveryRoundCompleted').length, rounds.length);
    assert.equal(events.at(-1), 'DiscoveryMissionCompleted');
    assert.equal((await prisma.client.domainEvent.count({ where: { workspaceId: ctx.workspaceId, eventType: 'CompanyDiscovered' } })), mission.uniqueCompanies);
    assert.ok((await prisma.client.market.findUniqueOrThrow({ where: { id: marketId } })).lastDiscoveryAt);
  });

  test('a second Market Exhaust on the same market finds the same businesses and creates no new company', async () => {
    assert.ok(exhaust);
    const before = await prisma.client.company.count({ where: { workspaceId: exhaust.ctx.workspaceId } });
    const { missionId } = await startMission(exhaust.ctx, 'MARKET_EXHAUST');
    const { mission } = await runToEnd(missionId);
    assert.equal(mission.status, 'COMPLETED');
    assert.equal(await prisma.client.company.count({ where: { workspaceId: exhaust.ctx.workspaceId } }), before);
    assert.equal(mission.newCompanies, 0);
    assert.ok(mission.matchedExisting > 0);
    const outcomes = await prisma.client.discoveryObservation.groupBy({ by: ['outcome'], where: { missionId, status: 'RESOLVED' }, _count: { _all: true } });
    assert.deepEqual(outcomes.map((o) => o.outcome).sort(), ['DUPLICATE_LISTING', 'MATCHED_EXISTING']);
  });

  test('a business a person already entered is matched, not duplicated, and their fields are kept', async () => {
    const ctx = await newWorkspace();
    const integration = await connect(ctx, 'fake_leads');
    const page = await new FakeLeadProvider().searchCompanies({ location: AUSTIN, industry: 'landscaping', pageSize: 20 }, { signal: new AbortController().signal });
    const listing = page.observations.find((o) => o.domain && !o.sourceRecordId.endsWith('-b'))!;
    const human = await prisma.client.$transaction(async (tx) =>
      (await createCompanyTx(tx, ctx, { displayName: listing.name, website: `https://${listing.domain}`, addressLine: '1 Human Way', city: 'Austin', region: 'TX', country: 'US', industry: 'Hand-entered' })).company,
    );

    const { missionId } = await startMission(ctx, 'QUICK');
    const { mission } = await runToEnd(missionId);
    assert.equal(mission.status, 'COMPLETED');
    const obs = await prisma.client.discoveryObservation.findUniqueOrThrow({ where: { missionId_provider_sourceRecordId: { missionId, provider: 'fake_leads', sourceRecordId: listing.sourceRecordId } } });
    assert.equal(obs.outcome, 'MATCHED_EXISTING');
    assert.equal(obs.companyId, human.id);
    assert.equal(obs.matchConfidence, 'HIGH');
    assert.equal(await prisma.client.company.count({ where: { workspaceId: ctx.workspaceId, websiteDomain: listing.domain } }), 1);

    const after = await prisma.client.company.findUniqueOrThrow({ where: { id: human.id } });
    assert.equal(after.displayName, human.displayName);
    assert.equal(after.addressLine, '1 Human Way');
    assert.equal(after.industry, 'Hand-entered');
    assert.equal(after.phone, normalizePhone(listing.phone!), 'empty phone filled from the listing');
    assert.equal(after.createdBy, ctx.actor.id);
    assert.ok(mission.matchedExisting >= 1);
    assert.equal((await prisma.client.evidence.count({ where: { entityId: human.id, provider: 'fake_leads' } })) >= 1, true);
    assert.ok(integration.id);
  });

  test('no lead source connected → BLOCKED with a reason, nothing searched', async () => {
    const ctx = await newWorkspace();
    const { missionId } = await startMission(ctx, 'DEEP');
    const { mission } = await runToEnd(missionId);
    assert.equal(mission.status, 'BLOCKED');
    assert.equal(mission.statusReason, NO_SOURCE_REASON);
    assert.equal(mission.leaseOwner, null);
    assert.equal(await prisma.client.discoveryQuery.count({ where: { missionId } }), 0);
    assert.deepEqual(await eventTypes(missionId), ['DiscoveryMissionBlocked']);
  });

  test('a provider rate limit parks the mission in WAITING; after retryAt the sweep wakes it and it finishes', async () => {
    const ctx = await newWorkspace();
    const integration = await connect(ctx, 'fake_leads');
    (runtime.factory.forIntegration(integration) as FakeLeadProvider).failNext('rate-limit');
    const { missionId } = await startMission(ctx, 'QUICK');

    const first = await advanceMission(deps(), missionId);
    assert.equal(first.status, 'WAITING');
    let mission = await prisma.client.discoveryMission.findUniqueOrThrow({ where: { id: missionId } });
    assert.equal(mission.resumeStatus, 'DISCOVERING');
    assert.ok(mission.retryAt);
    assert.match(mission.statusReason ?? '', /429/);
    assert.equal(mission.leaseOwner, null);
    assert.ok((await eventTypes(missionId)).includes('DiscoveryMissionWaiting'));

    // Not yet: a WAITING mission is not advanced before its retry time.
    await prisma.client.discoveryMission.update({ where: { id: missionId }, data: { retryAt: new Date(Date.now() + 3_600_000) } });
    assert.equal((await advanceMission(deps(), missionId)).outcome, 'SKIPPED');

    await prisma.client.discoveryMission.update({ where: { id: missionId }, data: { retryAt: new Date(Date.now() - 1000) } });
    const jobs: SweepJob[] = [];
    await sweepDiscoveryMissions(prisma.client, async (job) => void jobs.push(job));
    assert.ok(jobs.some((j) => j.missionId === missionId && j.workspaceId === ctx.workspaceId && j.jobId.startsWith(`sweep.${missionId}.`)));
    mission = await prisma.client.discoveryMission.findUniqueOrThrow({ where: { id: missionId } });
    assert.equal(mission.status, 'DISCOVERING');
    assert.equal(mission.retryAt, null);

    ({ mission } = await runToEnd(missionId));
    assert.equal(mission.status, 'COMPLETED');
    assert.ok(mission.uniqueCompanies > 0);
    assert.equal(mission.providerCalls, 3, 'the refused call counts against the budget, then two pages');
    assert.ok((await eventTypes(missionId)).includes('DiscoveryMissionResumed'));
  });

  test('a person pausing mid-round wins over the engine; a completed mission is never advanced again', async () => {
    const ctx = await newWorkspace();
    await connect(ctx, 'fake_leads');
    const { missionId } = await startMission(ctx, 'DEEP');

    // The pause lands while the engine is fetching a page.
    let paused = false;
    const pausing = {
      call: async (...args: Parameters<ProviderGateway['call']>) => {
        if (!paused) {
          paused = true;
          await prisma.client.discoveryMission.update({ where: { id: missionId }, data: { status: 'PAUSED', resumeStatus: 'DISCOVERING', version: { increment: 1 } } });
        }
        return runtime.gateway.call(...args);
      },
    } as unknown as ProviderGateway;
    const r = await advanceMission(deps(pausing), missionId);
    assert.equal(r.status, 'PAUSED');
    let mission = await prisma.client.discoveryMission.findUniqueOrThrow({ where: { id: missionId } });
    assert.equal(mission.status, 'PAUSED');
    assert.equal(mission.leaseOwner, null);
    assert.equal(mission.providerCalls, 1, 'the page in flight is kept, nothing after it');
    assert.equal((await advanceMission(deps(), missionId)).outcome, 'SKIPPED', 'a paused mission is not advanced');

    // Resume (what the API command does) → continues from the saved cursor.
    await prisma.client.discoveryMission.update({ where: { id: missionId }, data: { status: 'DISCOVERING', resumeStatus: null } });
    ({ mission } = await runToEnd(missionId));
    assert.equal(mission.status, 'COMPLETED');

    const version = mission.version;
    const eventsBefore = (await eventTypes(missionId)).length;
    const again = await advanceMission(deps(), missionId);
    assert.equal(again.outcome, 'SKIPPED');
    assert.equal(again.reason, 'NOT_RUNNABLE');
    const unchanged = await prisma.client.discoveryMission.findUniqueOrThrow({ where: { id: missionId } });
    assert.equal(unchanged.version, version);
    assert.equal((await eventTypes(missionId)).length, eventsBefore);
  });

  test('Quick Hunt: one round, the preferred source only, LOW confidence', async () => {
    const ctx = await newWorkspace();
    await connect(ctx, 'fake_directory', 10);
    await connect(ctx, 'fake_leads', 20);
    const { missionId } = await startMission(ctx, 'QUICK');
    const { mission, results } = await runToEnd(missionId);
    assert.equal(results.length, 1, 'one advance = one round');
    assert.equal(mission.status, 'COMPLETED');
    assert.equal(mission.currentRound, 1);
    assert.equal(mission.coverageConfidence, 'LOW');
    assert.equal(mission.stopReason, 'STRATEGIES_EXHAUSTED');
    assert.deepEqual(mission.sourcesUsed, ['fake_directory']);
    const queries = await prisma.client.discoveryQuery.findMany({ where: { missionId } });
    assert.equal(queries.length, 1);
    assert.equal(queries[0]!.queryType, 'PRIMARY_CATEGORY');
    assert.ok(queries[0]!.pagesFetched <= DISCOVERY_MODES.QUICK.pageLimit);
    const [assessment] = await prisma.client.coverageAssessment.findMany({ where: { missionId } });
    assert.ok(assessment?.reasons.some((r) => /one round/i.test(r)));
  });

  test('a lead target stops the hunt once that many unique businesses are found, with few provider calls', async () => {
    const ctx = await newWorkspace();
    await connect(ctx, 'fake_leads', 10);
    await connect(ctx, 'fake_directory', 20);
    const { missionId } = await startMission(ctx, 'DEEP', 'plumbing');
    await prisma.client.discoveryMission.update({ where: { id: missionId }, data: { targetCount: 30 } });

    const { mission } = await runToEnd(missionId);
    assert.equal(mission.status, 'COMPLETED');
    assert.equal(mission.stopReason, 'TARGET_REACHED');
    assert.ok(mission.uniqueCompanies >= 30, `found ${mission.uniqueCompanies}`);
    assert.ok(mission.uniqueCompanies < 30 + 2 * 20, 'at most a page per source beyond the target');
    assert.ok(mission.providerCalls <= 6, `used ${mission.providerCalls} calls`);
    const [first] = await prisma.client.discoveryQuery.findMany({ where: { missionId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 1 });
    assert.equal(first?.queryType, 'PRIMARY_CATEGORY', 'the main category is searched first');
    const open = await prisma.client.discoveryQuery.count({ where: { missionId, status: { in: ['PLANNED', 'RUNNING'] } } });
    assert.equal(open, 0, 'unfinished queries are closed as skipped');
    const [assessment] = await prisma.client.coverageAssessment.findMany({ where: { missionId }, orderBy: { round: 'desc' } });
    assert.ok(assessment?.reasons.some((r) => /target of 30/.test(r)));
  });
});
