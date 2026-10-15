import type { Prisma, PrismaClient, Signal } from '@revenue-os/database';
import {
  NotFoundError,
  OPEN_SIGNAL_STATUSES,
  describeRule,
  parseRuleConditions,
  SIGNAL_FEEDBACK,
  SIGNAL_FEEDBACK_LABEL,
  SIGNAL_TYPE_KEYS,
  SIGNAL_TYPES,
  WATCHLIST_CADENCE_DAYS,
  type CompanySignals,
  type Level,
  type MarketMonitorRow,
  type RecommendedAction,
  type Relationship,
  type RuleAction,
  type SignalAnalytics,
  type SignalCategory,
  type SignalDetail,
  type SignalFunnel,
  type SignalListQuery,
  type SignalOverview,
  type SignalRow,
  type SignalRuleRow,
  type SignalSearchResult,
  type SignalSourceStatus,
  type SignalStatusKey,
  type SignalStrengthKey,
  type SourceKind,
  type WatchlistDetail,
  type WatchlistKind,
  type WatchlistRow,
} from '@revenue-os/shared';
import { trustOf } from './context.js';
import { typeLabel } from './detect-rules.js';
import { DAY } from './deps.js';
import type { StoredRelevance } from './engine.js';
import { parseSignalSearch } from './search.js';

type CompanyLite = { id: string; displayName: string; industry: string | null; city: string | null };
type Priority = 'HIGH' | 'NORMAL' | 'LOW';
const STRENGTH_RANK: Record<string, number> = { STRONG: 2, MEDIUM: 1, WEAK: 0 };
const FIRST_PARTY = ['RELATIONSHIP', 'CONVERSATION'];
const NEED_HUMAN: string[] = ['NOTIFY_OWNER', 'ATTACH_TO_DEAL', 'RE_ENGAGE'];
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export function toSignalRow(s: Signal, c: CompanyLite | undefined, now = new Date()): SignalRow {
  const rel = s.relevance as unknown as StoredRelevance;
  return {
    id: s.id,
    companyId: s.companyId,
    company: c?.displayName ?? 'Unknown company',
    industry: c?.industry ?? null,
    city: c?.city ?? null,
    type: s.type,
    typeLabel: typeLabel(s.type),
    category: s.category as SignalCategory,
    title: s.title,
    fact: s.fact,
    status: s.status as SignalStatusKey,
    strength: s.strength as SignalStrengthKey,
    relevance: { freshness: rel.freshness, sourceReliability: rel.sourceReliability, icpRelevance: rel.icpRelevance, commercialRelevance: rel.commercialRelevance, relationshipContext: rel.relationshipContext, score: rel.score, strength: rel.strength, reasons: rel.reasons ?? [], matchedServices: rel.matchedServices ?? [] },
    confidence: s.confidence as Level,
    sourceKind: s.sourceKind as SourceKind,
    relationship: s.relationship as Relationship,
    interpretation: s.interpretation,
    interpretationSource: s.interpretationSource,
    whyNow: s.whyNow,
    recommendedAction: s.recommendedAction as RecommendedAction,
    autoActions: s.autoActions,
    campaignCandidate: s.campaignCandidate,
    priority: s.priority,
    evidenceCount: s.evidenceCount,
    sourceCount: s.sourceCount,
    icp: rel.icp ?? null,
    detectedAt: s.detectedAt.toISOString(),
    effectiveAt: s.effectiveAt.toISOString(),
    lastSeenAt: s.lastSeenAt.toISOString(),
    expiresAt: s.expiresAt.toISOString(),
    windowEndsAt: iso(s.windowEndsAt),
    windowState: s.windowEndsAt ? (s.windowEndsAt < now ? 'PASSED' : 'ACTIVE') : null,
    opportunityId: s.opportunityId,
    conversationId: s.conversationId,
    hypothesisId: s.hypothesisId,
    marketId: s.marketId,
    actedAction: s.actedAction,
    actedAt: iso(s.actedAt),
    feedback: s.feedback,
  };
}

