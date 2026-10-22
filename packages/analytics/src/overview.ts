import type { PrismaClient } from '@revenue-os/database';
import {
  attributeDeal,
  buildFunnel,
  compareKpi,
  detectAnomalies,
  FUNNEL_STAGE_LABEL,
  FUNNEL_STAGES,
  METRICS,
  STAGE_SEMANTIC_INFO,
  type AnalyticsFilters,
  type AnalyticsOverview,
  type AttributionModel,
  type AttributionReport,
  type AttributionRow,
  type DrillResult,
  type FunnelStageKey,
  type Insight,
  type KpiValue,
  type MetricKey,
  type RecordRef,
  type StageSemantic,
  type TouchLike,
  type TouchTypeKey,
} from '@revenue-os/shared';
import { lineages, personaOf } from './attribution.js';
import { DAY, HREF, startOfDay } from './deps.js';
import { firstIntents, freshness, funnelCohort, isPositive, pct, stageBaselines, windowMetrics, type WindowMetrics } from './metrics.js';
import { metricSeries } from './rollup.js';
import { between, oppWhere, resolveScope, revenueWhere, type Scope } from './scope.js';

export const workspaceCurrency = async (db: PrismaClient, workspaceId: string) => (await db.workspace.findUnique({ where: { id: workspaceId }, select: { currency: true } }))?.currency ?? 'USD';

const kpi = (key: MetricKey, cur: WindowMetrics, prev: WindowMetrics, pick: (m: WindowMetrics) => number | null, sample?: (m: WindowMetrics) => number, partial?: (m: WindowMetrics) => boolean): KpiValue => {
  const k = compareKpi(key, pick(cur), pick(prev), sample ? Math.min(sample(cur), sample(prev)) : undefined);
  return partial?.(cur) ? { ...k, partial: true } : k;
};

const costTotal = (m: WindowMetrics) => (m.providerCost === null && m.aiCost === null ? null : (m.providerCost ?? 0) + (m.aiCost ?? 0));
const costPerMeeting = (m: WindowMetrics) => {
  const c = costTotal(m);
  return c === null || m.meetingsBooked === 0 ? null : Math.round(c / m.meetingsBooked);
};

/** Open deals sitting in their stage longer than the historical median for that stage (records, not a score). */
export async function agingDeals(db: PrismaClient, s: Scope): Promise<{ refs: RecordRef[]; baselines: Map<string, { days: number | null; samples: number }>; bySemantic: Map<string, number> }> {
  const baselines = await stageBaselines(db, s.workspaceId);
  const open = await db.opportunity.findMany({ where: oppWhere(s, { status: 'OPEN' }), select: { id: true, name: true, stageEnteredAt: true, stage: { select: { semantic: true } } } });
  const refs: RecordRef[] = [];
  const bySemantic = new Map<string, number>();
  for (const o of open) {
    const b = baselines.get(o.stage.semantic)?.days;
    if (b == null) continue;
    const age = (s.now.getTime() - o.stageEnteredAt.getTime()) / DAY;
    if (age <= b) continue;
    bySemantic.set(o.stage.semantic, (bySemantic.get(o.stage.semantic) ?? 0) + 1);
    refs.push({ type: 'OPPORTUNITY', id: o.id, label: o.name, href: HREF.opportunity(o.id), detail: `${Math.round(age)} d in ${STAGE_SEMANTIC_INFO[o.stage.semantic as StageSemantic]?.label ?? o.stage.semantic} (usually ${b} d)` });
  }
  return { refs: refs.slice(0, 50), baselines, bySemantic };
}

