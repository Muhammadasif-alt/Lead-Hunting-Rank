import { Injectable } from '@nestjs/common';
import { Prisma, type CoverageAssessment, type DiscoveryMission, type DiscoveryMissionStatus, type DiscoveryQuery, type Market } from '@revenue-os/database';
import { providerDefinition } from '@revenue-os/providers';
import { NotFoundError, ValidationError, type PermissionKey } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';
import type { MissionCompaniesQuery } from './discovery.schemas.js';

/** Mission is doing work (or will continue by itself / on resume) — one per market at a time. */
export const ACTIVE_MISSION_STATUSES: DiscoveryMissionStatus[] = ['PLANNING', 'DISCOVERING', 'RESOLVING', 'ASSESSING_COVERAGE', 'WAITING', 'PAUSED'];
export const PAUSABLE_STATUSES: DiscoveryMissionStatus[] = ['PLANNING', 'DISCOVERING', 'RESOLVING', 'ASSESSING_COVERAGE', 'WAITING'];
export const RESUMABLE_STATUSES: DiscoveryMissionStatus[] = ['PAUSED', 'BLOCKED', 'WAITING'];
export const TERMINAL_STATUSES: DiscoveryMissionStatus[] = ['COMPLETED', 'FAILED', 'CANCELLED'];
export const STOPPABLE_STATUSES: DiscoveryMissionStatus[] = ['DRAFT', 'READY', 'PLANNING', 'DISCOVERING', 'RESOLVING', 'ENRICHING', 'ASSESSING_COVERAGE', 'PAUSED', 'WAITING', 'BLOCKED'];

export type MissionAction = 'pause' | 'resume' | 'stop';

export function allowedMissionActions(status: DiscoveryMissionStatus, permissions: ReadonlySet<PermissionKey>): MissionAction[] {
  if (!permissions.has('market.run')) return [];
  const actions: MissionAction[] = [];
  if (PAUSABLE_STATUSES.includes(status)) actions.push('pause');
  if (RESUMABLE_STATUSES.includes(status)) actions.push('resume');
  if (STOPPABLE_STATUSES.includes(status)) actions.push('stop');
  return actions;
}

export const providerName = (key: string) => providerDefinition(key)?.name ?? key;

type MissionWithMarket = DiscoveryMission & { market: Pick<Market, 'name' | 'country' | 'region' | 'city' | 'industry'> };

/** Explicit response shape — Prisma rows never go to the browser as-is (docs/14 §19). No lease or internal resume state. */
export function presentMission(m: MissionWithMarket, createdBy: { id: string; name: string } | null) {
  return {
    id: m.id,
    version: m.version,
    marketId: m.marketId,
    market: { name: m.market.name, country: m.market.country, region: m.market.region, city: m.market.city, industry: m.market.industry },
    mode: m.mode,
    status: m.status,
    statusReason: m.statusReason,
    stopReason: m.stopReason,
    coverageConfidence: m.coverageConfidence,
    currentRound: m.currentRound,
    maxRounds: m.maxRounds,
    queriesExecuted: m.queriesExecuted,
    maxQueries: m.maxQueries,
    providerCalls: m.providerCalls,
    maxProviderCalls: m.maxProviderCalls,
    targetCount: m.targetCount,
    failedQueries: m.failedQueries,
    observationsCount: m.observationsCount,
    uniqueCompanies: m.uniqueCompanies,
    newCompanies: m.newCompanies,
    matchedExisting: m.matchedExisting,
    duplicateObservations: m.duplicateObservations,
    reviewCandidates: m.reviewCandidates,
    rejectedObservations: m.rejectedObservations,
    withWebsite: m.withWebsite,
    withoutWebsite: m.withoutWebsite,
    withPhone: m.withPhone,
    sourcesUsed: m.sourcesUsed,
    categories: m.categories,
    request: m.request,
    retryAt: m.retryAt,
    startedAt: m.startedAt,
    completedAt: m.completedAt,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    createdBy,
  };
}
export type MissionSummary = ReturnType<typeof presentMission>;