/** Queue order (screen #9 §19): priority, then first-party / relationship, then strength, then freshness. */
export function queueOrder(a: Pick<Signal, 'priority' | 'category' | 'relationship' | 'strength' | 'detectedAt'>, b: typeof a): number {
  const fp = (s: typeof a) => (FIRST_PARTY.includes(s.category) ? 2 : s.relationship !== 'COLD' ? 1 : 0);
  return Number(b.priority) - Number(a.priority) || fp(b) - fp(a) || STRENGTH_RANK[b.strength]! - STRENGTH_RANK[a.strength]! || b.detectedAt.getTime() - a.detectedAt.getTime();
}

async function rows(db: PrismaClient, workspaceId: string, signals: Signal[], now = new Date()): Promise<SignalRow[]> {
  const ids = [...new Set(signals.map((s) => s.companyId))];
  const companies = ids.length ? await db.company.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, displayName: true, industry: true, city: true } }) : [];
  const byId = new Map(companies.map((c) => [c.id, c]));
  return signals.map((s) => toSignalRow(s, byId.get(s.companyId), now));
}

async function funnelOf(db: PrismaClient, workspaceId: string, since: Date): Promise<SignalFunnel> {
  const [observations, meaningful, signals, relevant, highPriority, needHuman] = await Promise.all([
    db.signalObservation.count({ where: { workspaceId, observedAt: { gte: since } } }),
    db.signalObservation.count({ where: { workspaceId, observedAt: { gte: since }, changeLevel: { in: ['MEDIUM', 'HIGH'] } } }),
    db.signal.count({ where: { workspaceId, detectedAt: { gte: since } } }),
    db.signal.count({ where: { workspaceId, detectedAt: { gte: since }, status: { in: ['ACTIONABLE', 'VALIDATED'] } } }),
    db.signal.count({ where: { workspaceId, status: { in: OPEN_SIGNAL_STATUSES }, strength: 'STRONG' } }),
    db.signal.count({ where: { workspaceId, status: { in: OPEN_SIGNAL_STATUSES }, strength: 'STRONG', recommendedAction: { in: NEED_HUMAN } } }),
  ]);
  return { observations, meaningful, signals, relevant, highPriority, needHuman };
}

const activeIntegration = (workspaceId: string, extra: Prisma.IntegrationWhereInput): Prisma.IntegrationWhereInput => ({ workspaceId, status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] }, ...extra });

