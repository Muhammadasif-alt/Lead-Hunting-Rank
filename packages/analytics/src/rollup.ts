import { Prisma, type PrismaClient } from '@revenue-os/database';
import { backfillAttribution } from './attribution.js';
import { DAY, nowOf, startOfDay, type AnalyticsDeps } from './deps.js';

type Row = { day: string; dim: string | null; value: number | bigint | Prisma.Decimal | null };

/** Positive first-intents (MetricDefinition positiveReplies). */
export const POSITIVE_INTENTS = ['POSITIVE', 'QUESTION', 'PRICING', 'MEETING_REQUEST'] as const;
const POSITIVE_SQL = Prisma.raw(POSITIVE_INTENTS.map((i) => `'${i}'`).join(','));

/**
 * Set-based daily series per metric (UTC days). Each query returns (day, dimension id, value); a null dimension id is
 * the ALL row. Literals for enum values are inline (enum columns don't compare with text parameters).
 */
function metricQueries(ws: string, from: Date, to: Date): { metric: string; dimension: string; sql: Prisma.Sql }[] {
  const w = Prisma.sql`${ws}::uuid`;
  const f = Prisma.sql`${from}::timestamptz`;
  const t = Prisma.sql`${to}::timestamptz`;
  const day = (col: string) => Prisma.raw(`to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`);
  return [
    { metric: 'contacted', dimension: 'CAMPAIGN', sql: Prisma.sql`SELECT ${day('m."sentAt"')} AS day, m."campaignId"::text AS dim, COUNT(*) AS value FROM "CampaignMessage" m WHERE m."workspaceId" = ${w} AND m.status = 'SENT' AND m.position = 1 AND m."sentAt" >= ${f} AND m."sentAt" < ${t} GROUP BY 1, 2` },
    { metric: 'messagesSent', dimension: 'CAMPAIGN', sql: Prisma.sql`SELECT ${day('m."sentAt"')} AS day, m."campaignId"::text AS dim, COUNT(*) AS value FROM "CampaignMessage" m WHERE m."workspaceId" = ${w} AND m.status = 'SENT' AND m."sentAt" >= ${f} AND m."sentAt" < ${t} GROUP BY 1, 2` },
    { metric: 'messagesSent', dimension: 'REPLY', sql: Prisma.sql`SELECT ${day('r."sentAt"')} AS day, NULL::text AS dim, COUNT(*) AS value FROM "ConversationReply" r WHERE r."workspaceId" = ${w} AND r.status = 'SENT' AND r."sentAt" >= ${f} AND r."sentAt" < ${t} GROUP BY 1` },
    { metric: 'replies', dimension: 'CAMPAIGN', sql: Prisma.sql`SELECT ${day('c."createdAt"')} AS day, c."campaignId"::text AS dim, COUNT(*) AS value FROM "Conversation" c WHERE c."workspaceId" = ${w} AND c."createdAt" >= ${f} AND c."createdAt" < ${t} GROUP BY 1, 2` },
    {
      metric: 'positiveReplies',
      dimension: 'CAMPAIGN',
      sql: Prisma.sql`SELECT ${day('c."createdAt"')} AS day, c."campaignId"::text AS dim, COUNT(*) AS value FROM "Conversation" c
        JOIN LATERAL (SELECT k."primaryIntent" FROM "MessageClassification" k WHERE k."conversationId" = c.id ORDER BY k."createdAt" ASC LIMIT 1) fc ON TRUE
        WHERE c."workspaceId" = ${w} AND c."createdAt" >= ${f} AND c."createdAt" < ${t} AND fc."primaryIntent" IN (${POSITIVE_SQL}) GROUP BY 1, 2`,
    },
    { metric: 'opportunities', dimension: 'ALL', sql: Prisma.sql`SELECT ${day('o."createdAt"')} AS day, NULL::text AS dim, COUNT(*) AS value FROM "Opportunity" o WHERE o."workspaceId" = ${w} AND o."createdAt" >= ${f} AND o."createdAt" < ${t} GROUP BY 1` },
    { metric: 'qualifiedOpportunities', dimension: 'ALL', sql: Prisma.sql`SELECT ${day('o."createdAt"')} AS day, NULL::text AS dim, COUNT(*) AS value FROM "Opportunity" o JOIN "Qualification" q ON q."opportunityId" = o.id WHERE o."workspaceId" = ${w} AND q.status = 'QUALIFIED' AND o."createdAt" >= ${f} AND o."createdAt" < ${t} GROUP BY 1` },
    { metric: 'meetingsBooked', dimension: 'ALL', sql: Prisma.sql`SELECT ${day('m."bookedAt"')} AS day, NULL::text AS dim, COUNT(*) AS value FROM "Meeting" m WHERE m."workspaceId" = ${w} AND m."bookedAt" >= ${f} AND m."bookedAt" < ${t} GROUP BY 1` },
    { metric: 'wonDeals', dimension: 'ALL', sql: Prisma.sql`SELECT ${day('o."closedAt"')} AS day, NULL::text AS dim, COUNT(*) AS value FROM "Opportunity" o WHERE o."workspaceId" = ${w} AND o.status = 'WON' AND o."closedAt" >= ${f} AND o."closedAt" < ${t} GROUP BY 1` },
    { metric: 'wonRevenue', dimension: 'ALL', sql: Prisma.sql`SELECT ${day('e."occurredAt"')} AS day, NULL::text AS dim, SUM(CASE WHEN e.type = 'REFUND' THEN -e."amountMinor" ELSE e."amountMinor" END) AS value FROM "RevenueEvent" e WHERE e."workspaceId" = ${w} AND e."occurredAt" >= ${f} AND e."occurredAt" < ${t} GROUP BY 1` },
    { metric: 'providerCost', dimension: 'ALL', sql: Prisma.sql`SELECT ${day('p."startedAt"')} AS day, NULL::text AS dim, SUM(p."costMinor") AS value FROM "ProviderCallRecord" p WHERE p."workspaceId" = ${w} AND p."costMinor" IS NOT NULL AND p."startedAt" >= ${f} AND p."startedAt" < ${t} GROUP BY 1` },
    { metric: 'aiCost', dimension: 'ALL', sql: Prisma.sql`SELECT ${day('a."startedAt"')} AS day, NULL::text AS dim, SUM(a."costMinor") AS value FROM "AiRun" a WHERE a."workspaceId" = ${w} AND a."costMinor" IS NOT NULL AND a."startedAt" >= ${f} AND a."startedAt" < ${t} GROUP BY 1` },
    { metric: 'unsubscribes', dimension: 'ALL', sql: Prisma.sql`SELECT ${day('s."createdAt"')} AS day, NULL::text AS dim, COUNT(*) AS value FROM "Suppression" s WHERE s."workspaceId" = ${w} AND s.reason = 'UNSUBSCRIBED' AND s."createdAt" >= ${f} AND s."createdAt" < ${t} GROUP BY 1` },
    { metric: 'bounces', dimension: 'CAMPAIGN', sql: Prisma.sql`SELECT ${day('b."occurredAt"')} AS day, b."campaignId"::text AS dim, COUNT(*) AS value FROM "MailboxMessage" b WHERE b."workspaceId" = ${w} AND b.kind = 'BOUNCE' AND b."occurredAt" >= ${f} AND b."occurredAt" < ${t} GROUP BY 1, 2` },
    {
      metric: 'companiesDiscovered',
      dimension: 'MARKET',
      sql: Prisma.sql`SELECT ${day('c."createdAt"')} AS day, fo."marketId"::text AS dim, COUNT(*) AS value FROM "Company" c
        JOIN LATERAL (SELECT dm."marketId" FROM "DiscoveryObservation" o JOIN "DiscoveryMission" dm ON dm.id = o."missionId" WHERE o."companyId" = c.id ORDER BY o."observedAt" ASC LIMIT 1) fo ON TRUE
        WHERE c."workspaceId" = ${w} AND c."createdAt" >= ${f} AND c."createdAt" < ${t} GROUP BY 1, 2`,
    },
    { metric: 'verifiedContacts', dimension: 'ALL', sql: Prisma.sql`SELECT ${day('v."verifiedAt"')} AS day, NULL::text AS dim, COUNT(DISTINCT v."contactPointId") AS value FROM "ContactVerification" v WHERE v."workspaceId" = ${w} AND v.status = 'VALID' AND v."verifiedAt" >= ${f} AND v."verifiedAt" < ${t} GROUP BY 1` },
  ];
}

