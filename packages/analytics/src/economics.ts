import { AGENTS } from '@revenue-os/ai';
import type { PrismaClient } from '@revenue-os/database';
import {
  INTENT_INFO,
  LOSS_REASON_INFO,
  OBJECTION_INFO,
  OPEN_PATH,
  STAGE_SEMANTIC_INFO,
  median,
  type AiContribution,
  type AnalyticsFilters,
  type CampaignAnalyticsRow,
  type ConversationAnalytics,
  type CostAnalytics,
  type DataQuality,
  type Intent,
  type LossReasonCode,
  type MarketEconomicsRow,
  type ObjectionType,
  type PipelineAnalytics,
  type SourceQualityRow,
  type StageSemantic,
} from '@revenue-os/shared';
import { DAY, dayKey } from './deps.js';
import { firstIntents, isPositive, pct, providerCallWhere, reachedStages, roundOrNull } from './metrics.js';
import { agingDeals } from './overview.js';
import { between, convWhere, oppWhere, resolveScope, type Scope } from './scope.js';

const agentLabel = (t: string) => (AGENTS as Record<string, { label: string } | undefined>)[t]?.label ?? t;
const signed = (e: { type: string; amountMinor: number }) => (e.type === 'REFUND' ? -e.amountMinor : e.amountMinor);

/** Per-company activity in the period, so market / source rows can be summed from one pass. */
async function companyActivity(db: PrismaClient, s: Scope, companyIds: string[]) {
  const win = between(s.from, s.to);
  const cIn = { companyId: { in: companyIds } };
  const ws = s.workspaceId;
  const [contacted, convs, meetings, opps, won, revenue] = await Promise.all([
    db.campaignMessage.findMany({ where: { workspaceId: ws, status: 'SENT', position: 1, sentAt: win, enrollment: cIn }, select: { enrollment: { select: { companyId: true } } } }),
    db.conversation.findMany({ where: { workspaceId: ws, createdAt: win, ...cIn }, select: { id: true, companyId: true } }),
    db.meeting.findMany({ where: { workspaceId: ws, bookedAt: win, ...cIn }, select: { companyId: true } }),
    db.opportunity.findMany({ where: { workspaceId: ws, createdAt: win, ...cIn }, select: { companyId: true } }),
    db.opportunity.findMany({ where: { workspaceId: ws, status: 'WON', closedAt: win, ...cIn }, select: { companyId: true } }),
    db.revenueEvent.findMany({ where: { workspaceId: ws, occurredAt: win, ...cIn }, select: { companyId: true, type: true, amountMinor: true } }),
  ]);
  const intents = await firstIntents(db, ws, convs.map((c) => c.id));
  const count = (rows: { companyId: string }[]) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.companyId, (m.get(r.companyId) ?? 0) + 1);
    return m;
  };
  const rev = new Map<string, number>();
  for (const r of revenue) rev.set(r.companyId, (rev.get(r.companyId) ?? 0) + signed(r));
  return {
    contacted: count(contacted.map((c) => ({ companyId: c.enrollment.companyId }))),
    replies: count(convs),
    positive: count(convs.filter((c) => isPositive(intents.get(c.id)))),
    meetings: count(meetings),
    opportunities: count(opps),
    won: count(won),
    revenue: rev,
  };
}

const sumOver = (ids: Iterable<string>, m: Map<string, number>) => {
  let n = 0;
  for (const id of ids) n += m.get(id) ?? 0;
  return n;
};

/** Cost per market: discovery-mission calls of the market + calls about companies first found in it. */
async function marketCosts(db: PrismaClient, s: Scope, firstMarketOf: Map<string, string>): Promise<Map<string, { known: number; knownCalls: number; unknown: number }>> {
  const where = await providerCallWhere(db, s, s.from, s.to);
  const calls = await db.providerCallRecord.findMany({ where: { ...where, entityType: { in: ['COMPANY', 'DISCOVERY_MISSION'] }, entityId: { not: null } }, select: { entityType: true, entityId: true, costMinor: true }, take: 100_000 });
  const missionIds = [...new Set(calls.filter((c) => c.entityType === 'DISCOVERY_MISSION').map((c) => c.entityId!))];
  const missions = missionIds.length ? await db.discoveryMission.findMany({ where: { workspaceId: s.workspaceId, id: { in: missionIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) } }, select: { id: true, marketId: true } }) : [];
  const missionMarket = new Map(missions.map((m) => [m.id, m.marketId]));
  const out = new Map<string, { known: number; knownCalls: number; unknown: number }>();
  for (const c of calls) {
    const market = c.entityType === 'DISCOVERY_MISSION' ? missionMarket.get(c.entityId!) : firstMarketOf.get(c.entityId!);
    if (!market) continue;
    const r = out.get(market) ?? { known: 0, knownCalls: 0, unknown: 0 };
    if (c.costMinor === null) r.unknown++;
    else {
      r.known += c.costMinor;
      r.knownCalls++;
    }
    out.set(market, r);
  }
  return out;
}