/** Signal Center (screen #9): today, the priority queue, the funnel, counts, types, sources, watching, markets. */
export async function signalOverview(db: PrismaClient, workspaceId: string, now = new Date()): Promise<SignalOverview> {
  const d30 = new Date(now.getTime() - 30 * DAY);
  const open = await db.signal.findMany({ where: { workspaceId, status: { in: OPEN_SIGNAL_STATUSES } }, orderBy: { detectedAt: 'desc' }, take: 500 });
  const sorted = [...open].sort(queueOrder);
  const today = open.filter((s) => s.detectedAt.getTime() >= now.getTime() - DAY).sort(queueOrder).slice(0, 25);
  const top = sorted.slice(0, 25);
  const rowsAll = await rows(db, workspaceId, [...new Map([...today, ...top].map((s) => [s.id, s])).values()], now);
  const rowOf = new Map(rowsAll.map((r) => [r.id, r]));

  const [funnel, recent, expired30d, dismissed30d, website, mailbox, leadSource, lists, members] = await Promise.all([
    funnelOf(db, workspaceId, d30),
    db.signal.findMany({ where: { workspaceId, detectedAt: { gte: d30 } }, select: { type: true, sourceKind: true, marketId: true, status: true, strength: true } }),
    db.signal.count({ where: { workspaceId, status: 'EXPIRED', updatedAt: { gte: d30 } } }),
    db.signal.count({ where: { workspaceId, status: 'DISMISSED', updatedAt: { gte: d30 } } }),
    db.integration.count({ where: activeIntegration(workspaceId, { capabilities: { has: 'WEBSITE_FETCH' } }) }),
    db.integration.count({ where: activeIntegration(workspaceId, { capabilities: { has: 'EMAIL_READ' } }) }),
    db.integration.count({ where: activeIntegration(workspaceId, { capabilities: { has: 'COMPANY_SEARCH' } }) }),
    db.signalWatchlist.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, kind: true, marketId: true, lastSweepAt: true } }),
    db.signalWatchlistMember.findMany({ where: { workspaceId, watchlist: { archivedAt: null } }, select: { companyId: true, nextCheckAt: true } }),
  ]);

  const counts = {
    open: open.length,
    actionable: open.filter((s) => s.status === 'ACTIONABLE').length,
    monitor: open.filter((s) => s.status === 'MONITOR').length,
    needsVerification: open.filter((s) => s.status === 'DETECTED').length,
    windowsActive: open.filter((s) => s.windowEndsAt && s.windowEndsAt >= now).length,
    windowsMissed: open.filter((s) => s.windowEndsAt && s.windowEndsAt < now).length,
    expired30d,
    dismissed30d,
  };
  const byType = SIGNAL_TYPE_KEYS.map((type) => ({ type, label: SIGNAL_TYPES[type].label, category: SIGNAL_TYPES[type].category as SignalCategory, open: open.filter((s) => s.type === type).length, total30d: recent.filter((s) => s.type === type).length }));
  const n30 = (kind: string) => recent.filter((s) => s.sourceKind === kind).length;
  const sources: SignalSourceStatus[] = [
    { kind: 'WEBSITE', label: 'Website changes', connected: website > 0, detail: website ? 'Watched websites are re-read and compared with the previous check' : 'No website reader connected — connect one in Integrations', signals30d: n30('WEBSITE') },
    { kind: 'CONVERSATION', label: 'Conversations', connected: mailbox > 0, detail: mailbox ? 'Pricing, meeting, timeline and provider statements from replies' : 'No mailbox connected', signals30d: n30('CONVERSATION') },
    { kind: 'COMMITMENT', label: 'Follow-up dates', connected: true, detail: '"Contact me later" dates from memory and promises', signals30d: n30('COMMITMENT') },
    { kind: 'PIPELINE', label: 'Pipeline', connected: true, detail: 'Lost deals reaching their revisit date', signals30d: n30('PIPELINE') },
    { kind: 'CRM', label: 'People changes', connected: true, detail: 'Decision makers added or leaving (from research and CRM edits)', signals30d: n30('CRM') },
    { kind: 'DISCOVERY', label: 'Market rescans', connected: leadSource > 0, detail: leadSource ? 'Businesses new to our dataset in saved-market rescans' : 'No lead source connected', signals30d: n30('DISCOVERY') },
    { kind: 'HIRING', label: 'Hiring', connected: false, detail: 'No hiring source connected yet', signals30d: 0 },
  ];
  const watchedCompanies = new Set(members.map((m) => m.companyId));
  const lastSweep = lists.reduce<Date | null>((acc, l) => (l.lastSweepAt && (!acc || l.lastSweepAt > acc) ? l.lastSweepAt : acc), null);
  const markets = await marketRows(db, workspaceId, recent, open, lists, now);
  return {
    today: today.map((s) => rowOf.get(s.id)!),
    priority: top.map((s) => rowOf.get(s.id)!),
    funnel,
    counts,
    byType,
    sources,
    watched: { companies: watchedCompanies.size, watchlists: lists.length, dueForCheck: new Set(members.filter((m) => !m.nextCheckAt || m.nextCheckAt <= now).map((m) => m.companyId)).size, lastSweepAt: iso(lastSweep) },
    markets,
  };
}

async function marketRows(db: PrismaClient, workspaceId: string, recent: { type: string; marketId: string | null }[], open: Signal[], lists: { id: string; kind: string; marketId: string | null }[], now: Date): Promise<MarketMonitorRow[]> {
  void now;
  const markets = await db.market.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, name: true }, orderBy: { createdAt: 'desc' }, take: 50 });
  const out: MarketMonitorRow[] = [];
  for (const m of markets) {
    const tracked = (await db.discoveryObservation.findMany({ where: { workspaceId, mission: { marketId: m.id }, companyId: { not: null } }, select: { companyId: true }, distinct: ['companyId'] })).length;
    const inMarket = recent.filter((s) => s.marketId === m.id);
    const n = (...types: string[]) => inMarket.filter((s) => types.includes(s.type)).length;
    const list = lists.find((l) => l.kind === 'MARKET' && l.marketId === m.id);
    out.push({
      marketId: m.id,
      name: m.name,
      tracked,
      newToDataset30d: n('NEW_TO_DATASET'),
      websiteLaunched30d: n('WEBSITE_LAUNCHED'),
      websiteChanges30d: n('WEBSITE_CHANGE', 'TECH_CHANGE'),
      newServices30d: n('NEW_SERVICE'),
      followUpsDue30d: n('CONTACT_LATER_DUE', 'LOST_DEAL_REVISIT'),
      strong: open.filter((s) => s.marketId === m.id && s.strength === 'STRONG').length,
      watched: !!list,
      watchlistId: list?.id ?? null,
    });
  }
  return out;
}

