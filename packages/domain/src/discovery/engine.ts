import type { DiscoveryMission, DiscoveryMissionStatus, DiscoveryQuery, Integration, Market, Prisma, PrismaClient } from '@revenue-os/database';
import { recordEvent } from '@revenue-os/events';
import type { CompanySearchPage, ProviderErrorKind, ProviderGateway } from '@revenue-os/providers';
import {
  assessCoverage,
  buildStrategies,
  describeError,
  describeQuery,
  DISCOVERY_MODES,
  planRound,
  remainingStrategies,
  type DiscoveryMode,
  type MarketLocation,
  type RoundStats,
} from '@revenue-os/shared';
import { writeAudit, type ServiceContext, type Tx } from '../context.js';
import { ObservationAlreadyResolvedError, resolveObservationTx } from './resolve.js';

export interface DiscoveryEngineDeps {
  db: PrismaClient;
  gateway: ProviderGateway;
  /** Lease owner identity, e.g. `${hostname}:${pid}`. */
  workerId: string;
  now?: () => Date;
}

export interface AdvanceResult {
  missionId: string;
  /** SKIPPED = not found, not runnable, or another worker holds the lease. */
  outcome: 'ADVANCED' | 'SKIPPED';
  reason?: string;
  status: DiscoveryMissionStatus | null;
  round: number;
}

/** Phases the engine works through (docs/09 §16). ENRICHING is Phase 8. */
export const ENGINE_STATES: DiscoveryMissionStatus[] = ['PLANNING', 'DISCOVERING', 'RESOLVING', 'ASSESSING_COVERAGE'];
/** States a person may pause/stop from, and that block a second mission on the same market. */
export const ACTIVE_MISSION_STATES: DiscoveryMissionStatus[] = [...ENGINE_STATES, 'WAITING', 'PAUSED'];
export const TERMINAL_MISSION_STATES: DiscoveryMissionStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];

export const DISCOVERY_LEASE_MS = 5 * 60_000;
export const DISCOVERY_PAGE_SIZE = 20;
const RESOLVE_BATCH = 50;
const DEFAULT_RETRY_MS = 60_000;
/** Provider answers that mean "not now" — the mission waits and retries; nothing is lost. */
const WAIT_KINDS: ReadonlySet<ProviderErrorKind> = new Set(['RATE_LIMITED', 'QUOTA_EXCEEDED', 'UNAVAILABLE', 'TRANSIENT', 'UNKNOWN_OUTCOME']);
const AUTH_KINDS: ReadonlySet<ProviderErrorKind> = new Set(['AUTH_REQUIRED', 'PERMISSION_DENIED']);
const TX_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;
export const NO_SOURCE_REASON = 'No lead source connected — connect one in Integrations';

type Mission = DiscoveryMission & { market: Market };
type Source = { key: string; integration: Integration };
type Step = 'continue' | 'stop';

export const systemContext = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'SYSTEM', id: null } });

/**
 * Advances one discovery mission by at most one round, from its DB state (docs/17 §46-51, docs/09 §16, docs/11 §55,
 * §73): PLANNING → DISCOVERING → RESOLVING → ASSESSING_COVERAGE → (next round's PLANNING | COMPLETED).
 *
 * - Resumable after a crash: queries persist cursor/pages, observations are unique per (mission, provider, listing),
 *   so re-running a step never double counts.
 * - A lease guarantees one worker per mission; every transition is a guarded update on the expected status, so a
 *   person's concurrent pause/stop always wins and the engine stops quietly.
 * - Exit transitions (next round, WAITING, BLOCKED, COMPLETED) release the lease in the same transaction that records
 *   the event, so the follow-up job the event schedules can claim the mission immediately.
 */