async function marketMembership(db: PrismaClient, workspaceId: string) {
  const obs = await db.discoveryObservation.findMany({ where: { workspaceId, companyId: { not: null } }, orderBy: { observedAt: 'asc' }, select: { companyId: true, provider: true, outcome: true, mission: { select: { marketId: true } } }, take: 200_000 });
  const byMarket = new Map<string, Set<string>>();
  const firstMarketOf = new Map<string, string>();
  for (const o of obs) {
    const set = byMarket.get(o.mission.marketId) ?? new Set<string>();
    set.add(o.companyId!);
    byMarket.set(o.mission.marketId, set);
    if (!firstMarketOf.has(o.companyId!)) firstMarketOf.set(o.companyId!, o.mission.marketId);
  }
  return { obs, byMarket, firstMarketOf };
}

/** Market economics (screen #10 §27-31): coverage → contactable → conversations → meetings → revenue, and cost. */
export async function markets(db: PrismaClient, workspaceId: string, filters: AnalyticsFilters, now = new Date()): Promise<MarketEconomicsRow[]> {
  const s = await resolveScope(db, workspaceId, filters, now);
  const list = await db.market.findMany({ where: { workspaceId, archivedAt: null, ...(filters.marketId ? { id: filters.marketId } : {}) }, select: { id: true, name: true } });
  if (!list.length) return [];
  const { byMarket, firstMarketOf } = await marketMembership(db, workspaceId);
  const scoped = (ids: Set<string> | undefined) => [...(ids ?? [])].filter((id) => !s.companyIds || s.companyIds.includes(id));
  const all = [...new Set(list.flatMap((m) => scoped(byMarket.get(m.id))))];
  const [act, contactable, costs] = await Promise.all([companyActivity(db, s, all), all.length ? reachedStages(db, workspaceId, all, null, now).then((r) => r.contactable) : Promise.resolve(new Set<string>()), marketCosts(db, s, firstMarketOf)]);
  return list
    .map((m) => {
      const ids = scoped(byMarket.get(m.id));
      const c = costs.get(m.id);
      const costMinor = c && c.knownCalls > 0 ? c.known : null;
      const meetings = sumOver(ids, act.meetings);
      const revenueMinor = sumOver(ids, act.revenue);
      return {
        marketId: m.id,
        name: m.name,
        companies: ids.length,
        contactable: ids.filter((id) => contactable.has(id)).length,
        contacted: sumOver(ids, act.contacted),
        replies: sumOver(ids, act.replies),
        positive: sumOver(ids, act.positive),
        meetings,
        opportunities: sumOver(ids, act.opportunities),
        won: sumOver(ids, act.won),
        revenueMinor,
        costMinor,
        costUnknownCalls: c?.unknown ?? 0,
        costPerMeetingMinor: costMinor !== null && !c!.unknown && meetings > 0 ? Math.round(costMinor / meetings) : null,
        revenuePerCostUnit: costMinor ? Math.round((revenueMinor / costMinor) * 100) / 100 : null,
      };
    })
    .sort((a, b) => b.revenueMinor - a.revenueMinor || b.meetings - a.meetings || b.companies - a.companies);
}