function listWhere(workspaceId: string, q: SignalListQuery, now: Date): Prisma.SignalWhereInput {
  const where: Prisma.SignalWhereInput = { workspaceId };
  const status = q.status ?? 'OPEN';
  if (status === 'OPEN') where.status = { in: OPEN_SIGNAL_STATUSES };
  else if (status !== 'ALL') where.status = status;
  if (q.strength) where.strength = q.strength;
  if (q.type) where.type = q.type;
  if (q.category) where.category = q.category;
  if (q.days) where.detectedAt = { gte: new Date(now.getTime() - q.days * DAY) };
  if (q.marketId) where.marketId = q.marketId;
  if (q.icp) where.relevance = { path: ['icp'], equals: q.icp };
  if (q.relationship) where.relationship = q.relationship;
  if (q.priority !== undefined) where.priority = q.priority;
  if (q.campaignCandidate !== undefined) where.campaignCandidate = q.campaignCandidate;
  if (q.companyId) where.companyId = q.companyId;
  if (q.q?.trim()) where.OR = [{ title: { contains: q.q.trim(), mode: 'insensitive' } }, { company: { displayName: { contains: q.q.trim(), mode: 'insensitive' } } }];
  return where;
}

export async function listSignals(db: PrismaClient, workspaceId: string, q: SignalListQuery, now = new Date()): Promise<SignalRow[]> {
  const signals = await db.signal.findMany({ where: listWhere(workspaceId, q, now), orderBy: { detectedAt: 'desc' }, take: 200 });
  return rows(db, workspaceId, signals, now);
}

/** One signal with everything behind it: evidence, change, hypothesis, deal/conversation, rules, history, cluster. */
export async function signalDetail(db: PrismaClient, workspaceId: string, id: string, now = new Date()): Promise<SignalDetail> {
  const s = await db.signal.findFirst({ where: { id, workspaceId }, include: { evidence: { include: { evidence: true }, orderBy: { observedAt: 'desc' } } } });
  if (!s) throw new NotFoundError(`Signal ${id} not found`);
  const [row] = await rows(db, workspaceId, [s], now);
  const [hyp, opp, conv, run, rules, audits, related] = await Promise.all([
    s.hypothesisId ? db.opportunityHypothesis.findFirst({ where: { id: s.hypothesisId, workspaceId } }) : null,
    s.opportunityId ? db.opportunity.findFirst({ where: { id: s.opportunityId, workspaceId }, include: { stage: { select: { name: true } } } }) : null,
    s.conversationId ? db.conversation.findFirst({ where: { id: s.conversationId, workspaceId }, select: { id: true, subject: true, contactName: true, assignedToId: true } }) : null,
    db.researchRun.findFirst({ where: { workspaceId, companyId: s.companyId, status: { in: ['COMPLETED', 'PARTIAL'] } }, orderBy: { completedAt: 'desc' }, select: { completedAt: true } }),
    s.ruleIds.length ? db.signalRule.findMany({ where: { id: { in: s.ruleIds }, workspaceId }, select: { id: true, name: true, actions: true } }) : [],
    db.auditLog.findMany({ where: { workspaceId, entityType: 'SIGNAL', entityId: s.id }, orderBy: { createdAt: 'asc' }, take: 100 }),
    db.signal.findMany({ where: { workspaceId, companyId: s.companyId, id: { not: s.id }, status: { in: OPEN_SIGNAL_STATUSES } }, orderBy: { detectedAt: 'desc' }, take: 10 }),
  ]);
  const userIds = [opp?.ownerUserId, conv?.assignedToId, ...audits.filter((a) => a.actorType === 'HUMAN').map((a) => a.actorId)].filter((x): x is string => !!x);
  const users = userIds.length ? await db.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, name: true } }) : [];
  const userName = (id: string | null | undefined) => (id ? (users.find((u) => u.id === id)?.name ?? null) : null);
  const change = s.change as { label?: string; previous?: string[] | string | null; current?: string[] | string | null } | null;
  return {
    ...row!,
    change: change?.label ? { label: change.label, previous: change.previous ?? null, current: change.current ?? null } : null,
    evidence: s.evidence.map((e) => ({ evidenceId: e.evidenceId, source: e.source, sourceType: e.evidence.sourceType, evidenceType: e.evidence.evidenceType, url: e.evidence.sourceUrl?.startsWith('revenue-os://') ? null : e.evidence.sourceUrl, excerpt: e.evidence.contentExcerpt, observedAt: e.observedAt.toISOString(), note: e.note, trust: trustOf(e.evidence.sourceType) })),
    hypothesis: hyp ? { id: hyp.id, hypothesis: hyp.hypothesis, reasonSummary: hyp.reasonSummary, confidence: hyp.confidence as Level, status: hyp.status, source: hyp.source } : null,
    opportunity: opp ? { id: opp.id, name: opp.name, stage: opp.stage.name, owner: userName(opp.ownerUserId) } : null,
    conversation: conv ? { id: conv.id, subject: conv.subject, contactName: conv.contactName, owner: userName(conv.assignedToId) } : null,
    researchedAt: iso(run?.completedAt),
    matchedRules: rules.map((r) => ({ id: r.id, name: r.name, actions: r.actions })),
    history: audits.map((a) => {
      const after = (a.afterJson ?? {}) as Record<string, unknown>;
      const detail = a.reason ?? (typeof after.status === 'string' ? `Status: ${after.status}` : typeof after.feedback === 'string' ? `Feedback: ${after.feedback}` : null);
      return { at: a.createdAt.toISOString(), action: a.action, actor: a.actorType === 'HUMAN' ? (userName(a.actorId) ?? 'A person') : a.actorType === 'AI_AGENT' ? 'Signal Agent' : 'System', detail };
    }),
    related: related.map((r) => ({ id: r.id, type: r.type, typeLabel: typeLabel(r.type), title: r.title, strength: r.strength as SignalStrengthKey, detectedAt: r.detectedAt.toISOString() })),
  };
}