export interface RollupResult {
  workspaces: number;
  rows: number;
  attributed: number;
}

/**
 * Rebuilds the DailyMetric projection for the last N days (docs/04 §45): derived, never the source of truth. Per
 * workspace: compute each metric set-based, then replace the window's rows in one transaction (idempotent — running it
 * twice gives the same rows). ALL rows plus CAMPAIGN / MARKET dimensions where cheap. Also attributes deals that have
 * no touches yet (backfill) and records an AnalyticsRun (ROLLUP) for freshness.
 */
export async function rollupDailyMetrics(deps: AnalyticsDeps, opts: { workspaceId?: string; days?: number } = {}): Promise<RollupResult> {
  const days = Math.min(400, Math.max(1, opts.days ?? 35));
  const now = nowOf(deps);
  const to = new Date(startOfDay(now).getTime() + DAY);
  const from = new Date(to.getTime() - days * DAY);
  const workspaces = opts.workspaceId ? [{ id: opts.workspaceId }] : await deps.db.workspace.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
  let total = 0;
  let attributed = 0;
  for (const ws of workspaces) {
    const startedAt = new Date();
    try {
      attributed += await backfillAttribution(deps, ws.id);
      const rows = await computeRows(deps.db, ws.id, from, to);
      await deps.db.$transaction(async (tx) => {
        await tx.dailyMetric.deleteMany({ where: { workspaceId: ws.id, day: { gte: from, lt: to } } });
        if (rows.length) await tx.dailyMetric.createMany({ data: rows.map((r) => ({ workspaceId: ws.id, day: r.day, metric: r.metric, dimension: r.dimension, dimensionId: r.dimensionId, value: r.value, computedAt: startedAt })) });
        await tx.analyticsRun.create({ data: { workspaceId: ws.id, kind: 'ROLLUP', status: 'SUCCEEDED', fromDay: from, toDay: new Date(to.getTime() - DAY), rows: rows.length, startedAt, finishedAt: new Date() } });
      }, { timeout: 60_000, maxWait: 10_000 });
      total += rows.length;
    } catch (err) {
      await deps.db.analyticsRun.create({ data: { workspaceId: ws.id, kind: 'ROLLUP', status: 'FAILED', fromDay: from, toDay: new Date(to.getTime() - DAY), error: String(err instanceof Error ? err.message : err).slice(0, 500), startedAt, finishedAt: new Date() } }).catch(() => undefined);
      if (opts.workspaceId) throw err;
    }
  }
  return { workspaces: workspaces.length, rows: total, attributed };
}