function presentRound(r: CoverageAssessment) {
  return {
    round: r.round,
    queries: r.queries,
    observations: r.observations,
    newUnique: r.newUnique,
    cumulativeUnique: r.cumulativeUnique,
    marginalYield: r.marginalYield,
    duplicateRate: r.duplicateRate,
    confidence: r.confidence,
    decision: r.decision,
    stopReason: r.stopReason,
    reasons: r.reasons,
    strategiesRemaining: r.strategiesRemaining,
    assessedAt: r.assessedAt,
  };
}

function presentQuery(q: DiscoveryQuery) {
  return {
    id: q.id,
    round: q.round,
    queryType: q.queryType,
    queryText: q.queryText,
    provider: q.provider,
    providerName: providerName(q.provider),
    status: q.status,
    pagesFetched: q.pagesFetched,
    resultCount: q.resultCount,
    newUniqueCount: q.newUniqueCount,
    exhausted: q.exhausted,
    error: q.error,
    startedAt: q.startedAt,
    completedAt: q.completedAt,
  };
}

const marketSelect = { select: { name: true, country: true, region: true, city: true, industry: true } } as const;

/** Keyset cursor over (displayName, companyId) — opaque to the client. */
const encodeCursor = (displayName: string, id: string) => Buffer.from(JSON.stringify([displayName, id])).toString('base64url');
function decodeCursor(cursor: string): [string, string] {
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'string' && /^[0-9a-f-]{36}$/i.test(v[1])) return [v[0], v[1]];
  } catch {
    // fall through
  }
  throw new ValidationError('Invalid cursor', [{ path: 'cursor', message: 'Invalid cursor' }]);
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

interface CompanyRow {
  companyId: string;
  displayName: string;
  websiteDomain: string | null;
  phone: string | null;
  city: string | null;
  region: string | null;
  status: string;
  outcome: 'CREATED' | 'MATCHED_EXISTING';
  providers: string[];
  listings: number;
  firstRound: number;
  flaggedForReview: boolean;
  total: number;
}

/** Read models for the Lead Hunter screen (docs/screens/03). Read only — every write goes through DiscoveryService. */
@Injectable()
export class DiscoveryQueryService {
  constructor(private readonly prisma: PrismaService) {}