/** Business outcomes first, then sales, outreach and operations — each against the previous period (screen #10 §5-12). */
export async function overview(db: PrismaClient, workspaceId: string, filters: AnalyticsFilters, now = new Date()): Promise<AnalyticsOverview> {
  const s = await resolveScope(db, workspaceId, filters, now);
  const [cur, prev, currency, pipeline, pipelineUnvalued, fCur, fPrev, aging, fresh] = await Promise.all([
    windowMetrics(db, s, s.from, s.to),
    windowMetrics(db, s, s.prevFrom, s.prevTo),
    workspaceCurrency(db, workspaceId),
    db.opportunity.aggregate({ where: oppWhere(s, { status: 'OPEN', amountMinor: { not: null } }), _sum: { amountMinor: true }, _count: { _all: true } }),
    db.opportunity.count({ where: oppWhere(s, { status: 'OPEN', amountMinor: null }) }),
    funnelCohort(db, s, s.from, s.to),
    funnelCohort(db, s, s.prevFrom, s.prevTo),
    agingDeals(db, s),
    freshness(db, workspaceId, now),
  ]);
  const won = (m: WindowMetrics) => m.wonDeals;
  const closed = (m: WindowMetrics) => m.wonDeals + m.lostDeals;
  const outcomes: KpiValue[] = [
    kpi('wonRevenue', cur, prev, (m) => m.wonRevenue, won),
    kpi('wonDeals', cur, prev, won),
    { ...compareKpi('openPipeline', pipeline._sum.amountMinor ?? 0, null), lowSample: pipeline._count._all < 10, ...(pipelineUnvalued ? { partial: true } : {}) },
    kpi('qualifiedOpportunities', cur, prev, (m) => m.qualifiedOpportunities),
    kpi('meetingsBooked', cur, prev, (m) => m.meetingsBooked),
    kpi('opportunities', cur, prev, (m) => m.opportunities),
  ];
  const sales: KpiValue[] = [
    kpi('winRate', cur, prev, (m) => pct(m.wonDeals, closed(m)), closed),
    kpi('salesCycleDays', cur, prev, (m) => m.salesCycleDays, won),
    kpi('meetingsHeld', cur, prev, (m) => m.meetingsHeld),
  ];
  const outreach: KpiValue[] = [
    kpi('contacted', cur, prev, (m) => m.contacted),
    kpi('replies', cur, prev, (m) => m.replies),
    kpi('positiveReplies', cur, prev, (m) => m.positiveReplies),
    kpi('replyRate', cur, prev, (m) => pct(m.replies, m.contacted), (m) => m.contacted),
  ];
  const operations: KpiValue[] = [
    kpi('providerCost', cur, prev, (m) => m.providerCost, (m) => m.providerCalls, (m) => m.providerUnknown > 0),
    kpi('aiCost', cur, prev, (m) => m.aiCost, (m) => m.aiRuns, (m) => m.aiUnknown > 0),
    kpi('costPerMeeting', cur, prev, costPerMeeting, (m) => m.meetingsBooked, (m) => m.providerUnknown + m.aiUnknown > 0),
    kpi('bounces', cur, prev, (m) => m.bounces),
    kpi('unsubscribes', cur, prev, (m) => m.unsubscribes),
  ];

  const funnel = buildFunnel(fCur.counts, fPrev.counts);
  const insights: Insight[] = [];
  const leak = funnel.find((f) => f.leak);
  if (leak) {
    const i = FUNNEL_STAGES.indexOf(leak.key);
    const before = funnel[i - 1]!;
    insights.push({
      kind: 'BOTTLENECK',
      title: `Biggest leak: ${before.label} → ${leak.label}`,
      detail: `${leak.conversion}% of companies at "${before.label}" reached "${leak.label}" this period.`,
      evidence: [`${leak.count} of ${before.count} companies (${leak.conversion}%)`, leak.previousConversion !== null ? `Previous period: ${leak.previousConversion}%` : 'No comparable previous period'],
      records: [],
      drill: { metric: `funnel.${before.key}` },
    });
  }
  if (aging.refs.length) {
    const top = [...aging.bySemantic].sort((a, b) => b[1] - a[1])[0]!;
    insights.push({
      kind: 'STAGE_AGING',
      title: `${aging.refs.length} open deal(s) are older than usual in their stage`,
      detail: `Most of them in ${STAGE_SEMANTIC_INFO[top[0] as StageSemantic]?.label ?? top[0]} (${top[1]}). The baseline is the median time past deals spent in that stage.`,
      evidence: [...aging.bySemantic].map(([sem, n]) => `${STAGE_SEMANTIC_INFO[sem as StageSemantic]?.label ?? sem}: ${n} deal(s), usually ${aging.baselines.get(sem)?.days} d`),
      records: aging.refs.slice(0, 10),
      drill: { metric: 'openPipeline', filters: { stage: top[0] } },
    });
  }
  if (!s.companyIds && !s.ownerId) {
    const from = new Date(startOfDay(now).getTime() - 42 * DAY);
    const to = new Date(startOfDay(now).getTime() + DAY);
    for (const metric of ['replies', 'positiveReplies', 'meetingsBooked', 'messagesSent', 'bounces', 'unsubscribes'] as MetricKey[]) {
      const series = await metricSeries(db, workspaceId, metric, from, to);
      const recent = detectAnomalies(metric, series).filter((a) => new Date(a.day).getTime() >= to.getTime() - 8 * DAY);
      const a = recent[recent.length - 1];
      if (!a) continue;
      insights.push({
        kind: 'ANOMALY',
        title: `${METRICS[metric].label}: unusual ${a.direction === 'SPIKE' ? 'spike' : 'drop'} on ${a.day}`,
        detail: `${a.value} vs a usual ${a.baseline} per day (${Math.abs(a.score)} standard deviations).`,
        evidence: [`${a.day}: ${a.value}`, `14-day baseline: ${a.baseline}/day`],
        records: [],
        drill: { metric },
      });
    }
  }
  if (cur.providerUnknown + cur.aiUnknown > 0)
    insights.push({
      kind: 'COST',
      title: 'Some costs are unknown',
      detail: 'Some provider calls or AI runs did not report a cost. They are counted as unknown — totals are a lower bound, not the full cost.',
      evidence: [`${cur.providerUnknown} provider call(s) without a cost`, `${cur.aiUnknown} AI run(s) without a cost`],
      records: [],
      drill: { metric: 'providerCost' },
    });

  const timeline = await weeklyTimeline(db, s);
  const empty = cur.contacted + cur.messagesSent + cur.replies + cur.opportunities + cur.wonDeals + cur.meetingsBooked + (cur.wonRevenue ? 1 : 0) + pipeline._count._all + pipelineUnvalued === 0;
  return { period: s.period, previous: s.previous, outcomes, sales, outreach, operations, openPipelineUnvalued: pipelineUnvalued, funnel, insights, timeline, freshness: fresh, currency, empty };
}