export async function advanceMission(deps: DiscoveryEngineDeps, missionId: string): Promise<AdvanceResult> {
  const now = () => deps.now?.() ?? new Date();
  const { db, workerId } = deps;

  const claimAt = now();
  const claimed = await db.discoveryMission.updateMany({
    where: {
      id: missionId,
      AND: [
        { OR: [{ status: { in: ENGINE_STATES } }, { status: 'WAITING', retryAt: { lte: claimAt } }] },
        { OR: [{ leaseUntil: null }, { leaseUntil: { lt: claimAt } }, { leaseOwner: workerId }] },
      ],
    },
    data: { leaseOwner: workerId, leaseUntil: new Date(claimAt.getTime() + DISCOVERY_LEASE_MS) },
  });
  if (claimed.count === 0) {
    const m = await db.discoveryMission.findUnique({ where: { id: missionId }, select: { status: true, currentRound: true, leaseUntil: true } });
    const reason = !m ? 'NOT_FOUND' : ENGINE_STATES.includes(m.status) ? 'LEASED' : 'NOT_RUNNABLE';
    return { missionId, outcome: 'SKIPPED', reason, status: m?.status ?? null, round: m?.currentRound ?? 0 };
  }

  const engine = new MissionEngine(deps, missionId, now);
  try {
    // Bounded: one round is at most WAITING→…→PLANNING→DISCOVERING→RESOLVING→ASSESSING_COVERAGE.
    for (let step = 0; step < 8; step++) {
      const mission = await engine.load();
      if (!mission || mission.leaseOwner !== workerId) break;
      let next: Step = 'stop';
      switch (mission.status) {
        case 'WAITING':
          next = await engine.wake(mission);
          break;
        case 'PLANNING':
          next = await engine.plan(mission);
          break;
        case 'DISCOVERING':
          next = await engine.discover(mission);
          break;
        case 'RESOLVING':
          next = await engine.resolve(mission);
          break;
        case 'ASSESSING_COVERAGE':
          next = await engine.assess(mission);
          break;
      }
      if (next === 'stop') break;
    }
  } finally {
    await db.discoveryMission.updateMany({ where: { id: missionId, leaseOwner: workerId }, data: { leaseOwner: null, leaseUntil: null } });
  }
  const final = await db.discoveryMission.findUnique({ where: { id: missionId }, select: { status: true, currentRound: true } });
  return { missionId, outcome: 'ADVANCED', status: final?.status ?? null, round: final?.currentRound ?? 0 };
}

/**
 * Settles a mission as FAILED after an unexpected error on the job's final attempt (contract: "Unexpected exception
 * inside advance on final attempt"). No-op when it already reached a terminal state.
 */
export async function failMission(db: PrismaClient, missionId: string, reason: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const mission = await tx.discoveryMission.findUnique({ where: { id: missionId }, select: { workspaceId: true, status: true } });
    if (!mission || TERMINAL_MISSION_STATES.includes(mission.status)) return false;
    const statusReason = reason.slice(0, 500);
    const { count } = await tx.discoveryMission.updateMany({
      where: { id: missionId, status: mission.status },
      data: { status: 'FAILED', statusReason, completedAt: new Date(), leaseOwner: null, leaseUntil: null, version: { increment: 1 } },
    });
    if (count === 0) return false;
    const ctx = systemContext(mission.workspaceId);
    await writeAudit(tx, ctx, { action: 'discovery_mission.failed', entityType: 'DISCOVERY_MISSION', entityId: missionId, before: { status: mission.status }, after: { status: 'FAILED' }, reason: statusReason });
    await recordEvent(tx, ctx, 'DiscoveryMissionFailed', missionId, { missionId, reason: statusReason });
    return true;
  });
}

class MissionEngine {
  constructor(
    private readonly deps: DiscoveryEngineDeps,
    private readonly missionId: string,
    private readonly now: () => Date,
  ) {}

  private get db() {
    return this.deps.db;
  }

  load(): Promise<Mission | null> {
    return this.db.discoveryMission.findUnique({ where: { id: this.missionId }, include: { market: true } });
  }

  /** Extends the lease; false when it was lost (another worker took over after expiry). */
  private async renew(): Promise<boolean> {
    const { count } = await this.db.discoveryMission.updateMany({
      where: { id: this.missionId, leaseOwner: this.deps.workerId },
      data: { leaseUntil: new Date(this.now().getTime() + DISCOVERY_LEASE_MS) },
    });
    return count > 0;
  }