  private async creators(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((i): i is string => Boolean(i)))];
    if (!unique.length) return new Map<string, { id: string; name: string }>();
    const users = await this.prisma.client.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
    return new Map(users.map((u) => [u.id, u]));
  }

  async summary(workspaceId: string, id: string): Promise<MissionSummary> {
    const m = await this.prisma.client.discoveryMission.findFirst({ where: { id, workspaceId }, include: { market: marketSelect } });
    if (!m) throw new NotFoundError(`discovery mission ${id} not found`);
    const users = await this.creators([m.createdBy]);
    return presentMission(m, m.createdBy ? (users.get(m.createdBy) ?? null) : null);
  }

  async list(workspaceId: string, q: { cursor?: string; limit: number }) {
    const rows = await this.prisma.client.discoveryMission.findMany({
      where: { workspaceId },
      include: { market: marketSelect },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.limit);
    const users = await this.creators(page.map((m) => m.createdBy));
    return {
      items: page.map((m) => presentMission(m, m.createdBy ? (users.get(m.createdBy) ?? null) : null)),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
    };
  }

  async detail(workspaceId: string, id: string, permissions: ReadonlySet<PermissionKey>) {
    const db = this.prisma.client;
    const m = await db.discoveryMission.findFirst({ where: { id, workspaceId }, include: { market: marketSelect } });
    if (!m) throw new NotFoundError(`discovery mission ${id} not found`);

    const [users, rounds, queries, queryCounts, observationCounts, uniqueByProvider, [research]] = await Promise.all([
      this.creators([m.createdBy]),
      db.coverageAssessment.findMany({ where: { workspaceId, missionId: id }, orderBy: { round: 'asc' } }),
      db.discoveryQuery.findMany({ where: { workspaceId, missionId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100 }),
      db.discoveryQuery.groupBy({ by: ['provider'], where: { workspaceId, missionId: id }, _count: true }),
      db.discoveryObservation.groupBy({ by: ['provider'], where: { workspaceId, missionId: id }, _count: true }),
      db.$queryRaw<{ provider: string; unique: number }[]>`
        SELECT o.provider, count(DISTINCT COALESCE(c."mergedIntoId", c.id))::int AS "unique"
        FROM "DiscoveryObservation" o
        JOIN "Company" c ON c.id = o."companyId" AND c."workspaceId" = o."workspaceId"
        WHERE o."workspaceId" = ${workspaceId}::uuid AND o."missionId" = ${id}::uuid AND o.status = 'RESOLVED'
        GROUP BY o.provider`,
      // Research of the businesses this mission found (Phase 8): latest run per company, active hypotheses.
      db.$queryRaw<{ companies: number; researched: number; active: number; failed: number; hypotheses: number }[]>`
        WITH comp AS (
          SELECT DISTINCT COALESCE(c."mergedIntoId", c.id) AS cid
          FROM "DiscoveryObservation" o
          JOIN "Company" c ON c.id = o."companyId" AND c."workspaceId" = o."workspaceId"
          WHERE o."workspaceId" = ${workspaceId}::uuid AND o."missionId" = ${id}::uuid AND o.status = 'RESOLVED'
        ), latest AS (
          SELECT DISTINCT ON (r."companyId") r."companyId", r.status
          FROM "ResearchRun" r JOIN comp ON comp.cid = r."companyId"
          WHERE r."workspaceId" = ${workspaceId}::uuid
          ORDER BY r."companyId", r."createdAt" DESC
        )
        SELECT (SELECT count(*) FROM comp)::int AS companies,
               count(*) FILTER (WHERE status IN ('COMPLETED', 'PARTIAL'))::int AS researched,
               count(*) FILTER (WHERE status IN ('QUEUED', 'RUNNING', 'WAITING'))::int AS active,
               count(*) FILTER (WHERE status = 'FAILED')::int AS failed,
               (SELECT count(*) FROM "OpportunityHypothesis" h JOIN comp ON comp.cid = h."companyId"
                 WHERE h."workspaceId" = ${workspaceId}::uuid AND h.status = 'ACTIVE')::int AS hypotheses
        FROM latest`,
    ]);

    const providers = [...new Set([...queryCounts.map((q) => q.provider), ...observationCounts.map((o) => o.provider)])].sort();
    return {
      ...presentMission(m, m.createdBy ? (users.get(m.createdBy) ?? null) : null),
      rounds: rounds.map(presentRound),
      queries: queries.map(presentQuery),
      sources: providers.map((provider) => ({
        provider,
        name: providerName(provider),
        queries: queryCounts.find((q) => q.provider === provider)?._count ?? 0,
        observations: observationCounts.find((o) => o.provider === provider)?._count ?? 0,
        uniqueCompanies: uniqueByProvider.find((u) => u.provider === provider)?.unique ?? 0,
      })),
      research: research ?? { companies: 0, researched: 0, active: 0, failed: 0, hypotheses: 0 },
      // The UI shows only what the server says is allowed now (docs/09 §67); the API still enforces every command.
      allowedActions: allowedMissionActions(m.status, permissions),
    };
  }

  /**
   * Businesses a mission found, one row per canonical company (merged records count as their survivor). A business
   * counts as CREATED when this mission created it, otherwise MATCHED_EXISTING; duplicate listings add to `listings`.
   */
  async companies(workspaceId: string, missionId: string, q: MissionCompaniesQuery) {
    const db = this.prisma.client;
    const exists = await db.discoveryMission.findFirst({ where: { id: missionId, workspaceId }, select: { id: true } });
    if (!exists) throw new NotFoundError(`discovery mission ${missionId} not found`);

    const filters: Prisma.Sql[] = [];
    if (q.website === 'with') filters.push(Prisma.sql`k."websiteDomain" IS NOT NULL`);
    if (q.website === 'without') filters.push(Prisma.sql`k."websiteDomain" IS NULL`);
    if (q.phone === 'with') filters.push(Prisma.sql`k.phone IS NOT NULL`);
    if (q.outcome) filters.push(Prisma.sql`g.outcome = ${q.outcome}`);
    const term = q.q?.trim();
    if (term) {
      const like = `%${likeEscape(term)}%`;
      filters.push(Prisma.sql`(k."displayName" ILIKE ${like} OR k."websiteDomain" ILIKE ${like} OR k.city ILIKE ${like} OR k.phone LIKE ${like})`);
    }
    const where = filters.length ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;
    const after = q.cursor ? decodeCursor(q.cursor) : null;
    const keyset = after ? Prisma.sql`WHERE (x."displayName", x."companyId") > (${after[0]}, ${after[1]}::uuid)` : Prisma.empty;

    const rows = await db.$queryRaw<CompanyRow[]>`
      WITH obs AS (
        SELECT COALESCE(c."mergedIntoId", c.id) AS cid, o.outcome, o.provider, o.round, o."flaggedForReview"
        FROM "DiscoveryObservation" o
        JOIN "Company" c ON c.id = o."companyId" AND c."workspaceId" = o."workspaceId"
        WHERE o."workspaceId" = ${workspaceId}::uuid
          AND o."missionId" = ${missionId}::uuid
          AND o.status = 'RESOLVED'
          AND o.outcome IN ('CREATED', 'MATCHED_EXISTING', 'DUPLICATE_LISTING')
      ), g AS (
        SELECT cid,
               CASE WHEN bool_or(outcome = 'CREATED') THEN 'CREATED' ELSE 'MATCHED_EXISTING' END AS outcome,
               array_agg(DISTINCT provider ORDER BY provider) AS providers,
               count(*)::int AS listings,
               min(round)::int AS "firstRound",
               bool_or("flaggedForReview") AS "flaggedForReview"
        FROM obs GROUP BY cid
      )
      SELECT x.* FROM (
        SELECT k.id AS "companyId", k."displayName", k."websiteDomain", k.phone, k.city, k.region, k.status::text AS status,
               g.outcome, g.providers, g.listings, g."firstRound", g."flaggedForReview", count(*) OVER ()::int AS total
        FROM g JOIN "Company" k ON k.id = g.cid AND k."workspaceId" = ${workspaceId}::uuid
        ${where}
      ) x
      ${keyset}
      ORDER BY x."displayName" ASC, x."companyId" ASC
      LIMIT ${q.limit + 1}`;

    const page = rows.slice(0, q.limit);
    let total = rows[0]?.total;
    if (total === undefined) {
      // Past the last page (or nothing matches): the window count isn't available, so count without the keyset.
      total = after ? (await this.companies(workspaceId, missionId, { ...q, cursor: undefined, limit: 1 })).total : 0;
    }
    const last = page[page.length - 1];
    const ids = page.map((r) => r.companyId);
    const [runs, hyps] = ids.length
      ? await Promise.all([
          db.researchRun.findMany({ where: { workspaceId, companyId: { in: ids } }, orderBy: { createdAt: 'desc' }, distinct: ['companyId'], select: { companyId: true, status: true } }),
          db.opportunityHypothesis.groupBy({ by: ['companyId'], where: { workspaceId, companyId: { in: ids }, status: 'ACTIVE' }, _count: true }),
        ])
      : [[], []];
    return {
      items: page.map(({ providers, total: _t, ...r }) => ({
        ...r,
        sources: providers.map(providerName),
        research: { status: runs.find((x) => x.companyId === r.companyId)?.status ?? null, hypotheses: hyps.find((h) => h.companyId === r.companyId)?._count ?? 0 },
      })),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.displayName, last.companyId) : null,
      total,
    };
  }

  /** Markets the workspace hunts in, with their latest mission (docs/06 §10-14: market ≠ search). */
  async markets(workspaceId: string) {
    const rows = await this.prisma.client.market.findMany({
      where: { workspaceId, status: 'ACTIVE' },
      include: {
        _count: { select: { missions: true } },
        missions: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, status: true, coverageConfidence: true, uniqueCompanies: true } },
      },
      orderBy: [{ lastDiscoveryAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
    });
    return {
      items: rows.map((m) => {
        const latest = m.missions[0];
        return {
          id: m.id,
          name: m.name,
          country: m.country,
          region: m.region,
          city: m.city,
          industry: m.industry,
          lastDiscoveryAt: m.lastDiscoveryAt,
          missions: m._count.missions,
          uniqueCompanies: latest?.uniqueCompanies ?? 0,
          latestMission: latest ? { id: latest.id, status: latest.status, coverageConfidence: latest.coverageConfidence } : null,
        };
      }),
    };
  }
}