type MetricRow = { day: Date; metric: string; dimension: string; dimensionId: string; value: number };

async function computeRows(db: PrismaClient, workspaceId: string, from: Date, to: Date): Promise<MetricRow[]> {
  const acc = new Map<string, MetricRow>();
  const add = (day: Date, metric: string, dimension: string, dimensionId: string, value: number) => {
    if (!value) return;
    const d = startOfDay(day);
    const key = `${d.toISOString()}|${metric}|${dimension}|${dimensionId}`;
    const cur = acc.get(key);
    if (cur) cur.value += value;
    else acc.set(key, { day: d, metric, dimension, dimensionId, value });
  };
  for (const q of metricQueries(workspaceId, from, to)) {
    const rows = await db.$queryRaw<Row[]>(q.sql);
    for (const r of rows) {
      const v = Number(r.value ?? 0);
      const utcDay = new Date(`${r.day}T00:00:00.000Z`);
      add(utcDay, q.metric, 'ALL', '', v);
      if (r.dim && q.dimension !== 'ALL' && q.dimension !== 'REPLY') add(utcDay, q.metric, q.dimension, r.dim, v);
    }
  }
  return [...acc.values()];
}

/** Daily series of one metric (ALL or one dimension) from the projection, zero-filled. */
export async function metricSeries(db: PrismaClient, workspaceId: string, metric: string, from: Date, to: Date, dimension = 'ALL', dimensionId = ''): Promise<{ day: string; value: number }[]> {
  const rows = await db.dailyMetric.findMany({ where: { workspaceId, metric, dimension, dimensionId, day: { gte: startOfDay(from), lt: to } }, select: { day: true, value: true } });
  const byDay = new Map(rows.map((r) => [r.day.toISOString().slice(0, 10), r.value]));
  const out: { day: string; value: number }[] = [];
  for (let t = startOfDay(from).getTime(); t < to.getTime(); t += DAY) {
    const k = new Date(t).toISOString().slice(0, 10);
    out.push({ day: k, value: byDay.get(k) ?? 0 });
  }
  return out;
}