async function weeklyTimeline(db: PrismaClient, s: Scope): Promise<AnalyticsOverview['timeline']> {
  const win = between(s.from, s.to);
  const [rev, won, meetings, opps] = await Promise.all([
    db.revenueEvent.findMany({ where: await revenueWhere(db, s, { occurredAt: win }), select: { type: true, amountMinor: true, occurredAt: true } }),
    db.opportunity.findMany({ where: oppWhere(s, { status: 'WON', closedAt: win }), select: { closedAt: true } }),
    db.meeting.findMany({ where: { workspaceId: s.workspaceId, ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}), ...(s.ownerId ? { ownerUserId: s.ownerId } : {}), bookedAt: win }, select: { bookedAt: true } }),
    db.opportunity.findMany({ where: oppWhere(s, { createdAt: win }), select: { createdAt: true } }),
  ]);
  const weeks: AnalyticsOverview['timeline'] = [];
  for (let t = s.from.getTime(); t < s.to.getTime(); t += 7 * DAY) weeks.push({ week: new Date(t).toISOString().slice(0, 10), revenueMinor: 0, won: 0, meetings: 0, opportunities: 0 });
  const idx = (d: Date) => Math.min(weeks.length - 1, Math.floor((d.getTime() - s.from.getTime()) / (7 * DAY)));
  for (const r of rev) weeks[idx(r.occurredAt)]!.revenueMinor += r.type === 'REFUND' ? -r.amountMinor : r.amountMinor;
  for (const o of won) weeks[idx(o.closedAt!)]!.won++;
  for (const m of meetings) weeks[idx(m.bookedAt!)]!.meetings++;
  for (const o of opps) weeks[idx(o.createdAt)]!.opportunities++;
  return weeks;
}

// ───────────────────────────── attribution report ─────────────────────────────

type Dim = keyof AttributionReport['byDimension'];
const DIMS: Dim[] = ['market', 'source', 'signalType', 'campaign', 'industry', 'persona', 'owner'];
const TOUCH_DIM: Partial<Record<TouchTypeKey, Dim>> = { MARKET: 'market', DISCOVERY: 'source', SIGNAL: 'signalType', CAMPAIGN: 'campaign' };