  /** Still ours and still in this phase? Checked between pages / batches so a pause takes effect promptly. */
  private async stillIn(status: DiscoveryMissionStatus): Promise<Mission | null> {
    if (!(await this.renew())) return null;
    const mission = await this.load();
    return mission?.status === status ? mission : null;
  }

  /**
   * Guarded status change: applies only if the mission is still in `from` and leased by us; `then` runs in the same
   * transaction (events, audit, counters). Returns false — and changes nothing — when a person got there first.
   */
  private transition(mission: Mission, from: DiscoveryMissionStatus, data: Prisma.DiscoveryMissionUpdateManyMutationInput, then?: (tx: Tx, ctx: ServiceContext) => Promise<void>): Promise<boolean> {
    return this.db.$transaction(async (tx) => {
      const { count } = await tx.discoveryMission.updateMany({
        where: { id: mission.id, status: from, leaseOwner: this.deps.workerId },
        data: { ...data, version: { increment: 1 } },
      });
      if (count === 0) return false;
      await then?.(tx, systemContext(mission.workspaceId));
      return true;
    }, TX_OPTIONS);
  }

  private release() {
    return { leaseOwner: null, leaseUntil: null };
  }

  // ───────────────────────────── WAITING ─────────────────────────────

  /** The retry time of a WAITING mission has come: continue where it stopped. */
  async wake(mission: Mission): Promise<Step> {
    if (!mission.retryAt || mission.retryAt > this.now()) return 'stop';
    const status = mission.resumeStatus && ENGINE_STATES.includes(mission.resumeStatus) ? mission.resumeStatus : 'PLANNING';
    const ok = await this.transition(mission, 'WAITING', { status, resumeStatus: null, retryAt: null, statusReason: null }, async (tx, ctx) => {
      await recordEvent(tx, ctx, 'DiscoveryMissionResumed', mission.id, { missionId: mission.id, status });
    });
    return ok ? 'continue' : 'stop';
  }

  // ───────────────────────────── PLANNING ─────────────────────────────

  /** Next bounded batch of queries (docs/11 §73) — or BLOCKED when there is nothing to search with. */
  async plan(mission: Mission): Promise<Step> {
    const sources = await discoverySources(this.db, mission.workspaceId);
    if (sources.length === 0) {
      await this.transition(mission, 'PLANNING', { status: 'BLOCKED', statusReason: NO_SOURCE_REASON, ...this.release() }, async (tx, ctx) => {
        await writeAudit(tx, ctx, { action: 'discovery_mission.blocked', entityType: 'DISCOVERY_MISSION', entityId: mission.id, after: { status: 'BLOCKED' }, reason: NO_SOURCE_REASON });
        await recordEvent(tx, ctx, 'DiscoveryMissionBlocked', mission.id, { missionId: mission.id, reason: NO_SOURCE_REASON });
      });
      return 'stop';
    }

    const mode = mission.mode as DiscoveryMode;
    const location = locationOf(mission.market);
    const strategies = buildStrategies(mission.market.industry, location, { mode, categories: mission.categories });
    const existing = await this.db.discoveryQuery.findMany({ where: { missionId: mission.id }, select: { integrationId: true, provider: true, strategyKey: true } });
    const used = new Set(existing.map((q) => `${q.integrationId ?? q.provider}|${q.strategyKey}`));
    const planned = planRound({ strategies, sources, used, mode, queriesSoFar: existing.length, maxQueries: mission.maxQueries });

    if (planned.length === 0) {
      // Nothing left to ask: measure and finish (STRATEGIES_EXHAUSTED or a budget).
      const ok = await this.transition(mission, 'PLANNING', { status: 'ASSESSING_COVERAGE' });
      return ok ? 'continue' : 'stop';
    }

    const round = mission.currentRound + 1;
    const pageLimit = DISCOVERY_MODES[mode].pageLimit;
    const plannedAt = this.now().getTime();
    const ok = await this.transition(mission, 'PLANNING', { status: 'DISCOVERING', currentRound: round }, async (tx) => {
      await tx.discoveryQuery.createMany({
        data: planned.map(({ strategy, source }, i) => ({
          // Distinct timestamps keep the planned order (main category first) — discover runs queries by createdAt.
          createdAt: new Date(plannedAt + i),
          workspaceId: mission.workspaceId,
          missionId: mission.id,
          round,
          queryType: strategy.type,
          strategyKey: strategy.key,
          queryText: describeQuery(strategy, location),
          category: strategy.category,
          keyword: strategy.keyword,
          provider: source.integration.provider,
          integrationId: source.integration.id,
          pageLimit,
        })),
        skipDuplicates: true,
      });
    });
    return ok ? 'continue' : 'stop';
  }