/** Campaign performance with per-step replies (screen #10 §21-22). Revenue / deals via the deals' campaign touches. */
export async function campaigns(db: PrismaClient, workspaceId: string, filters: AnalyticsFilters, now = new Date()): Promise<CampaignAnalyticsRow[]> {
  const s = await resolveScope(db, workspaceId, filters, now);
  const win = between(s.from, s.to);
  const list = await db.campaign.findMany({ where: { workspaceId, ...(s.campaignId ? { id: s.campaignId } : {}), status: { not: 'DRAFT' } }, select: { id: true, name: true, status: true }, orderBy: { createdAt: 'desc' } });
  if (!list.length) return [];
  const ids = list.map((c) => c.id);
  const enrollFilter = s.companyIds ? { companyId: { in: s.companyIds } } : {};
  const [enrolled, msgs, convs, mailbox, touches] = await Promise.all([
    db.campaignEnrollment.groupBy({ by: ['campaignId'], where: { workspaceId, campaignId: { in: ids }, ...enrollFilter }, _count: { _all: true } }),
    db.campaignMessage.findMany({ where: { workspaceId, campaignId: { in: ids }, status: 'SENT', sentAt: { lt: s.to }, ...(s.companyIds ? { enrollment: enrollFilter } : {}) }, select: { campaignId: true, enrollmentId: true, position: true, sentAt: true } }),
    db.conversation.findMany({ where: { workspaceId, campaignId: { in: ids }, createdAt: win, ...enrollFilter }, select: { id: true, campaignId: true, enrollmentId: true, createdAt: true } }),
    db.mailboxMessage.groupBy({ by: ['campaignId', 'kind'], where: { workspaceId, campaignId: { in: ids }, occurredAt: win, kind: { in: ['BOUNCE', 'UNSUBSCRIBE'] } }, _count: { _all: true } }),
    db.attributionTouch.findMany({ where: { workspaceId, touchType: 'CAMPAIGN', sourceId: { in: ids }, ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}) }, select: { sourceId: true, opportunityId: true } }),
  ]);
  const intents = await firstIntents(db, workspaceId, convs.map((c) => c.id));
  const dealIds = [...new Set(touches.map((t) => t.opportunityId))];
  const [deals, revenue, meetings] = await Promise.all([
    dealIds.length ? db.opportunity.findMany({ where: { workspaceId, id: { in: dealIds } }, select: { id: true, status: true, createdAt: true, closedAt: true } }) : Promise.resolve([]),
    dealIds.length ? db.revenueEvent.findMany({ where: { workspaceId, opportunityId: { in: dealIds }, occurredAt: win }, select: { opportunityId: true, type: true, amountMinor: true } }) : Promise.resolve([]),
    convs.length ? db.meeting.findMany({ where: { workspaceId, conversationId: { in: convs.map((c) => c.id) }, bookedAt: { not: null } }, select: { conversationId: true } }) : Promise.resolve([]),
  ]);
  const convCampaign = new Map(convs.map((c) => [c.id, c.campaignId]));
  return list.map((c) => {
    const mine = msgs.filter((m) => m.campaignId === c.id);
    const inWin = mine.filter((m) => m.sentAt! >= s.from);
    const cConvs = convs.filter((v) => v.campaignId === c.id);
    const contacted = inWin.filter((m) => m.position === 1).length;
    const replies = cConvs.length;
    // A reply belongs to the last step sent to that prospect before the reply arrived.
    const stepReplies = new Map<number, number>();
    for (const v of cConvs) {
      const before = mine.filter((m) => m.enrollmentId === v.enrollmentId && m.sentAt! <= v.createdAt).sort((a, b) => b.position - a.position)[0];
      if (before) stepReplies.set(before.position, (stepReplies.get(before.position) ?? 0) + 1);
    }
    const positions = [...new Set([...inWin.map((m) => m.position), ...stepReplies.keys()])].sort((a, b) => a - b);
    const cDeals = new Set(touches.filter((t) => t.sourceId === c.id).map((t) => t.opportunityId));
    const dealRows = deals.filter((d) => cDeals.has(d.id));
    const mb = (kind: string) => mailbox.find((x) => x.campaignId === c.id && x.kind === kind)?._count._all ?? 0;
    return {
      campaignId: c.id,
      name: c.name,
      status: c.status,
      enrolled: enrolled.find((e) => e.campaignId === c.id)?._count._all ?? 0,
      contacted,
      sent: inWin.length,
      replies,
      positive: cConvs.filter((v) => isPositive(intents.get(v.id))).length,
      unsubscribes: mb('UNSUBSCRIBE'),
      bounces: mb('BOUNCE'),
      meetings: meetings.filter((m) => m.conversationId && convCampaign.get(m.conversationId) === c.id).length,
      opportunities: dealRows.filter((d) => d.createdAt >= s.from && d.createdAt < s.to).length,
      won: dealRows.filter((d) => d.status === 'WON' && d.closedAt && d.closedAt >= s.from && d.closedAt < s.to).length,
      revenueMinor: revenue.filter((r) => cDeals.has(r.opportunityId)).reduce((a, r) => a + signed(r), 0),
      replyRate: pct(replies, contacted),
      steps: positions.map((p) => ({ position: p, sent: inWin.filter((m) => m.position === p).length, replies: stepReplies.get(p) ?? 0 })),
    };
  });
}

