import { Injectable } from '@nestjs/common';
import type { DiscoveryMission, DiscoveryMissionStatus } from '@revenue-os/database';
import { recordEvent } from '@revenue-os/events';
import { providerDefinition } from '@revenue-os/providers';
import {
  assessCoverage,
  BusinessRuleError,
  buildStrategies,
  ConflictError,
  DISCOVERY_MODES,
  findIndustry,
  industryLabel,
  interpretMarketRequest,
  marketKey,
  marketName,
  NotFoundError,
  relatedCategories,
  remainingStrategies,
  ValidationError,
  type DiscoveryMode,
  type MarketInterpretation,
  type MarketLocation,
} from '@revenue-os/shared';
import { actorUserId, writeAudit, type ServiceContext, type Tx } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { ACTIVE_MISSION_STATUSES, PAUSABLE_STATUSES, RESUMABLE_STATUSES, STOPPABLE_STATUSES, DiscoveryQueryService, type MissionSummary } from './discovery.query.js';
import type { PreviewMissionInput, StartMissionInput } from './discovery.schemas.js';

const DEFAULT_MODE: DiscoveryMode = 'DEEP';
const UNUSABLE_INTEGRATION = ['DISABLED', 'DISCONNECTED', 'CONNECTING'] as const;
const clean = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

interface ResolvedMarket {
  interpretation: MarketInterpretation | null;
  industry: string;
  location: MarketLocation;
  mode: DiscoveryMode;
  available: string[];
  selected: string[];
}