  // ───────────────────────────── DISCOVERING ─────────────────────────────

  /** Runs this round's queries page by page through the Provider Gateway. */
  async discover(start: Mission): Promise<Step> {
    let mission: Mission | null = start;
    const location = locationOf(start.market);

    queries: for (;;) {
      const query: DiscoveryQuery | null = await this.db.discoveryQuery.findFirst({
        where: { missionId: start.id, round: start.currentRound, status: { in: ['RUNNING', 'PLANNED'] } },
        orderBy: [{ status: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }], // RUNNING (a resumed query) first
      });
      if (!query) break;

      if (query.status === 'PLANNED') {
        await this.db.$transaction(async (tx) => {
          const { count } = await tx.discoveryQuery.updateMany({ where: { id: query.id, status: 'PLANNED' }, data: { status: 'RUNNING', startedAt: this.now() } });
          if (count) await tx.discoveryMission.update({ where: { id: start.id }, data: { queriesExecuted: { increment: 1 } } });
        });
      }

      let pages = query.pagesFetched;
      let cursor = query.cursor;
      for (;;) {
        mission = await this.stillIn('DISCOVERING');
        if (!mission) return 'continue'; // paused/stopped/lease lost — the loop re-reads and stops

        // Enough listings for the person's lead target: resolve them first. Unfinished queries stay RUNNING/PLANNED
        // and continue from their cursor if duplicates leave the hunt short.
        if (await this.targetCovered(mission)) break queries;

        if (pages >= query.pageLimit) {
          await this.finishQuery(query.id, { exhausted: false });
          break;
        }
        if (mission.providerCalls >= mission.maxProviderCalls) {
          await this.finishQuery(query.id, { exhausted: false });
          await this.db.discoveryQuery.updateMany({
            where: { missionId: start.id, status: 'PLANNED' },
            data: { status: 'SKIPPED', error: 'Provider call budget reached', completedAt: this.now() },
          });
          break;
        }

        let page: CompanySearchPage;
        try {
          const result = await this.deps.gateway.call(
            {
              workspaceId: start.workspaceId,
              capability: 'COMPANY_SEARCH',
              operation: 'search_companies',
              integrationId: query.integrationId ?? undefined,
              entity: { type: 'DISCOVERY_MISSION', id: start.id },
            },
            (adapter, options) =>
              adapter.searchCompanies({ location, industry: query.category, query: query.keyword ?? undefined, cursor, pageSize: DISCOVERY_PAGE_SIZE }, options),
          );
          page = result.value;
        } catch (err) {
          const kind = (err as { providerErrorKind?: ProviderErrorKind }).providerErrorKind;
          if (!kind) throw err; // not a provider answer — a bug or the database; let the job retry
          await this.db.discoveryMission.update({ where: { id: start.id }, data: { providerCalls: { increment: 1 } } });
          if (WAIT_KINDS.has(kind)) {
            const retryAfterMs = (err as { retryAfterMs?: unknown }).retryAfterMs;
            await this.wait(mission, describeError(err), typeof retryAfterMs === 'number' && retryAfterMs > 0 ? retryAfterMs : DEFAULT_RETRY_MS);
            return 'stop';
          }
          // Credentials or a bad request: this query can't run; the others still may.
          await this.db.$transaction([
            this.db.discoveryQuery.update({ where: { id: query.id }, data: { status: 'FAILED', error: describeError(err).slice(0, 500), errorKind: kind, completedAt: this.now() } }),
            this.db.discoveryMission.update({ where: { id: start.id }, data: { failedQueries: { increment: 1 } } }),
          ]);
          break;
        }

        pages++;
        cursor = page.nextCursor;
        const exhausted = page.nextCursor === null;
        await this.db.$transaction(
          async (tx) => {
            if (page.observations.length) {
              await tx.discoveryObservation.createMany({
                data: page.observations.map((o) => ({
                  workspaceId: start.workspaceId,
                  missionId: start.id,
                  queryId: query.id,
                  round: query.round,
                  provider: query.provider,
                  integrationId: query.integrationId,
                  sourceRecordId: o.sourceRecordId,
                  name: o.name,
                  domain: o.domain,
                  phone: o.phone,
                  addressLine: o.address?.line1 ?? null,
                  city: o.address?.city ?? null,
                  region: o.address?.region ?? null,
                  postalCode: o.address?.postalCode ?? null,
                  country: o.address?.country ? o.address.country.slice(0, 2).toUpperCase() : null,
                  category: o.category,
                  rawPayload: o.raw as Prisma.InputJsonValue,
                  observedAt: validDate(o.observedAt) ?? this.now(),
                })),
                skipDuplicates: true,
              });
            }
            await tx.discoveryQuery.update({
              where: { id: query.id },
              data: {
                cursor,
                pagesFetched: pages,
                resultCount: { increment: page.observations.length },
                ...(exhausted ? { status: 'COMPLETED', exhausted: true, completedAt: this.now() } : {}),
              },
            });
            await tx.discoveryMission.update({ where: { id: start.id }, data: { providerCalls: { increment: 1 } } });
          },
          TX_OPTIONS,
        );
        if (exhausted) break;
      }
    }

    // Every query of the round was refused for credentials → nothing will work until someone reconnects.
    const roundQueries = await this.db.discoveryQuery.findMany({ where: { missionId: start.id, round: start.currentRound }, select: { status: true, errorKind: true } });
    const allAuth = roundQueries.length > 0 && roundQueries.every((q) => q.status === 'FAILED' && q.errorKind && AUTH_KINDS.has(q.errorKind as ProviderErrorKind));
    if (allAuth) {
      const reason = 'Every lead source refused its credentials — reconnect it in Integrations';
      await this.transition(start, 'DISCOVERING', { status: 'BLOCKED', statusReason: reason, ...this.release() }, async (tx, ctx) => {
        await writeAudit(tx, ctx, { action: 'discovery_mission.blocked', entityType: 'DISCOVERY_MISSION', entityId: start.id, after: { status: 'BLOCKED' }, reason });
        await recordEvent(tx, ctx, 'DiscoveryMissionBlocked', start.id, { missionId: start.id, reason });
      });
      return 'stop';
    }
    const ok = await this.transition(start, 'DISCOVERING', { status: 'RESOLVING' });
    return ok ? 'continue' : 'stop';
  }