/** Pipeline health (screen #10 §23-26): stage load and age vs history, cycle, win rate, why deals are lost, objections. */
export async function pipeline(db: PrismaClient, workspaceId: string, filters: AnalyticsFilters, now = new Date()): Promise<PipelineAnalytics> {
  const s = await resolveScope(db, workspaceId, filters, now);
  const win = between(s.from, s.to);
  const [open, aging, won, lost, losses, classifications] = await Promise.all([
    db.opportunity.findMany({ where: oppWhere(s, { status: 'OPEN' }), select: { amountMinor: true, stageEnteredAt: true, stage: { select: { semantic: true, name: true } } } }),
    agingDeals(db, s),
    db.opportunity.findMany({ where: oppWhere(s, { status: 'WON', closedAt: win }), select: { createdAt: true, closedAt: true } }),
    db.opportunity.count({ where: oppWhere(s, { status: 'LOST', closedAt: win }) }),
    db.opportunityLoss.findMany({ where: { workspaceId, lostAt: win, reopenedAt: null, opportunity: oppWhere(s) }, select: { reasonCode: true, opportunity: { select: { amountMinor: true } } } }),
    db.messageClassification.findMany({ where: { workspaceId, createdAt: win, conversation: convWhere(s) }, select: { objections: true } }),
  ]);
  const semantics: StageSemantic[] = [...OPEN_PATH, 'NURTURE'];
  const stages = semantics.map((sem) => {
    const inStage = open.filter((o) => o.stage.semantic === sem);
    const base = aging.baselines.get(sem)?.days ?? null;
    return {
      semantic: sem,
      label: inStage[0]?.stage.name ?? STAGE_SEMANTIC_INFO[sem].label,
      open: inStage.length,
      valueMinor: inStage.reduce((a, o) => a + (o.amountMinor ?? 0), 0),
      medianAgeDays: roundOrNull(median(inStage.map((o) => (now.getTime() - o.stageEnteredAt.getTime()) / DAY)), 1),
      baselineDays: base,
      aging: aging.bySemantic.get(sem) ?? 0,
    };
  });
  const lostMap = new Map<string, { count: number; valueMinor: number }>();
  for (const l of losses) {
    const r = lostMap.get(l.reasonCode) ?? { count: 0, valueMinor: 0 };
    r.count++;
    r.valueMinor += l.opportunity.amountMinor ?? 0;
    lostMap.set(l.reasonCode, r);
  }
  const objMap = new Map<string, number>();
  for (const c of classifications) for (const o of (Array.isArray(c.objections) ? c.objections : []) as { type?: string }[]) if (o?.type) objMap.set(o.type, (objMap.get(o.type) ?? 0) + 1);
  return {
    stages,
    salesCycleDays: roundOrNull(median(won.map((o) => ((o.closedAt ?? o.createdAt).getTime() - o.createdAt.getTime()) / DAY)), 1),
    winRate: pct(won.length, won.length + lost),
    lostReasons: [...lostMap].map(([reason, r]) => ({ reason, label: LOSS_REASON_INFO[reason as LossReasonCode] ?? reason, ...r })).sort((a, b) => b.count - a.count),
    objections: [...objMap].map(([type, count]) => ({ type, label: OBJECTION_INFO[type as ObjectionType] ?? type, count })).sort((a, b) => b.count - a.count),
    aging: aging.refs,
  };
}