/**
 * Lead Hunter commands (docs/17 §46-51, docs/09 §16). A person previews, starts, pauses, resumes or stops a mission;
 * the worker does the actual discovery. Every command is version-checked, audited and emits its event in the same
 * transaction — the event's route schedules the worker, never a direct call.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: DiscoveryQueryService,
  ) {}

  /** Typed request + form fields → the market, depth, sources and strategies a hunt would use. Writes nothing. */
  async preview(ctx: ServiceContext, input: PreviewMissionInput) {
    const m = this.resolve(input);
    const key = marketKey(m.location, m.industry);
    const db = this.prisma.client;
    const [market, sources] = await Promise.all([
      db.market.findUnique({ where: { workspaceId_marketKey: { workspaceId: ctx.workspaceId, marketKey: key } }, select: { id: true } }),
      this.searchSources(ctx.workspaceId),
    ]);
    const running = market
      ? await db.discoveryMission.findFirst({ where: { workspaceId: ctx.workspaceId, marketId: market.id, status: { in: ACTIVE_MISSION_STATUSES } }, select: { id: true } })
      : null;

    const profile = DISCOVERY_MODES[m.mode];
    const strategies = buildStrategies(m.industry, m.location, { mode: m.mode, categories: m.selected });
    const planned = Math.min(remainingStrategies(strategies, sources.map((s) => ({ key: s.integrationId })), new Set(), m.mode), profile.maxQueries);

    const warnings: string[] = [];
    if (!sources.length) warnings.push('No lead source connected — connect one in Integrations before the hunt can search');
    else if (sources.length === 1 && profile.sources === 'ALL') warnings.push('Only one lead source connected — coverage confidence cannot reach HIGH with a single source');
    for (const s of sources) if (s.health !== 'HEALTHY' && s.health !== 'UNKNOWN') warnings.push(`${s.name} is ${s.health.toLowerCase().replace(/_/g, ' ')} — results may be delayed`);
    if (!findIndustry(m.industry)) warnings.push(`"${m.industry}" is not a business type we know yet — only that exact category will be searched`);
    if (running) warnings.push('A hunt is already running for this market — pause or stop it before starting another');

    return {
      interpretation: m.interpretation,
      market: {
        name: marketName(m.location, m.industry),
        marketKey: key,
        country: m.location.country,
        region: m.location.region ?? null,
        city: m.location.city ?? null,
        industry: m.industry,
        industryLabel: industryLabel(m.industry),
        existingMarketId: market?.id ?? null,
        runningMissionId: running?.id ?? null,
      },
      mode: m.mode,
      profile,
      categories: { available: m.available, selected: m.selected },
      sources,
      strategies: planned,
      warnings,
    };
  }

  /** Creates (or reuses) the market and starts a mission in PLANNING. One active mission per market. */
  async start(ctx: ServiceContext, input: StartMissionInput): Promise<MissionSummary> {
    const m = this.resolve(input);
    const key = marketKey(m.location, m.industry);
    const profile = DISCOVERY_MODES[m.mode];

    const missionId = await this.prisma.client.$transaction(async (tx) => {
      // Serialises concurrent starts of the same market (and the market create) until this transaction commits.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`market:${ctx.workspaceId}:${key}`}, 0))`;

      let market = await tx.market.findUnique({ where: { workspaceId_marketKey: { workspaceId: ctx.workspaceId, marketKey: key } } });
      if (!market) {
        market = await tx.market.create({
          data: {
            workspaceId: ctx.workspaceId,
            name: marketName(m.location, m.industry),
            marketKey: key,
            country: m.location.country,
            region: m.location.region ?? null,
            city: m.location.city ?? null,
            industry: m.industry,
            relatedCategories: m.available,
            createdBy: actorUserId(ctx),
          },
        });
        await writeAudit(tx, ctx, { action: 'market.created', entityType: 'MARKET', entityId: market.id, after: { name: market.name, marketKey: key } });
        await recordEvent(tx, ctx, 'MarketCreated', market.id, { marketId: market.id, marketKey: key });
      }

      const running = await tx.discoveryMission.findFirst({ where: { workspaceId: ctx.workspaceId, marketId: market.id, status: { in: ACTIVE_MISSION_STATUSES } }, select: { id: true, status: true } });
      if (running) {
        throw new ConflictError('MISSION_ALREADY_RUNNING', `A hunt for ${market.name} is already ${running.status.toLowerCase()} — pause or stop it first`, [{ path: 'missionId', message: running.id }]);
      }

      const mission = await tx.discoveryMission.create({
        data: {
          workspaceId: ctx.workspaceId,
          marketId: market.id,
          mode: m.mode,
          status: 'PLANNING',
          request: input.request?.trim() || null,
          interpretation: m.interpretation ? JSON.parse(JSON.stringify(m.interpretation)) : undefined,
          categories: m.selected,
          maxRounds: profile.maxRounds,
          maxQueries: profile.maxQueries,
          maxProviderCalls: profile.maxProviderCalls,
          targetCount: input.targetCount ?? null,
          createdBy: actorUserId(ctx),
          startedAt: new Date(),
        },
      });
      await writeAudit(tx, ctx, {
        action: 'discovery_mission.started',
        entityType: 'DISCOVERY_MISSION',
        entityId: mission.id,
        after: { marketId: market.id, mode: mission.mode, categories: mission.categories, maxRounds: mission.maxRounds, maxQueries: mission.maxQueries, maxProviderCalls: mission.maxProviderCalls, targetCount: mission.targetCount },
      });
      await recordEvent(tx, ctx, 'DiscoveryMissionStarted', mission.id, { missionId: mission.id, marketId: market.id, mode: mission.mode });
      return mission.id;
    });
    return this.query.summary(ctx.workspaceId, missionId);
  }

  /** Intentional stop that keeps everything; resume continues from the remembered phase. */
  pause(ctx: ServiceContext, id: string, version: number) {
    return this.transition(ctx, id, version, PAUSABLE_STATUSES, 'paused', async (tx, current) => {
      const resumeStatus: DiscoveryMissionStatus = current.status === 'WAITING' ? (current.resumeStatus ?? 'PLANNING') : current.status;
      await this.apply(tx, ctx, current, { status: 'PAUSED', resumeStatus, retryAt: null, statusReason: 'Paused by a person' });
      await writeAudit(tx, ctx, { action: 'discovery_mission.paused', entityType: 'DISCOVERY_MISSION', entityId: id, before: { status: current.status }, after: { status: 'PAUSED', resumeStatus } });
      await recordEvent(tx, ctx, 'DiscoveryMissionPaused', id, { missionId: id, reason: null });
    });
  }

  /** PAUSED → the remembered phase; BLOCKED / WAITING → try again now (e.g. after connecting a source). */
  resume(ctx: ServiceContext, id: string, version: number) {
    return this.transition(ctx, id, version, RESUMABLE_STATUSES, 'resumed', async (tx, current) => {
      const status: DiscoveryMissionStatus = current.resumeStatus ?? 'PLANNING';
      await this.apply(tx, ctx, current, { status, resumeStatus: null, retryAt: null, statusReason: null });
      await writeAudit(tx, ctx, { action: 'discovery_mission.resumed', entityType: 'DISCOVERY_MISSION', entityId: id, before: { status: current.status }, after: { status } });
      await recordEvent(tx, ctx, 'DiscoveryMissionResumed', id, { missionId: id, status });
    });
  }

  /**
   * Finishes the mission now, independent of the engine: everything found so far stays, and coverage is assessed
   * from the rounds already measured (LOW when none) — never presented as complete.
   */
  stop(ctx: ServiceContext, id: string, version: number) {
    return this.transition(ctx, id, version, STOPPABLE_STATUSES, 'stopped', async (tx, current) => {
      const [rounds, completedTypes] = await Promise.all([
        tx.coverageAssessment.findMany({ where: { workspaceId: ctx.workspaceId, missionId: id }, orderBy: { round: 'asc' } }),
        tx.discoveryQuery.findMany({ where: { workspaceId: ctx.workspaceId, missionId: id, status: 'COMPLETED' }, distinct: ['queryType'], select: { queryType: true } }),
      ]);
      const mode: DiscoveryMode = current.mode === 'QUICK' || current.mode === 'DEEP' || current.mode === 'MARKET_EXHAUST' ? current.mode : 'DEEP';
      const coverage = assessCoverage({
        mode,
        rounds: rounds.map((r) => ({ round: r.round, queries: r.queries, observations: r.observations, newUnique: r.newUnique, cumulativeUnique: r.cumulativeUnique })),
        totalObservations: current.observationsCount,
        strategiesRemaining: rounds.at(-1)?.strategiesRemaining ?? 0,
        queriesUsed: current.queriesExecuted,
        maxQueries: current.maxQueries,
        callsUsed: current.providerCalls,
        maxProviderCalls: current.maxProviderCalls,
        sourcesSearched: current.sourcesUsed.length,
        strategyTypesSearched: completedTypes.length,
        stoppedByUser: true,
      });
      const confidence = rounds.length ? coverage.confidence : 'LOW';
      const now = new Date();
      await this.apply(tx, ctx, current, {
        status: 'COMPLETED',
        stopReason: 'STOPPED_BY_USER',
        coverageConfidence: confidence,
        completedAt: now,
        resumeStatus: null,
        retryAt: null,
        statusReason: null,
      });
      await tx.market.update({ where: { id: current.marketId }, data: { lastDiscoveryAt: now } });
      await writeAudit(tx, ctx, {
        action: 'discovery_mission.stopped',
        entityType: 'DISCOVERY_MISSION',
        entityId: id,
        before: { status: current.status },
        after: { status: 'COMPLETED', stopReason: 'STOPPED_BY_USER', coverageConfidence: confidence, reasons: coverage.reasons },
      });
      await recordEvent(tx, ctx, 'DiscoveryMissionCompleted', id, { missionId: id, stopReason: 'STOPPED_BY_USER', coverageConfidence: confidence, uniqueCompanies: current.uniqueCompanies });
    });
  }

  // ───────────────────────────── internals ─────────────────────────────

  private async transition(
    ctx: ServiceContext,
    id: string,
    version: number,
    from: DiscoveryMissionStatus[],
    verb: string,
    run: (tx: Tx, current: DiscoveryMission) => Promise<void>,
  ): Promise<MissionSummary> {
    await this.prisma.client.$transaction(async (tx) => {
      const current = await tx.discoveryMission.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
      if (!current) throw new NotFoundError(`discovery mission ${id} not found`);
      if (!from.includes(current.status)) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `A ${current.status.toLowerCase()} mission can't be ${verb}`);
      if (current.version !== version) throw new ConflictError('VERSION_CONFLICT', 'The mission changed meanwhile — reload and try again');
      await run(tx, current);
    });
    return this.query.summary(ctx.workspaceId, id);
  }

  /** Guarded write: conditional on the version and status we read, so a concurrent engine step or command is a clean conflict. */
  private async apply(tx: Tx, ctx: ServiceContext, current: DiscoveryMission, data: Partial<Pick<DiscoveryMission, 'status' | 'resumeStatus' | 'retryAt' | 'statusReason' | 'stopReason' | 'coverageConfidence' | 'completedAt'>>) {
    const { count } = await tx.discoveryMission.updateMany({
      where: { id: current.id, workspaceId: ctx.workspaceId, version: current.version, status: current.status },
      data: { ...data, version: { increment: 1 } },
    });
    if (count === 0) throw new ConflictError('VERSION_CONFLICT', 'The mission changed meanwhile — reload and try again');
  }

  /** Request + explicit fields → a confirmed market. Explicit fields win over the interpretation; nothing is guessed. */
  private resolve(input: PreviewMissionInput): ResolvedMarket {
    const interpretation = input.request?.trim() ? interpretMarketRequest(input.request) : null;
    const industryRaw = input.industry?.trim() || interpretation?.industry || null;
    const country = input.country || interpretation?.location.country || null;
    const missing: { path: string; message: string }[] = [];
    if (!industryRaw) missing.push({ path: 'industry', message: 'Business type is required (e.g. landscapers)' });
    if (!country) missing.push({ path: 'country', message: 'Location is required (at least a country)' });
    if (!industryRaw || !country) throw new ValidationError(`Missing ${missing.map((m) => m.path).join(' and ')}`, missing);

    // Per field: what the person set wins; the interpretation only fills gaps — and only from the same country, so an
    // explicit "GB" never inherits "TX" from the text.
    const sameCountry = !interpretation?.location.country || interpretation.location.country.toUpperCase() === country.toUpperCase();
    const region = input.region?.trim() || (sameCountry ? interpretation?.location.region : undefined);
    const city = input.city?.trim() || (sameCountry && (!input.region?.trim() || input.region.trim() === interpretation?.location.region) ? interpretation?.location.city : undefined);
    const location: MarketLocation = { country: country.toUpperCase(), ...(region ? { region } : {}), ...(city ? { city } : {}) };
    const industry = clean(industryRaw);
    const mode: DiscoveryMode = input.mode ?? interpretation?.mode ?? DEFAULT_MODE;

    const available = relatedCategories(industry);
    let selected: string[];
    if (DISCOVERY_MODES[mode].strategies.includes('RELATED_CATEGORY')) {
      if (input.categories) {
        const allowed = new Set(available.map(clean));
        const unknown = input.categories.filter((c) => !allowed.has(clean(c)));
        if (unknown.length) throw new ValidationError('Unknown categories for this market', unknown.map((c) => ({ path: 'categories', message: `"${c}" is not a related category of ${industryLabel(industry)}` })));
        selected = [...new Set(input.categories.map(clean))];
      } else {
        selected = available;
      }
    } else {
      selected = []; // Quick Hunt searches the main category only.
    }
    return { interpretation, industry, location, mode, available, selected };
  }

  /** Connected COMPANY_SEARCH sources in routing order (priority, then oldest connection) with their capability health. */
  private async searchSources(workspaceId: string) {
    const rows = await this.prisma.client.integration.findMany({
      where: { workspaceId, capabilities: { has: 'COMPANY_SEARCH' }, status: { notIn: [...UNUSABLE_INTEGRATION] } },
      include: { health: { where: { capability: 'COMPANY_SEARCH' } } },
      orderBy: [{ priority: 'asc' }, { connectedAt: 'asc' }],
    });
    return rows.map((i) => ({
      integrationId: i.id,
      provider: i.provider,
      name: i.name || providerDefinition(i.provider)?.name || i.provider,
      health: (i.health[0]?.state ?? (i.status === 'ACTIVE' ? 'UNKNOWN' : i.status)) as string,
    }));
  }
}