  /** Businesses already counted plus listings waiting for resolution reach the lead target (an upper bound). */
  private async targetCovered(mission: Mission): Promise<boolean> {
    if (!mission.targetCount) return false;
    const pending = await this.db.discoveryObservation.count({ where: { missionId: mission.id, status: 'PENDING' } });
    return mission.uniqueCompanies + pending >= mission.targetCount;
  }

  private finishQuery(id: string, data: { exhausted: boolean }) {
    return this.db.discoveryQuery.update({ where: { id }, data: { status: 'COMPLETED', exhausted: data.exhausted, completedAt: this.now() } });
  }

  /** Temporary dependency (rate limit, outage): park the mission until retryAt; the sweep wakes it. */
  private async wait(mission: Mission, reason: string, retryAfterMs: number) {
    const retryAt = new Date(this.now().getTime() + retryAfterMs);
    const statusReason = reason.slice(0, 500);
    await this.transition(mission, 'DISCOVERING', { status: 'WAITING', resumeStatus: 'DISCOVERING', retryAt, statusReason, ...this.release() }, async (tx, ctx) => {
      await recordEvent(tx, ctx, 'DiscoveryMissionWaiting', mission.id, { missionId: mission.id, reason: statusReason, retryAt: retryAt.toISOString() });
    });
  }