/** Conversation intelligence (screen #10 §32-35): intents, response speed, questions, knowledge gaps, AI vs human replies. */
export async function conversations(db: PrismaClient, workspaceId: string, filters: AnalyticsFilters, now = new Date()): Promise<ConversationAnalytics> {
  const s = await resolveScope(db, workspaceId, filters, now);
  const win = between(s.from, s.to);
  const convs = await db.conversation.findMany({ where: convWhere(s, { createdAt: win }), select: { id: true, needsHuman: true } });
  const ids = convs.map((c) => c.id);
  const [intents, messages, classes, gaps, replies] = await Promise.all([
    firstIntents(db, workspaceId, ids),
    ids.length ? db.conversationMessage.findMany({ where: { workspaceId, conversationId: { in: ids }, direction: { in: ['INBOUND', 'OUTBOUND'] } }, orderBy: { occurredAt: 'asc' }, select: { conversationId: true, direction: true, occurredAt: true } }) : Promise.resolve([]),
    ids.length ? db.messageClassification.findMany({ where: { workspaceId, conversationId: { in: ids } }, select: { questions: true } }) : Promise.resolve([]),
    db.knowledgeGap.findMany({ where: { workspaceId, status: { not: 'DISMISSED' } }, orderBy: [{ occurrences: 'desc' }, { lastSeenAt: 'desc' }], take: 10, select: { question: true, occurrences: true, status: true } }),
    db.conversationReply.groupBy({ by: ['author', 'status'], where: { workspaceId, createdAt: win, author: { in: ['AI', 'HUMAN'] }, ...(s.companyIds || s.campaignId ? { conversation: convWhere(s) } : {}) }, _count: { _all: true } }),
  ]);
  const byIntent = new Map<string, number>();
  for (const id of ids) {
    const i = intents.get(id) ?? 'UNKNOWN';
    byIntent.set(i, (byIntent.get(i) ?? 0) + 1);
  }
  // First response = first outbound message after the first inbound one.
  const firstIn = new Map<string, Date>();
  const response: number[] = [];
  const answered = new Set<string>();
  for (const m of messages) {
    if (m.direction === 'INBOUND' && !firstIn.has(m.conversationId)) firstIn.set(m.conversationId, m.occurredAt);
    else if (m.direction === 'OUTBOUND' && firstIn.has(m.conversationId) && !answered.has(m.conversationId)) {
      answered.add(m.conversationId);
      response.push((m.occurredAt.getTime() - firstIn.get(m.conversationId)!.getTime()) / 3_600_000);
    }
  }
  const questions = new Map<string, number>();
  for (const c of classes) for (const q of c.questions) {
    const k = q.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[?.!]+$/, '').slice(0, 120);
    if (k) questions.set(k, (questions.get(k) ?? 0) + 1);
  }
  const author = (a: 'AI' | 'HUMAN') => {
    const rows = replies.filter((r) => r.author === a);
    const n = (st: string[]) => rows.filter((r) => st.includes(r.status)).reduce((x, r) => x + r._count._all, 0);
    return { author: a, drafted: rows.reduce((x, r) => x + r._count._all, 0), sent: n(['SENT']), rejected: n(['REJECTED', 'DISCARDED']) };
  };
  return {
    total: convs.length,
    byIntent: [...byIntent].map(([intent, count]) => ({ intent, label: INTENT_INFO[intent as Intent]?.label ?? intent, count })).sort((a, b) => b.count - a.count),
    medianFirstResponseHours: roundOrNull(median(response), 1),
    needsHumanShare: pct(convs.filter((c) => c.needsHuman).length, convs.length),
    questions: [...questions].map(([topic, count]) => ({ topic, count })).sort((a, b) => b.count - a.count).slice(0, 10),
    knowledgeGaps: gaps,
    repliesByAuthor: [author('AI'), author('HUMAN')],
  };
}