/** Company 360 → signals tab: open, history, what was compared, which watchlists, when it is checked next. */
export async function companySignals(db: PrismaClient, workspaceId: string, companyId: string, now = new Date()): Promise<CompanySignals> {
  const company = await db.company.findFirst({ where: { id: companyId, workspaceId }, select: { id: true } });
  if (!company) throw new NotFoundError('Company not found');
  const [all, observations, members] = await Promise.all([
    db.signal.findMany({ where: { workspaceId, companyId }, orderBy: { detectedAt: 'desc' }, take: 100 }),
    db.signalObservation.findMany({ where: { workspaceId, companyId }, orderBy: { observedAt: 'desc' }, take: 30 }),
    db.signalWatchlistMember.findMany({ where: { workspaceId, companyId, watchlist: { archivedAt: null } }, include: { watchlist: { select: { id: true, name: true, priority: true } } } }),
  ]);
  const r = await rows(db, workspaceId, all, now);
  const isOpen = (x: SignalRow) => (OPEN_SIGNAL_STATUSES as string[]).includes(x.status);
  const last = members.reduce<Date | null>((acc, m) => (m.lastCheckedAt && (!acc || m.lastCheckedAt > acc) ? m.lastCheckedAt : acc), null);
  const next = members.reduce<Date | null>((acc, m) => (m.nextCheckAt && (!acc || m.nextCheckAt < acc) ? m.nextCheckAt : acc), null);
  return {
    open: r.filter(isOpen),
    history: r.filter((x) => !isOpen(x)).slice(0, 50),
    observations: observations.map((o) => ({ sourceKind: o.sourceKind as SourceKind, subject: o.subject, changeLevel: o.changeLevel as 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH', detail: o.detail, observedAt: o.observedAt.toISOString() })),
    watchlists: members.map((m) => ({ id: m.watchlist.id, name: m.watchlist.name, priority: m.watchlist.priority as Priority })),
    lastCheckedAt: iso(last),
    nextCheckAt: iso(next),
  };
}

async function watchlistRows(db: PrismaClient, workspaceId: string, where: Prisma.SignalWatchlistWhereInput, now: Date) {
  const lists = await db.signalWatchlist.findMany({ where: { workspaceId, ...where }, orderBy: { createdAt: 'asc' }, include: { members: { select: { companyId: true, nextCheckAt: true, lastCheckedAt: true, addedAt: true, reason: true } } } });
  const companyIds = [...new Set(lists.flatMap((l) => l.members.map((m) => m.companyId)))];
  const open = companyIds.length ? await db.signal.findMany({ where: { workspaceId, companyId: { in: companyIds }, status: { in: OPEN_SIGNAL_STATUSES } }, select: { companyId: true, strength: true } }) : [];
  const marketIds = lists.map((l) => l.marketId).filter((x): x is string => !!x);
  const markets = marketIds.length ? await db.market.findMany({ where: { id: { in: marketIds } }, select: { id: true, name: true } }) : [];
  const toRow = (l: (typeof lists)[number]): WatchlistRow => {
    const ids = new Set(l.members.map((m) => m.companyId));
    return {
      id: l.id,
      name: l.name,
      description: l.description,
      kind: l.kind as WatchlistKind,
      priority: l.priority as Priority,
      marketId: l.marketId,
      market: markets.find((m) => m.id === l.marketId)?.name ?? null,
      cadenceDays: WATCHLIST_CADENCE_DAYS[l.priority as Priority],
      members: l.members.length,
      openSignals: open.filter((s) => ids.has(s.companyId)).length,
      dueForCheck: l.members.filter((m) => !m.nextCheckAt || m.nextCheckAt <= now).length,
      lastSweepAt: iso(l.lastSweepAt),
      createdAt: l.createdAt.toISOString(),
    };
  };
  return { lists, open, toRow };
}

export async function listWatchlists(db: PrismaClient, workspaceId: string, now = new Date()): Promise<WatchlistRow[]> {
  const { lists, toRow } = await watchlistRows(db, workspaceId, { archivedAt: null }, now);
  return lists.map(toRow);
}

export async function watchlistDetail(db: PrismaClient, workspaceId: string, id: string, now = new Date()): Promise<WatchlistDetail> {
  const { lists, open, toRow } = await watchlistRows(db, workspaceId, { id }, now);
  const l = lists[0];
  if (!l) throw new NotFoundError(`Watchlist ${id} not found`);
  const companies = await db.company.findMany({ where: { workspaceId, id: { in: l.members.map((m) => m.companyId) } }, select: { id: true, displayName: true, industry: true, city: true } });
  return {
    ...toRow(l),
    companies: l.members
      .map((m) => {
        const c = companies.find((x) => x.id === m.companyId);
        const mine = open.filter((s) => s.companyId === m.companyId);
        const strongest = mine.reduce<SignalStrengthKey | null>((acc, s) => (!acc || STRENGTH_RANK[s.strength]! > STRENGTH_RANK[acc]! ? (s.strength as SignalStrengthKey) : acc), null);
        return { companyId: m.companyId, company: c?.displayName ?? 'Unknown company', industry: c?.industry ?? null, city: c?.city ?? null, reason: m.reason, addedAt: m.addedAt.toISOString(), lastCheckedAt: iso(m.lastCheckedAt), nextCheckAt: iso(m.nextCheckAt), openSignals: mine.length, strongest };
      })
      .sort((a, b) => b.openSignals - a.openSignals || a.company.localeCompare(b.company)),
  };
}

export async function listSignalRules(db: PrismaClient, workspaceId: string): Promise<SignalRuleRow[]> {
  const rules = await db.signalRule.findMany({ where: { workspaceId }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  return rules.map((r) => {
    const conditions = parseRuleConditions(r.conditions);
    return { id: r.id, name: r.name, enabled: r.enabled, conditions, description: describeRule(conditions), actions: r.actions as RuleAction[], position: r.position, matches: r.matches, lastMatchedAt: iso(r.lastMatchedAt), createdAt: r.createdAt.toISOString() };
  });
}

/**
 * Did signals lead anywhere (screen #9 §36-41)? For signals someone acted on: a conversation, meeting, opportunity or
 * won deal for that company after detection. Suggestions are plain language; a person decides.
 */
export async function signalAnalytics(db: PrismaClient, workspaceId: string, days: number, now = new Date()): Promise<SignalAnalytics> {
  const since = new Date(now.getTime() - days * DAY);
  const [funnel, signals, feedbackRows] = await Promise.all([
    funnelOf(db, workspaceId, since),
    db.signal.findMany({ where: { workspaceId, detectedAt: { gte: since } }, select: { id: true, type: true, status: true, companyId: true, detectedAt: true } }),
    db.signal.groupBy({ by: ['feedback'], where: { workspaceId, detectedAt: { gte: since }, feedback: { not: null } }, _count: { _all: true } }),
  ]);
  const acted = signals.filter((s) => s.status === 'ACTED_ON');
  const companyIds = [...new Set(acted.map((s) => s.companyId))];
  const [convs, meetings, opps] = companyIds.length
    ? await Promise.all([
        db.conversation.findMany({ where: { workspaceId, companyId: { in: companyIds }, createdAt: { gte: since } }, select: { companyId: true, createdAt: true } }),
        db.meeting.findMany({ where: { workspaceId, companyId: { in: companyIds }, createdAt: { gte: since } }, select: { companyId: true, createdAt: true } }),
        db.opportunity.findMany({ where: { workspaceId, companyId: { in: companyIds }, createdAt: { gte: since } }, select: { companyId: true, createdAt: true, status: true, closedAt: true } }),
      ])
    : [[], [], []];
  const outcome = (s: { companyId: string; detectedAt: Date }) => ({
    conversation: convs.some((c) => c.companyId === s.companyId && c.createdAt > s.detectedAt),
    meeting: meetings.some((m) => m.companyId === s.companyId && m.createdAt > s.detectedAt),
    opportunity: opps.some((o) => o.companyId === s.companyId && o.createdAt > s.detectedAt),
    won: opps.some((o) => o.companyId === s.companyId && o.status === 'WON' && (o.closedAt ?? o.createdAt) > s.detectedAt),
  });
  const results = acted.map((s) => ({ type: s.type, ...outcome(s) }));
  const count = (list: typeof results, k: 'conversation' | 'meeting' | 'opportunity' | 'won') => list.filter((r) => r[k]).length;
  const types = [...new Set(signals.map((s) => s.type))];
  const byType = types
    .map((type) => {
      const mine = signals.filter((s) => s.type === type);
      const res = results.filter((r) => r.type === type);
      return { type, label: typeLabel(type), signals: mine.length, actedOn: res.length, dismissed: mine.filter((s) => s.status === 'DISMISSED').length, conversations: count(res, 'conversation'), meetings: count(res, 'meeting'), opportunities: count(res, 'opportunity'), won: count(res, 'won') };
    })
    .sort((a, b) => b.signals - a.signals);
  const suggestions: string[] = [];
  for (const t of byType) {
    if (t.signals >= 5 && t.actedOn === 0) suggestions.push(`${t.label} rarely led to action (${t.signals} signals, none acted on) — lower its priority?`);
    else if (t.signals >= 5 && t.dismissed / t.signals >= 0.5) suggestions.push(`${t.label} is often dismissed (${t.dismissed} of ${t.signals}) — add an ignore rule?`);
    if (t.actedOn >= 3 && t.opportunities >= 1) suggestions.push(`${t.label} led to ${t.opportunities} opportunit${t.opportunities === 1 ? 'y' : 'ies'} — keep it high in the queue.`);
  }
  return {
    days,
    funnel,
    outcomes: { detected: signals.length, relevant: signals.filter((s) => ['ACTIONABLE', 'VALIDATED', 'ACTED_ON'].includes(s.status)).length, actedOn: acted.length, conversations: count(results, 'conversation'), meetings: count(results, 'meeting'), opportunities: count(results, 'opportunity'), won: count(results, 'won') },
    byType,
    feedback: SIGNAL_FEEDBACK.map((f) => ({ feedback: f, label: SIGNAL_FEEDBACK_LABEL[f], count: feedbackRows.find((r) => r.feedback === f)?._count._all ?? 0 })),
    suggestions: suggestions.slice(0, 6),
  };
}

/** Plain-language search → the filters it understood (shown back) → the matching signals. */
export async function searchSignals(db: PrismaClient, workspaceId: string, q: string, now = new Date()): Promise<SignalSearchResult> {
  const markets = await db.market.findMany({ where: { workspaceId, archivedAt: null }, select: { id: true, name: true, city: true } });
  const { filters, explanation } = parseSignalSearch(q, markets);
  return { query: q, filters, explanation, items: await listSignals(db, workspaceId, filters, now) };
}