  // ───────────────────────────── RESOLVING ─────────────────────────────

  /** Entity resolution of everything this round found — one transaction per observation (contract "RESOLVING"). */
  async resolve(start: Mission): Promise<Step> {
    const ctx = systemContext(start.workspaceId);
    let market = start.market;
    for (;;) {
      const mission = await this.stillIn('RESOLVING');
      if (!mission) return 'continue';
      market = mission.market;
      const batch = await this.db.discoveryObservation.findMany({
        where: { missionId: start.id, status: 'PENDING' },
        orderBy: [{ round: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: RESOLVE_BATCH,
      });
      if (batch.length === 0) break;
      for (const observation of batch) {
        try {
          await this.db.$transaction((tx) => resolveObservationTx(tx, ctx, observation, market), TX_OPTIONS);
        } catch (err) {
          if (!(err instanceof ObservationAlreadyResolvedError)) throw err;
        }
      }
    }
    const ok = await this.transition(start, 'RESOLVING', { status: 'ASSESSING_COVERAGE' });
    return ok ? 'continue' : 'stop';
  }

  // ───────────────────────────── ASSESSING_COVERAGE ─────────────────────────────

  /** Measures the round (docs/04 §20): yield, duplicates, decision with reasons; continues or completes. */
  async assess(mission: Mission): Promise<Step> {
    const mode = mission.mode as DiscoveryMode;
    const stats = await missionStats(this.db, mission.id, mission.currentRound);

    // Discovery paused early for the lead target but duplicates left it short: finish this round's queries first.
    const unfinished = { missionId: mission.id, round: mission.currentRound, status: { in: ['PLANNED' as const, 'RUNNING' as const] } };
    if (mission.targetCount && stats.counters.uniqueCompanies < mission.targetCount && (await this.db.discoveryQuery.count({ where: unfinished })) > 0) {
      const ok = await this.transition(mission, 'ASSESSING_COVERAGE', { ...stats.counters, status: 'DISCOVERING' });
      return ok ? 'continue' : 'stop';
    }

    const sources = await discoverySources(this.db, mission.workspaceId);
    const strategies = buildStrategies(mission.market.industry, locationOf(mission.market), { mode, categories: mission.categories });
    // Strategies that were skipped for budget never ran — they don't count as tried.
    const tried = await this.db.discoveryQuery.findMany({ where: { missionId: mission.id, status: { not: 'SKIPPED' } }, select: { integrationId: true, provider: true, strategyKey: true } });
    const strategiesRemaining = remainingStrategies(strategies, sources, new Set(tried.map((q) => `${q.integrationId ?? q.provider}|${q.strategyKey}`)), mode);
    const counters = await this.db.discoveryMission.findUniqueOrThrow({ where: { id: mission.id }, select: { queriesExecuted: true, providerCalls: true } });

    const assessment = assessCoverage({
      mode,
      rounds: stats.rounds,
      totalObservations: stats.counters.observationsCount,
      strategiesRemaining,
      queriesUsed: counters.queriesExecuted,
      maxQueries: mission.maxQueries,
      callsUsed: counters.providerCalls,
      maxProviderCalls: mission.maxProviderCalls,
      sourcesSearched: stats.counters.sourcesUsed.length,
      strategyTypesSearched: stats.strategyTypesSearched,
      targetCount: mission.targetCount,
    });
    const round = mission.currentRound;
    const last = stats.rounds.at(-1);
    const complete = assessment.decision === 'COMPLETE';
    const now = this.now();
    const row = {
      queries: last?.queries ?? 0,
      observations: last?.observations ?? 0,
      newUnique: last?.newUnique ?? 0,
      cumulativeUnique: last?.cumulativeUnique ?? 0,
      marginalYield: assessment.marginalYield,
      duplicateRate: assessment.duplicateRate,
      confidence: assessment.confidence,
      decision: assessment.decision,
      stopReason: assessment.stopReason,
      reasons: assessment.reasons,
      strategiesRemaining,
      assessedAt: now,
    };

    await this.transition(
      mission,
      'ASSESSING_COVERAGE',
      {
        ...stats.counters,
        ...(complete
          ? { status: 'COMPLETED', stopReason: assessment.stopReason, coverageConfidence: assessment.confidence, completedAt: now, statusReason: null }
          : { status: 'PLANNING', coverageConfidence: assessment.confidence }),
        ...this.release(),
      },
      async (tx, ctx) => {
        await tx.coverageAssessment.upsert({
          where: { missionId_round: { missionId: mission.id, round } },
          create: { workspaceId: mission.workspaceId, missionId: mission.id, round, ...row },
          update: row,
        });
        await writeQueryYields(tx, mission.id, stats.perQuery);
        await writeAudit(tx, ctx, {
          action: 'discovery_mission.round_assessed',
          entityType: 'DISCOVERY_MISSION',
          entityId: mission.id,
          after: { round, decision: assessment.decision, confidence: assessment.confidence, newUnique: row.newUnique, cumulativeUnique: row.cumulativeUnique },
        });
        await recordEvent(tx, ctx, 'DiscoveryRoundCompleted', mission.id, { missionId: mission.id, round, newUnique: row.newUnique, cumulativeUnique: row.cumulativeUnique, decision: assessment.decision });
        if (!complete) return;
        // Queries left unfinished when the target was reached never ran to the end — recorded as skipped, not tried.
        await tx.discoveryQuery.updateMany({ where: unfinished, data: { status: 'SKIPPED', error: 'Lead target reached', completedAt: now } });
        await tx.market.update({ where: { id: mission.marketId }, data: { lastDiscoveryAt: now } });
        await writeAudit(tx, ctx, {
          action: 'discovery_mission.completed',
          entityType: 'DISCOVERY_MISSION',
          entityId: mission.id,
          after: { status: 'COMPLETED', stopReason: assessment.stopReason, coverageConfidence: assessment.confidence, uniqueCompanies: stats.counters.uniqueCompanies },
        });
        await recordEvent(tx, ctx, 'DiscoveryMissionCompleted', mission.id, {
          missionId: mission.id,
          stopReason: assessment.stopReason!,
          coverageConfidence: assessment.confidence,
          uniqueCompanies: stats.counters.uniqueCompanies,
        });
      },
    );
    return 'stop'; // the next round (if any) runs from the DiscoveryRoundCompleted event
  }
}

/** Workspace integrations that can search for companies, preferred first (docs/12 §130). Source key = integration id. */
export async function discoverySources(db: PrismaClient | Tx, workspaceId: string): Promise<Source[]> {
  const rows = await db.integration.findMany({
    where: { workspaceId, capabilities: { has: 'COMPANY_SEARCH' }, status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] } },
    orderBy: [{ priority: 'asc' }, { connectedAt: 'asc' }],
  });
  return rows.map((integration) => ({ key: integration.id, integration }));
}