/** Source quality (screen #10 §36-38) and the data quality behind every number. */
export async function sources(db: PrismaClient, workspaceId: string, filters: AnalyticsFilters, now = new Date()): Promise<{ providers: SourceQualityRow[]; quality: DataQuality }> {
  const s = await resolveScope(db, workspaceId, filters, now);
  const win = between(s.from, s.to);
  const obs = await db.discoveryObservation.findMany({ where: { workspaceId, observedAt: win, ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}) }, select: { provider: true, companyId: true, outcome: true } });
  const providers = [...new Set(obs.map((o) => o.provider))];
  const allIds = [...new Set(obs.map((o) => o.companyId).filter((x): x is string => !!x))];
  const companyScope = s.companyIds ? { id: { in: s.companyIds } } : {};
  const [withSite, ever, costs, qCompanies, researched, dupes, invalid] = await Promise.all([
    allIds.length ? db.company.findMany({ where: { workspaceId, id: { in: allIds }, websiteDomain: { not: null } }, select: { id: true } }) : Promise.resolve([]),
    allIds.length ? reachedStages(db, workspaceId, allIds, null, now) : Promise.resolve(null),
    db.providerCallRecord.groupBy({ by: ['provider'], where: { workspaceId, startedAt: win, provider: { in: providers.length ? providers : ['-'] }, costMinor: { not: null } }, _sum: { costMinor: true } }),
    db.company.findMany({ where: { workspaceId, mergedIntoId: null, archivedAt: null, ...companyScope }, select: { id: true, websiteDomain: true } }),
    db.researchRun.findMany({ where: { workspaceId, status: { in: ['COMPLETED', 'PARTIAL'] }, ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}) }, select: { companyId: true, completedAt: true }, orderBy: { completedAt: 'desc' } }),
    db.entityMatchCandidate.count({ where: { workspaceId, entityType: 'COMPANY', status: { in: ['PENDING', 'NEEDS_REVIEW'] } } }),
    db.contactPoint.count({ where: { workspaceId, type: 'EMAIL', status: 'INVALID' } }),
  ]);
  const site = new Set(withSite.map((c) => c.id));
  const rows: SourceQualityRow[] = providers.map((p) => {
    const mine = obs.filter((o) => o.provider === p);
    const ids = new Set(mine.map((o) => o.companyId).filter((x): x is string => !!x));
    const has = (set: Set<string> | undefined) => [...ids].filter((id) => set?.has(id)).length;
    const cost = costs.find((c) => c.provider === p)?._sum.costMinor;
    return {
      provider: p,
      label: p.replace(/_/g, ' '),
      observations: mine.length,
      companies: ids.size,
      duplicatesMatched: mine.filter((o) => o.outcome === 'MATCHED_EXISTING' || o.outcome === 'DUPLICATE_LISTING').length,
      withWebsite: has(site),
      verifiedEmails: has(ever?.contactable),
      contacted: has(ever?.contacted),
      meetings: has(ever?.meeting),
      won: has(ever?.won),
      costMinor: cost ?? null,
    };
  });
  const latestRun = new Map<string, Date | null>();
  for (const r of researched) if (!latestRun.has(r.companyId)) latestRun.set(r.companyId, r.completedAt);
  const qIds = qCompanies.map((c) => c.id);
  const qSet = new Set(qIds);
  const contactableAll = qIds.length ? (await reachedStages(db, workspaceId, qIds, null, now)).contactable : new Set<string>();
  const staleBefore = now.getTime() - 90 * DAY;
  return {
    providers: rows.sort((a, b) => b.won - a.won || b.meetings - a.meetings || b.companies - a.companies),
    quality: {
      companies: qIds.length,
      withWebsite: qCompanies.filter((c) => c.websiteDomain).length,
      researched: [...latestRun.keys()].filter((id) => qSet.has(id)).length,
      withVerifiedContact: contactableAll.size,
      staleResearch: [...latestRun].filter(([id, at]) => qSet.has(id) && at && at.getTime() < staleBefore).length,
      openDuplicates: dupes,
      invalidEmails: invalid,
    },
  };
}