const dimKey = (dim: Dim, t: { touchType: string; sourceId: string; label: string; detail: Record<string, unknown> }): { key: string; label: string; href: string | null } | null => {
  switch (dim) {
    case 'market':
      return { key: t.sourceId, label: t.label, href: HREF.market(t.sourceId) };
    case 'source': {
      const p = String(t.detail.provider ?? 'unknown');
      return { key: p, label: p, href: null };
    }
    case 'signalType': {
      const ty = String(t.detail.signalType ?? 'UNKNOWN');
      return { key: ty, label: ty.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()), href: null };
    }
    case 'campaign':
      return { key: t.sourceId, label: t.label, href: HREF.campaign(t.sourceId) };
    default:
      return null;
  }
};

/**
 * Where revenue and pipeline came from (screen #10 §14-20): revenue events in the period credited along each deal's
 * stored chain under the chosen model; deal attributes (industry, persona, owner) carry the whole deal. Open deals add
 * pipeline. Deals without touches are counted as unattributed, never guessed.
 */
export async function attributionReport(db: PrismaClient, workspaceId: string, filters: AnalyticsFilters, model: AttributionModel, now = new Date()): Promise<AttributionReport> {
  const s = await resolveScope(db, workspaceId, filters, now);
  const win = between(s.from, s.to);
  const revenue = await db.revenueEvent.findMany({ where: await revenueWhere(db, s, { occurredAt: win }), select: { opportunityId: true, type: true, amountMinor: true } });
  const revenueByDeal = new Map<string, number>();
  for (const r of revenue) revenueByDeal.set(r.opportunityId, (revenueByDeal.get(r.opportunityId) ?? 0) + (r.type === 'REFUND' ? -r.amountMinor : r.amountMinor));
  const [open, created, wonInPeriod] = await Promise.all([
    db.opportunity.findMany({ where: oppWhere(s, { status: 'OPEN' }), select: { id: true, amountMinor: true } }),
    db.opportunity.findMany({ where: oppWhere(s, { createdAt: win }), select: { id: true } }),
    db.opportunity.findMany({ where: oppWhere(s, { status: 'WON', closedAt: win }), select: { id: true } }),
  ]);
  const dealIds = [...new Set([...revenueByDeal.keys(), ...open.map((o) => o.id), ...created.map((o) => o.id), ...wonInPeriod.map((o) => o.id)])];
  const deals = dealIds.length ? await db.opportunity.findMany({ where: { workspaceId, id: { in: dealIds } }, select: { id: true, name: true, companyId: true, status: true, amountMinor: true, wonAmountMinor: true, currency: true, closedAt: true, ownerUserId: true, createdAt: true } }) : [];
  const touches = dealIds.length ? await db.attributionTouch.findMany({ where: { workspaceId, opportunityId: { in: dealIds } }, orderBy: { position: 'asc' } }) : [];
  const companies = await db.company.findMany({ where: { workspaceId, id: { in: [...new Set(deals.map((d) => d.companyId))] } }, select: { id: true, industry: true } });
  const owners = await db.user.findMany({ where: { id: { in: [...new Set(deals.map((d) => d.ownerUserId).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const industryOf = new Map(companies.map((c) => [c.id, c.industry]));
  const ownerOf = new Map(owners.map((u) => [u.id, u.name]));
  const openIds = new Set(open.map((o) => o.id));
  const createdIds = new Set(created.map((o) => o.id));
  const wonIds = new Set(wonInPeriod.map((o) => o.id));

  const rows: Record<Dim, Map<string, AttributionRow>> = Object.fromEntries(DIMS.map((d) => [d, new Map()])) as Record<Dim, Map<string, AttributionRow>>;
  const bump = (dim: Dim, k: { key: string; label: string; href: string | null }, f: (r: AttributionRow) => void) => {
    const m = rows[dim];
    let r = m.get(k.key);
    if (!r) m.set(k.key, (r = { key: k.key, label: k.label, revenueMinor: 0, wonDeals: 0, opportunities: 0, pipelineMinor: 0, meetings: 0, href: k.href }));
    f(r);
  };

  let unattributed = 0;
  for (const d of deals) {
    const mine = touches.filter((t) => t.opportunityId === d.id);
    const amount = revenueByDeal.get(d.id) ?? 0;
    const isWon = wonIds.has(d.id);
    if (isWon && !mine.length) unattributed++;
    const meetings = mine.filter((t) => t.touchType === 'MEETING' && t.occurredAt >= s.from && t.occurredAt < s.to).length;
    const pipeline = openIds.has(d.id) ? (d.amountMinor ?? 0) : 0;
    // Touch dimensions: credit per the model, one row per (dimension, key) per deal.
    const credits = new Map<string, number>();
    const like: (TouchLike & { idx: number })[] = mine.map((t, idx) => ({ touchType: t.touchType as TouchTypeKey, sourceId: t.sourceId, label: t.label, occurredAt: t.occurredAt.toISOString(), idx }));
    for (const c of attributeDeal(like, amount, model)) {
      const t = mine[(c.touch as TouchLike & { idx: number }).idx]!;
      const dim = TOUCH_DIM[t.touchType as TouchTypeKey];
      if (!dim) continue;
      const k = dimKey(dim, { touchType: t.touchType, sourceId: t.sourceId, label: t.label, detail: t.detail as Record<string, unknown> });
      if (!k) continue;
      const id = `${dim}|${k.key}`;
      credits.set(id, model === 'FULL' ? amount : (credits.get(id) ?? 0) + c.creditMinor);
    }
    const seen = new Set<string>();
    for (const t of mine) {
      const dim = TOUCH_DIM[t.touchType as TouchTypeKey];
      if (!dim) continue;
      const k = dimKey(dim, { touchType: t.touchType, sourceId: t.sourceId, label: t.label, detail: t.detail as Record<string, unknown> })!;
      const id = `${dim}|${k.key}`;
      if (seen.has(id)) continue;
      seen.add(id);
      bump(dim, k, (r) => {
        r.revenueMinor += credits.get(id) ?? 0;
        if (isWon) r.wonDeals++;
        if (createdIds.has(d.id)) r.opportunities++;
        r.pipelineMinor += pipeline;
        r.meetings += meetings;
      });
    }
    // Deal attributes carry the whole deal (one industry, one persona, one owner per deal).
    const persona = (mine.find((t) => t.touchType === 'CAMPAIGN' || t.touchType === 'MESSAGE')?.detail as { persona?: string } | undefined)?.persona ?? personaOf(null);
    const industry = industryOf.get(d.companyId) ?? null;
    const attrs: [Dim, { key: string; label: string; href: string | null }][] = [
      ['industry', { key: industry ?? 'unknown', label: industry ?? 'Unknown industry', href: null }],
      ['persona', { key: persona, label: persona, href: null }],
      ['owner', d.ownerUserId ? { key: d.ownerUserId, label: ownerOf.get(d.ownerUserId) ?? 'Unknown member', href: null } : { key: 'none', label: 'No owner', href: null }],
    ];
    for (const [dim, k] of attrs)
      bump(dim, k, (r) => {
        r.revenueMinor += amount;
        if (isWon) r.wonDeals++;
        if (createdIds.has(d.id)) r.opportunities++;
        r.pipelineMinor += pipeline;
        r.meetings += meetings;
      });
  }
  const byDimension = Object.fromEntries(DIMS.map((d) => [d, [...rows[d].values()].sort((a, b) => b.revenueMinor - a.revenueMinor || b.pipelineMinor - a.pipelineMinor || b.wonDeals - a.wonDeals)])) as AttributionReport['byDimension'];
  const wonDeals = deals.filter((d) => wonIds.has(d.id) || (revenueByDeal.get(d.id) ?? 0) !== 0).sort((a, b) => (revenueByDeal.get(b.id) ?? 0) - (revenueByDeal.get(a.id) ?? 0)).slice(0, 50);
  return { model, period: s.period, totalRevenueMinor: [...revenueByDeal.values()].reduce((a, b) => a + b, 0), byDimension, deals: await lineages(db, workspaceId, wonDeals), unattributed };
}

// ───────────────────────────── drill ─────────────────────────────

const refOpp = (o: { id: string; name: string; amountMinor?: number | null; currency?: string }, detail?: string): RecordRef => ({ type: 'OPPORTUNITY', id: o.id, label: o.name, href: HREF.opportunity(o.id), detail });
async function companyRefs(db: PrismaClient, workspaceId: string, ids: string[], detail?: string): Promise<RecordRef[]> {
  if (!ids.length) return [];
  const rows = await db.company.findMany({ where: { workspaceId, id: { in: ids.slice(0, 200) } }, select: { id: true, displayName: true, city: true, industry: true } });
  return rows.map((c) => ({ type: 'COMPANY', id: c.id, label: c.displayName, href: HREF.company(c.id), detail: detail ?? ([c.industry, c.city].filter(Boolean).join(' · ') || undefined) }));
}

const money = (minor: number | null | undefined, currency: string) => (minor == null ? 'no value' : `${(minor / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })} ${currency}`);

/** The records behind a number (screen #10 §50 — no dead-end numbers). Max 200 records. */
export async function drill(db: PrismaClient, workspaceId: string, metric: string, filters: AnalyticsFilters, extra: { stage?: string } = {}, now = new Date()): Promise<DrillResult> {
  const s = await resolveScope(db, workspaceId, filters, now);
  const win = between(s.from, s.to);
  const result = (label: string, total: number, records: RecordRef[]) => ({ metric, label, period: s.period, total, records: records.slice(0, 200) });
  if (metric.startsWith('funnel.')) {
    const stage = metric.slice(7) as FunnelStageKey;
    if (!FUNNEL_STAGES.includes(stage)) return result('Unknown funnel stage', 0, []);
    const f = await funnelCohort(db, s, s.from, s.to);
    return result(FUNNEL_STAGE_LABEL[stage], f.counts[stage], await companyRefs(db, workspaceId, f.companies[stage]));
  }
  const label = (METRICS as Record<string, { label: string }>)[metric]?.label ?? metric;
  const opps = async (where: Parameters<typeof oppWhere>[1], detail: (o: { amountMinor: number | null; wonAmountMinor: number | null; currency: string; closedAt: Date | null; createdAt: Date }) => string) => {
    const w = oppWhere(s, where);
    const [total, rows] = await Promise.all([db.opportunity.count({ where: w }), db.opportunity.findMany({ where: w, orderBy: { updatedAt: 'desc' }, take: 200, select: { id: true, name: true, amountMinor: true, wonAmountMinor: true, currency: true, closedAt: true, createdAt: true } })]);
    return result(label, total, rows.map((o) => refOpp(o, detail(o))));
  };
  switch (metric) {
    case 'wonDeals':
    case 'salesCycleDays':
      return opps({ status: 'WON', closedAt: win }, (o) => `Won ${o.closedAt?.toISOString().slice(0, 10)} · ${money(o.wonAmountMinor ?? o.amountMinor, o.currency)}`);
    case 'winRate':
      return opps({ status: { in: ['WON', 'LOST'] }, closedAt: win }, (o) => `${o.wonAmountMinor != null ? 'Won' : 'Closed'} ${o.closedAt?.toISOString().slice(0, 10)}`);
    case 'opportunities':
      return opps({ createdAt: win }, (o) => `Created ${o.createdAt.toISOString().slice(0, 10)} · ${money(o.amountMinor, o.currency)}`);
    case 'qualifiedOpportunities':
      return opps({ createdAt: win, qualification: { status: 'QUALIFIED' } }, (o) => money(o.amountMinor, o.currency));
    case 'openPipeline':
      return opps({ status: 'OPEN', ...(extra.stage ? { stage: { semantic: extra.stage as StageSemantic } } : {}) }, (o) => money(o.amountMinor, o.currency));
    case 'wonRevenue': {
      const ev = await db.revenueEvent.findMany({ where: await revenueWhere(db, s, { occurredAt: win }), orderBy: { occurredAt: 'desc' }, take: 500 });
      const names = new Map((await db.opportunity.findMany({ where: { workspaceId, id: { in: [...new Set(ev.map((e) => e.opportunityId))] } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
      return result(label, ev.length, ev.map((e) => ({ type: 'OPPORTUNITY', id: e.opportunityId, label: names.get(e.opportunityId) ?? 'Deal', href: HREF.opportunity(e.opportunityId), detail: `${e.type} ${e.type === 'REFUND' ? '−' : ''}${money(e.amountMinor, e.currency)} · ${e.occurredAt.toISOString().slice(0, 10)}` })));
    }
    case 'meetingsBooked':
    case 'meetingsHeld': {
      const where = { workspaceId, ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}), ...(s.ownerId ? { ownerUserId: s.ownerId } : {}), ...(metric === 'meetingsBooked' ? { bookedAt: win } : { startAt: win, outcome: { outcome: { not: 'NO_SHOW' as const } } }) };
      const [total, rows] = await Promise.all([db.meeting.count({ where }), db.meeting.findMany({ where, orderBy: { bookedAt: 'desc' }, take: 200, select: { id: true, title: true, status: true, startAt: true } })]);
      return result(label, total, rows.map((m) => ({ type: 'MEETING', id: m.id, label: m.title, href: HREF.meeting(m.id), detail: `${m.status.toLowerCase()}${m.startAt ? ` · ${m.startAt.toISOString().slice(0, 16).replace('T', ' ')}` : ''}` })));
    }
    case 'replies':
    case 'positiveReplies':
    case 'replyRate': {
      const convs = await db.conversation.findMany({ where: { workspaceId, ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}), ...(s.campaignId ? { campaignId: s.campaignId } : {}), createdAt: win }, orderBy: { createdAt: 'desc' }, take: 1000, select: { id: true, subject: true, contactName: true, email: true, primaryIntent: true } });
      const intents = metric === 'positiveReplies' ? await firstIntents(db, workspaceId, convs.map((c) => c.id)) : null;
      const list = intents ? convs.filter((c) => isPositive(intents.get(c.id))) : convs;
      return result(label, list.length, list.map((c) => ({ type: 'CONVERSATION', id: c.id, label: c.contactName ?? c.email, href: HREF.conversation(c.id), detail: [c.subject, c.primaryIntent?.toLowerCase()].filter(Boolean).join(' · ') })));
    }
    case 'contacted':
    case 'messagesSent': {
      const rows = await db.campaignMessage.findMany({ where: { workspaceId, status: 'SENT', ...(metric === 'contacted' ? { position: 1 } : {}), sentAt: win, ...(s.campaignId ? { campaignId: s.campaignId } : {}), ...(s.companyIds ? { enrollment: { companyId: { in: s.companyIds } } } : {}) }, select: { enrollment: { select: { companyId: true } } }, take: 5000 });
      const ids = [...new Set(rows.map((r) => r.enrollment.companyId))];
      return result(label, rows.length, await companyRefs(db, workspaceId, ids));
    }
    case 'companiesDiscovered': {
      const companies = await db.company.findMany({ where: { workspaceId, createdAt: win, ...(s.companyIds ? { id: { in: s.companyIds } } : {}) }, select: { id: true }, take: 5000 });
      const found = new Set((await db.discoveryObservation.findMany({ where: { workspaceId, companyId: { in: companies.map((c) => c.id) } }, select: { companyId: true }, distinct: ['companyId'] })).map((o) => o.companyId!));
      const ids = companies.map((c) => c.id).filter((id) => found.has(id));
      return result(label, ids.length, await companyRefs(db, workspaceId, ids));
    }
    case 'verifiedContacts': {
      const f = await funnelCohort(db, s, s.from, s.to);
      return result(label, f.counts.contactable, await companyRefs(db, workspaceId, f.companies.contactable));
    }
    case 'bounces':
    case 'unsubscribes': {
      const rows = await db.mailboxMessage.findMany({ where: { workspaceId, kind: metric === 'bounces' ? 'BOUNCE' : 'UNSUBSCRIBE', occurredAt: win, ...(s.campaignId ? { campaignId: s.campaignId } : {}) }, select: { enrollmentId: true }, take: 2000 });
      const enr = await db.campaignEnrollment.findMany({ where: { workspaceId, id: { in: rows.map((r) => r.enrollmentId).filter((x): x is string => !!x) }, ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}) }, select: { companyId: true } });
      return result(label, rows.length, await companyRefs(db, workspaceId, [...new Set(enr.map((e) => e.companyId))]));
    }
    default:
      if (metric.startsWith('stage.')) return opps({ status: 'OPEN', stage: { semantic: metric.slice(6) as StageSemantic } }, (o) => money(o.amountMinor, o.currency));
      // Cost metrics have no record list: the cost tab breaks them down by provider and agent.
      return result(label, 0, []);
  }
}