export function locationOf(market: Pick<Market, 'country' | 'region' | 'city'>): MarketLocation {
  return { country: market.country, region: market.region ?? undefined, city: market.city ?? undefined };
}

export interface MissionCounters {
  observationsCount: number;
  uniqueCompanies: number;
  newCompanies: number;
  matchedExisting: number;
  duplicateObservations: number;
  reviewCandidates: number;
  rejectedObservations: number;
  withWebsite: number;
  withoutWebsite: number;
  withPhone: number;
  sourcesUsed: string[];
}

/**
 * The mission's measured truth, recomputed from observations (counters on the mission are only a projection).
 * A business is counted once by its canonical company — COALESCE(mergedIntoId, id) — and belongs to the round (and
 * query) of its first resolved listing in this mission.
 */
export async function missionStats(db: PrismaClient | Tx, missionId: string, currentRound: number) {
  const firsts = await db.$queryRaw<{ canon: string; round: number; queryId: string; created: boolean; hasWebsite: boolean; hasPhone: boolean }[]>`
    WITH resolved AS (
      SELECT o.id, o.round, o."queryId", o."createdAt", o.outcome, COALESCE(c."mergedIntoId", c.id) AS canon
      FROM "DiscoveryObservation" o JOIN "Company" c ON c.id = o."companyId"
      WHERE o."missionId" = ${missionId}::uuid AND o.status = 'RESOLVED'
    ),
    firsts AS (
      SELECT DISTINCT ON (canon) canon, round, "queryId" FROM resolved ORDER BY canon, round, "createdAt", id
    )
    SELECT f.canon::text AS canon, f.round, f."queryId"::text AS "queryId",
           EXISTS (SELECT 1 FROM resolved r WHERE r.canon = f.canon AND r.outcome = 'CREATED') AS created,
           (k."websiteDomain" IS NOT NULL) AS "hasWebsite", (k.phone IS NOT NULL) AS "hasPhone"
    FROM firsts f JOIN "Company" k ON k.id = f.canon`;
  const byStatus = await db.discoveryObservation.groupBy({ by: ['round', 'status', 'outcome', 'flaggedForReview'], where: { missionId }, _count: { _all: true } });
  const queries = await db.discoveryQuery.findMany({ where: { missionId, status: { not: 'SKIPPED' } }, select: { id: true, round: true, status: true, provider: true, queryType: true } });

  const sum = (pred: (g: (typeof byStatus)[number]) => boolean) => byStatus.filter(pred).reduce((n, g) => n + g._count._all, 0);
  const rounds: RoundStats[] = [];
  let cumulative = 0;
  for (let round = 1; round <= currentRound; round++) {
    const newUnique = firsts.filter((f) => f.round === round).length;
    cumulative += newUnique;
    rounds.push({ round, queries: queries.filter((q) => q.round === round).length, observations: sum((g) => g.round === round), newUnique, cumulativeUnique: cumulative });
  }
  const perQuery = new Map<string, number>();
  for (const f of firsts) perQuery.set(f.queryId, (perQuery.get(f.queryId) ?? 0) + 1);

  const completed = queries.filter((q) => q.status === 'COMPLETED');
  const uniqueCompanies = firsts.length;
  const newCompanies = firsts.filter((f) => f.created).length;
  const withWebsite = firsts.filter((f) => f.hasWebsite).length;
  const counters: MissionCounters = {
    observationsCount: sum(() => true),
    uniqueCompanies,
    newCompanies,
    matchedExisting: uniqueCompanies - newCompanies,
    duplicateObservations: sum((g) => g.outcome === 'DUPLICATE_LISTING'),
    reviewCandidates: sum((g) => g.flaggedForReview),
    rejectedObservations: sum((g) => g.status === 'REJECTED'),
    withWebsite,
    withoutWebsite: uniqueCompanies - withWebsite,
    withPhone: firsts.filter((f) => f.hasPhone).length,
    sourcesUsed: [...new Set(completed.map((q) => q.provider))].sort(),
  };
  return { rounds, counters, perQuery, strategyTypesSearched: new Set(completed.map((q) => q.queryType)).size };
}

/** newUniqueCount per query: businesses whose first listing in this mission came from that query. */
async function writeQueryYields(tx: Tx, missionId: string, perQuery: Map<string, number>) {
  await tx.discoveryQuery.updateMany({ where: { missionId, newUniqueCount: { not: 0 }, id: { notIn: [...perQuery.keys()] } }, data: { newUniqueCount: 0 } });
  // Grouped by value, so a round costs a handful of updates instead of one per query.
  const byCount = new Map<number, string[]>();
  for (const [id, n] of perQuery) byCount.set(n, [...(byCount.get(n) ?? []), id]);
  for (const [n, ids] of byCount) await tx.discoveryQuery.updateMany({ where: { id: { in: ids } }, data: { newUniqueCount: n } });
}

function validDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