/** Provider and AI cost (screen #10 §39-41) — owner/admin only at the API. Unknown cost is counted, never zero. */
export async function costs(db: PrismaClient, workspaceId: string, filters: AnalyticsFilters, now = new Date()): Promise<CostAnalytics> {
  const s = await resolveScope(db, workspaceId, filters, now);
  const win = between(s.from, s.to);
  const pcWhere = await providerCallWhere(db, s, s.from, s.to);
  const aiWhere = { workspaceId, startedAt: win, ...(s.companyIds ? { task: { entityType: 'COMPANY' as const, entityId: { in: s.companyIds } } } : {}) };
  const [calls, runs, meetings, wonDeals, membership] = await Promise.all([
    db.providerCallRecord.findMany({ where: pcWhere, select: { provider: true, capability: true, costMinor: true, costIsEstimate: true, startedAt: true }, take: 200_000 }),
    db.aiRun.findMany({ where: aiWhere, select: { agentType: true, costMinor: true, costIsEstimate: true, status: true, startedAt: true }, take: 200_000 }),
    db.meeting.count({ where: { workspaceId, bookedAt: win, ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}) } }),
    db.opportunity.count({ where: oppWhere(s, { status: 'WON', closedAt: win }) }),
    marketMembership(db, workspaceId),
  ]);
  const byProvider = new Map<string, CostAnalytics['byProvider'][number]>();
  for (const c of calls) {
    const k = `${c.provider}|${c.capability}`;
    const r = byProvider.get(k) ?? { provider: c.provider, capability: c.capability, calls: 0, costMinor: 0, unknown: 0 };
    r.calls++;
    if (c.costMinor === null) r.unknown++;
    else r.costMinor += c.costMinor;
    byProvider.set(k, r);
  }
  const byAgent = new Map<string, CostAnalytics['byAgent'][number]>();
  for (const r of runs) {
    const a = byAgent.get(r.agentType) ?? { agent: agentLabel(r.agentType), runs: 0, costMinor: 0, unknown: 0, failed: 0 };
    a.runs++;
    if (r.costMinor === null) a.unknown++;
    else a.costMinor += r.costMinor;
    if (r.status !== 'SUCCEEDED') a.failed++;
    byAgent.set(r.agentType, a);
  }
  const known = [...calls, ...runs].filter((x) => x.costMinor !== null);
  const providerMinor = calls.reduce((a, c) => a + (c.costMinor ?? 0), 0);
  const aiMinor = runs.reduce((a, r) => a + (r.costMinor ?? 0), 0);
  const unknownCostCalls = calls.filter((c) => c.costMinor === null).length + runs.filter((r) => r.costMinor === null).length;
  const totalMinor = calls.length + runs.length === 0 ? 0 : known.length === 0 ? null : providerMinor + aiMinor;
  const estimated = known.filter((x) => x.costIsEstimate).reduce((a, x) => a + (x.costMinor ?? 0), 0);
  const mCosts = await marketCosts(db, s, membership.firstMarketOf);
  const marketNames = new Map((await db.market.findMany({ where: { workspaceId, id: { in: [...mCosts.keys()] } }, select: { id: true, name: true } })).map((m) => [m.id, m.name]));
  const daily = new Map<string, { day: string; providerMinor: number; aiMinor: number }>();
  for (let t = s.from.getTime(); t < s.to.getTime(); t += DAY) daily.set(dayKey(new Date(t)), { day: dayKey(new Date(t)), providerMinor: 0, aiMinor: 0 });
  for (const c of calls) if (c.costMinor !== null) daily.get(dayKey(c.startedAt))!.providerMinor += c.costMinor;
  for (const r of runs) if (r.costMinor !== null) daily.get(dayKey(r.startedAt))!.aiMinor += r.costMinor;
  const complete = totalMinor !== null && unknownCostCalls === 0;
  return {
    totalMinor,
    providerMinor,
    aiMinor,
    unknownCostCalls,
    estimatedShare: totalMinor ? pct(estimated, totalMinor) : null,
    byProvider: [...byProvider.values()].sort((a, b) => b.costMinor - a.costMinor || b.calls - a.calls),
    byAgent: [...byAgent.values()].sort((a, b) => b.costMinor - a.costMinor || b.runs - a.runs),
    byMarket: [...mCosts].filter(([, c]) => c.knownCalls > 0).map(([marketId, c]) => ({ marketId, name: marketNames.get(marketId) ?? 'Market', costMinor: c.known })).sort((a, b) => b.costMinor - a.costMinor),
    perMeetingMinor: complete && meetings > 0 ? Math.round(totalMinor! / meetings) : null,
    perWonDealMinor: complete && wonDeals > 0 ? Math.round(totalMinor! / wonDeals) : null,
    daily: [...daily.values()],
  };
}

/** AI vs human contribution (screen #10 §42-44): what the AI did, what people changed, what the guards stopped. */
export async function aiContribution(db: PrismaClient, workspaceId: string, filters: AnalyticsFilters, now = new Date()): Promise<AiContribution> {
  const s = await resolveScope(db, workspaceId, filters, now);
  const win = between(s.from, s.to);
  const cScope = s.companyIds || s.campaignId ? { conversation: convWhere(s) } : {};
  const [sentAi, sentHuman, edited, rejected, takeovers, escalations, replyValidations, decisionValidations, tasks, decisions, meetings] = await Promise.all([
    db.conversationReply.count({ where: { workspaceId, author: 'AI', status: 'SENT', sentAt: win, ...cScope } }),
    db.conversationReply.count({ where: { workspaceId, author: 'HUMAN', status: 'SENT', sentAt: win, ...cScope } }),
    db.conversationReply.count({ where: { workspaceId, author: 'AI', status: 'SUPERSEDED', statusReason: { contains: 'after editing' }, updatedAt: win, ...cScope } }),
    db.conversationReply.count({ where: { workspaceId, author: 'AI', status: { in: ['REJECTED', 'DISCARDED'] }, updatedAt: win, ...cScope } }),
    db.conversation.count({ where: convWhere(s, { takenOverAt: win }) }),
    db.conversation.count({ where: convWhere(s, { escalationReason: { not: null }, updatedAt: win }) }),
    db.conversationReply.findMany({ where: { workspaceId, author: 'AI', createdAt: win, ...cScope }, select: { validation: true } }),
    db.aiDecision.findMany({ where: { workspaceId, createdAt: win, decision: 'BLOCK' }, select: { validation: true } }),
    db.agentTask.groupBy({ by: ['agentType', 'status'], where: { workspaceId, createdAt: win }, _count: { _all: true } }),
    db.aiDecision.groupBy({ by: ['confidence'], where: { workspaceId, createdAt: win }, _count: { _all: true } }),
    db.meeting.findMany({ where: { workspaceId, bookedAt: win, conversationId: { not: null }, ...(s.companyIds ? { companyId: { in: s.companyIds } } : {}) }, select: { conversationId: true, bookedAt: true } }),
  ]);
  const blocks = new Map<string, number>();
  for (const r of [...replyValidations, ...decisionValidations])
    for (const v of (Array.isArray(r.validation) ? r.validation : []) as { validator?: string; ok?: boolean; blocking?: boolean }[]) if (v && v.ok === false && v.blocking !== false && v.validator) blocks.set(v.validator, (blocks.get(v.validator) ?? 0) + 1);
  const convIds = [...new Set(meetings.map((m) => m.conversationId!))];
  const aiReplies = convIds.length ? await db.conversationReply.findMany({ where: { workspaceId, conversationId: { in: convIds }, author: 'AI', status: 'SENT' }, select: { conversationId: true, sentAt: true } }) : [];
  const meetingsBookedAfterAiReply = meetings.filter((m) => aiReplies.some((r) => r.conversationId === m.conversationId && r.sentAt && r.sentAt <= m.bookedAt!)).length;
  const agents = new Map<string, AiContribution['agentRuns'][number]>();
  for (const t of tasks) {
    const a = agents.get(t.agentType) ?? { agent: t.agentType, label: agentLabel(t.agentType), runs: 0, succeeded: 0, failed: 0, blocked: 0 };
    a.runs += t._count._all;
    if (t.status === 'COMPLETED' || t.status === 'PARTIAL') a.succeeded += t._count._all;
    if (t.status === 'FAILED') a.failed += t._count._all;
    if (t.status === 'BLOCKED') a.blocked += t._count._all;
    agents.set(t.agentType, a);
  }
  return {
    repliesSentByAi: sentAi,
    repliesSentByHuman: sentHuman,
    draftsEditedByHuman: edited,
    draftsRejected: rejected,
    takeovers,
    escalations,
    meetingsBookedAfterAiReply,
    validatorBlocks: [...blocks].map(([validator, count]) => ({ validator, count })).sort((a, b) => b.count - a.count),
    agentRuns: [...agents.values()].sort((a, b) => b.runs - a.runs),
    // Whether a decision was later confirmed is not recorded per decision — shown as unknown, never estimated.
    calibration: decisions.map((d) => ({ confidence: d.confidence ?? 'UNSET', decisions: d._count._all, laterConfirmed: null })).sort((a, b) => ['HIGH', 'MEDIUM', 'LOW', 'UNSET'].indexOf(a.confidence) - ['HIGH', 'MEDIUM', 'LOW', 'UNSET'].indexOf(b.confidence)),
  };
}

