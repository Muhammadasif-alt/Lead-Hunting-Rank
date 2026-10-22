import type { Prisma, PrismaClient } from '@revenue-os/database';
import { FUNNEL_STAGES, freshnessState, median, type FreshnessRow, type FunnelStageKey } from '@revenue-os/shared';
import { DAY } from './deps.js';
import { POSITIVE_INTENTS } from './rollup.js';
import { between, convWhere, meetingWhere, messageWhere, oppWhere, revenueWhere, type Scope } from './scope.js';

const POSITIVE = new Set<string>(POSITIVE_INTENTS);

/** Raw numbers for one window and scope; unknowns stay null. */
export interface WindowMetrics {
  wonRevenue: number;
  wonDeals: number;
  lostDeals: number;
  salesCycleDays: number | null;
  opportunities: number;
  qualifiedOpportunities: number;
  meetingsBooked: number;
  meetingsHeld: number;
  contacted: number;
  messagesSent: number;
  replies: number;
  positiveReplies: number;
  unsubscribes: number;
  bounces: number;
  providerCost: number | null;
  providerCalls: number;
  providerUnknown: number;
  aiCost: number | null;
  aiRuns: number;
  aiUnknown: number;
}

/** Positive replies = conversations whose FIRST classification has a positive primary intent. */
export async function firstIntents(db: PrismaClient, workspaceId: string, conversationIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!conversationIds.length) return out;
  const rows = await db.messageClassification.findMany({ where: { workspaceId, conversationId: { in: conversationIds } }, orderBy: { createdAt: 'asc' }, select: { conversationId: true, primaryIntent: true } });
  for (const r of rows) if (!out.has(r.conversationId)) out.set(r.conversationId, r.primaryIntent);
  return out;
}
export const isPositive = (intent: string | undefined | null) => !!intent && POSITIVE.has(intent);

/** Enrollment ids of the scoped companies (mailbox messages carry the enrollment, not the company). */
async function scopedEnrollmentIds(db: PrismaClient, s: Scope): Promise<string[] | null> {
  if (!s.companyIds) return null;
  return (await db.campaignEnrollment.findMany({ where: { workspaceId: s.workspaceId, companyId: { in: s.companyIds }, ...(s.campaignId ? { campaignId: s.campaignId } : {}) }, select: { id: true } })).map((e) => e.id);
}

/** Provider calls in scope: all, or those about the scoped companies (+ the selected market's missions). */
export async function providerCallWhere(db: PrismaClient, s: Scope, from: Date, to: Date): Promise<Prisma.ProviderCallRecordWhereInput> {
  const base: Prisma.ProviderCallRecordWhereInput = { workspaceId: s.workspaceId, startedAt: between(from, to) };
  if (!s.companyIds) return base;
  const missions = s.filters.marketId ? (await db.discoveryMission.findMany({ where: { workspaceId: s.workspaceId, marketId: s.filters.marketId }, select: { id: true } })).map((m) => m.id) : [];
  return { ...base, OR: [{ entityType: 'COMPANY', entityId: { in: s.companyIds } }, ...(missions.length ? [{ entityType: 'DISCOVERY_MISSION', entityId: { in: missions } }] : [])] };
}

export async function windowMetrics(db: PrismaClient, s: Scope, from: Date, to: Date): Promise<WindowMetrics> {
  const ws = s.workspaceId;
  const win = between(from, to);
  const enrollmentIds = await scopedEnrollmentIds(db, s);
  const mailboxScope: Prisma.MailboxMessageWhereInput = { workspaceId: ws, occurredAt: win, ...(s.campaignId ? { campaignId: s.campaignId } : {}), ...(enrollmentIds ? { enrollmentId: { in: enrollmentIds } } : {}) };
  const pcWhere = await providerCallWhere(db, s, from, to);
  const aiWhere: Prisma.AiRunWhereInput = { workspaceId: ws, startedAt: win, ...(s.companyIds ? { task: { entityType: 'COMPANY', entityId: { in: s.companyIds } } } : {}) };
  const [won, lostDeals, opportunities, qualifiedOpportunities, meetingsBooked, meetingsHeld, contacted, msgSent, replySent, convs, unsubscribes, bounces, pcKnown, pcUnknown, aiKnown, aiUnknown, revenue] = await Promise.all([
    db.opportunity.findMany({ where: oppWhere(s, { status: 'WON', closedAt: win }), select: { createdAt: true, closedAt: true } }),
    db.opportunity.count({ where: oppWhere(s, { status: 'LOST', closedAt: win }) }),
    db.opportunity.count({ where: oppWhere(s, { createdAt: win }) }),
    db.opportunity.count({ where: oppWhere(s, { createdAt: win, qualification: { status: 'QUALIFIED' } }) }),
    db.meeting.count({ where: meetingWhere(s, { bookedAt: win }) }),
    db.meetingOutcome.count({ where: { workspaceId: ws, outcome: { not: 'NO_SHOW' }, meeting: meetingWhere(s, { startAt: win }) } }),
    db.campaignMessage.count({ where: messageWhere(s, { status: 'SENT', position: 1, sentAt: win }) }),
    db.campaignMessage.count({ where: messageWhere(s, { status: 'SENT', sentAt: win }) }),
    db.conversationReply.count({ where: { workspaceId: ws, status: 'SENT', sentAt: win, ...(s.companyIds || s.campaignId ? { conversation: convWhere(s) } : {}) } }),
    db.conversation.findMany({ where: convWhere(s, { createdAt: win }), select: { id: true } }),
    s.companyIds || s.campaignId ? db.mailboxMessage.count({ where: { ...mailboxScope, kind: 'UNSUBSCRIBE' } }) : db.suppression.count({ where: { workspaceId: ws, reason: 'UNSUBSCRIBED', createdAt: win } }),
    db.mailboxMessage.count({ where: { ...mailboxScope, kind: 'BOUNCE' } }),
    db.providerCallRecord.aggregate({ where: { ...pcWhere, costMinor: { not: null } }, _sum: { costMinor: true }, _count: { _all: true } }),
    db.providerCallRecord.count({ where: { ...pcWhere, costMinor: null } }),
    db.aiRun.aggregate({ where: { ...aiWhere, costMinor: { not: null } }, _sum: { costMinor: true }, _count: { _all: true } }),
    db.aiRun.count({ where: { ...aiWhere, costMinor: null } }),
    db.revenueEvent.findMany({ where: await revenueWhere(db, s, { occurredAt: win }), select: { type: true, amountMinor: true } }),
  ]);
  const intents = await firstIntents(db, ws, convs.map((c) => c.id));
  const cost = (known: number, n: number, unknown: number) => (n + unknown === 0 ? 0 : n === 0 ? null : known);
  return {
    wonRevenue: revenue.reduce((a, e) => a + (e.type === 'REFUND' ? -e.amountMinor : e.amountMinor), 0),
    wonDeals: won.length,
    lostDeals,
    salesCycleDays: roundOrNull(median(won.map((o) => ((o.closedAt ?? o.createdAt).getTime() - o.createdAt.getTime()) / DAY)), 1),
    opportunities,
    qualifiedOpportunities,
    meetingsBooked,
    meetingsHeld,
    contacted,
    messagesSent: msgSent + replySent,
    replies: convs.length,
    positiveReplies: [...intents.values()].filter(isPositive).length,
    unsubscribes,
    bounces,
    providerCost: cost(pcKnown._sum.costMinor ?? 0, pcKnown._count._all, pcUnknown),
    providerCalls: pcKnown._count._all + pcUnknown,
    providerUnknown: pcUnknown,
    aiCost: cost(aiKnown._sum.costMinor ?? 0, aiKnown._count._all, aiUnknown),
    aiRuns: aiKnown._count._all + aiUnknown,
    aiUnknown,
  };
}

export const roundOrNull = (v: number | null, digits = 1) => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);
export const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

// ───────────────────────────── funnel ─────────────────────────────

export type StageSets = Record<FunnelStageKey, Set<string>>;

/** Companies whose contact points (company or a current employee) have a VALID verification in the window. */
async function contactableCompanies(db: PrismaClient, workspaceId: string, restrict: string[] | null, from: Date | null, to: Date): Promise<Set<string>> {
  const verifiedAt = from ? between(from, to) : { lt: to };
  if (restrict) {
    if (!restrict.length) return new Set();
    const jobs = await db.employment.findMany({ where: { workspaceId, companyId: { in: restrict }, isCurrent: true }, select: { personId: true, companyId: true } });
    const points = await db.contactPoint.findMany({ where: { workspaceId, type: 'EMAIL', OR: [{ entityType: 'COMPANY', entityId: { in: restrict } }, ...(jobs.length ? [{ entityType: 'PERSON' as const, entityId: { in: jobs.map((j) => j.personId) } }] : [])] }, select: { id: true, entityType: true, entityId: true } });
    if (!points.length) return new Set();
    const valid = new Set((await db.contactVerification.findMany({ where: { workspaceId, status: 'VALID', verifiedAt, contactPointId: { in: points.map((p) => p.id) } }, select: { contactPointId: true }, distinct: ['contactPointId'] })).map((v) => v.contactPointId));
    const out = new Set<string>();
    for (const p of points) {
      if (!valid.has(p.id)) continue;
      if (p.entityType === 'COMPANY') out.add(p.entityId);
      else for (const j of jobs) if (j.personId === p.entityId) out.add(j.companyId);
    }
    return out;
  }
  const verified = await db.contactVerification.findMany({ where: { workspaceId, status: 'VALID', verifiedAt }, select: { contactPoint: { select: { entityType: true, entityId: true } } }, take: 20_000 });
  const out = new Set<string>();
  const persons: string[] = [];
  for (const v of verified) (v.contactPoint.entityType === 'COMPANY' ? out.add(v.contactPoint.entityId) : persons.push(v.contactPoint.entityId));
  if (persons.length) for (const j of await db.employment.findMany({ where: { workspaceId, personId: { in: persons }, isCurrent: true }, select: { companyId: true } })) out.add(j.companyId);
  return out;
}

/**
 * Companies that reached each funnel stage — inside a window (from..to) or ever up to `to` (from = null) — restricted
 * to `restrict` company ids when given.
 */
export async function reachedStages(db: PrismaClient, workspaceId: string, restrict: string[] | null, from: Date | null, to: Date): Promise<StageSets> {
  const t = from ? between(from, to) : { lt: to };
  const cIn = restrict ? { companyId: { in: restrict } } : {};
  const ids = (rows: { companyId: string | null }[]) => new Set(rows.map((r) => r.companyId).filter((x): x is string => !!x));
  const [discovered, researched, contactable, contacted, convs, opps, qualified, meetings, won] = await Promise.all([
    db.company.findMany({ where: { workspaceId, createdAt: t, ...(restrict ? { id: { in: restrict } } : {}) }, select: { id: true } }),
    db.researchRun.findMany({ where: { workspaceId, status: { in: ['COMPLETED', 'PARTIAL'] }, completedAt: t, ...cIn }, select: { companyId: true }, distinct: ['companyId'] }),
    contactableCompanies(db, workspaceId, restrict, from, to),
    db.campaignMessage.findMany({ where: { workspaceId, status: 'SENT', position: 1, sentAt: t, ...(restrict ? { enrollment: { companyId: { in: restrict } } } : {}) }, select: { enrollment: { select: { companyId: true } } } }),
    db.conversation.findMany({ where: { workspaceId, createdAt: t, ...cIn }, select: { id: true, companyId: true } }),
    db.opportunity.findMany({ where: { workspaceId, createdAt: t, ...cIn }, select: { companyId: true } }),
    db.opportunity.findMany({ where: { workspaceId, qualification: { status: 'QUALIFIED', updatedAt: t }, ...cIn }, select: { companyId: true } }),
    db.meeting.findMany({ where: { workspaceId, bookedAt: t, ...cIn }, select: { companyId: true } }),
    db.opportunity.findMany({ where: { workspaceId, status: 'WON', closedAt: t, ...cIn }, select: { companyId: true } }),
  ]);
  const intents = await firstIntents(db, workspaceId, convs.map((c) => c.id));
  return {
    discovered: new Set(discovered.map((c) => c.id)),
    researched: ids(researched),
    contactable,
    contacted: new Set(contacted.map((m) => m.enrollment.companyId)),
    replied: ids(convs),
    positive: ids(convs.filter((c) => isPositive(intents.get(c.id)))),
    opportunity: ids(opps),
    qualified: ids(qualified),
    meeting: ids(meetings),
    won: ids(won),
  };
}

/**
 * The period funnel (screen #10 §7): the cohort is every company with funnel activity in the period; each company
 * counts at its furthest stage reached by the period end and at every stage before it (a later stage implies the
 * earlier ones), so conversions never exceed 100%. Returns the counts and the company ids per stage (drill).
 */
export async function funnelCohort(db: PrismaClient, s: Scope, from: Date, to: Date): Promise<{ counts: Record<FunnelStageKey, number>; companies: Record<FunnelStageKey, string[]> }> {
  const inWindow = await reachedStages(db, s.workspaceId, s.companyIds, from, to);
  const cohort = new Set<string>();
  for (const k of FUNNEL_STAGES) for (const id of inWindow[k]) cohort.add(id);
  const ever = cohort.size ? await reachedStages(db, s.workspaceId, [...cohort], null, to) : inWindow;
  const furthest = new Map<string, number>();
  for (const id of cohort) furthest.set(id, 0);
  FUNNEL_STAGES.forEach((k, i) => {
    for (const id of ever[k]) if (cohort.has(id)) furthest.set(id, Math.max(furthest.get(id) ?? 0, i));
  });
  const counts = {} as Record<FunnelStageKey, number>;
  const companies = {} as Record<FunnelStageKey, string[]>;
  FUNNEL_STAGES.forEach((k, i) => {
    companies[k] = [...furthest].filter(([, f]) => f >= i).map(([id]) => id);
    counts[k] = companies[k].length;
  });
  return { counts, companies };
}

// ───────────────────────────── pipeline baselines ─────────────────────────────

/** Median days deals spent in each stage semantic before leaving it, from the stage history (≥ 3 exits, else null). */
export async function stageBaselines(db: PrismaClient, workspaceId: string, minSamples = 3): Promise<Map<string, { days: number | null; samples: number }>> {
  const rows = await db.opportunityStageHistory.findMany({ where: { workspaceId }, orderBy: [{ opportunityId: 'asc' }, { changedAt: 'asc' }], select: { opportunityId: true, toSemantic: true, changedAt: true }, take: 50_000 });
  const durations = new Map<string, number[]>();
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    if (a.opportunityId !== b.opportunityId) continue;
    const list = durations.get(a.toSemantic) ?? [];
    list.push((b.changedAt.getTime() - a.changedAt.getTime()) / DAY);
    durations.set(a.toSemantic, list);
  }
  const out = new Map<string, { days: number | null; samples: number }>();
  for (const [k, v] of durations) out.set(k, { days: v.length >= minSamples ? roundOrNull(median(v), 1) : null, samples: v.length });
  return out;
}

// ───────────────────────────── freshness ─────────────────────────────

/** Where each analytics input stands right now (screen #10 §51) — stale data is labelled stale, never shown as live. */
export async function freshness(db: PrismaClient, workspaceId: string, now = new Date()): Promise<FreshnessRow[]> {
  const live = { workspaceId, status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] as ('DISABLED' | 'DISCONNECTED' | 'CONNECTING')[] } };
  const [outbox, pending, stuck, mailboxes, cursor, calendars, company, opp, revenue, call, unknownCalls, run] = await Promise.all([
    db.outboxEvent.findFirst({ where: { workspaceId, status: 'PUBLISHED' }, orderBy: { publishedAt: 'desc' }, select: { publishedAt: true } }),
    db.outboxEvent.count({ where: { workspaceId, status: 'PENDING', createdAt: { lt: new Date(now.getTime() - 5 * 60_000) } } }),
    db.outboxEvent.count({ where: { workspaceId, status: { in: ['PENDING', 'FAILED'] }, createdAt: { lt: new Date(now.getTime() - 15 * 60_000) } } }),
    db.integration.findMany({ where: { ...live, capabilities: { has: 'EMAIL_READ' } }, select: { id: true, lastSuccessAt: true } }),
    db.mailboxCursor.findFirst({ where: { workspaceId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    db.integration.findMany({ where: { ...live, capabilities: { has: 'CALENDAR_READ' } }, select: { lastSuccessAt: true, lastHealthCheckAt: true } }),
    db.company.findFirst({ where: { workspaceId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    db.opportunity.findFirst({ where: { workspaceId }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    db.revenueEvent.findFirst({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    db.providerCallRecord.findFirst({ where: { workspaceId }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }),
    db.providerCallRecord.count({ where: { workspaceId, costMinor: null, startedAt: { gte: new Date(now.getTime() - 30 * DAY) } } }),
    db.analyticsRun.findFirst({ where: { workspaceId, kind: 'ROLLUP', status: 'SUCCEEDED' }, orderBy: { startedAt: 'desc' }, select: { finishedAt: true, rows: true } }),
  ]);
  const latest = (...ds: (Date | null | undefined)[]) => ds.filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
  const at = (d: Date | null) => d?.toISOString() ?? null;
  const emailAt = latest(cursor?.updatedAt, ...mailboxes.map((m) => m.lastSuccessAt));
  const calAt = latest(...calendars.flatMap((c) => [c.lastSuccessAt, c.lastHealthCheckAt]));
  const crmAt = latest(company?.updatedAt, opp?.updatedAt);
  const projAt = run?.finishedAt ?? null;
  return [
    { source: 'EVENTS', label: 'Event processing', state: pending > 0 ? (stuck > 0 ? 'STALE' : 'DELAYED') : 'CURRENT', lastAt: at(outbox?.publishedAt ?? null), detail: pending > 0 ? `${pending} event(s) waiting longer than 5 minutes` : outbox ? 'All events processed' : 'No events yet' },
    { source: 'EMAIL', label: 'Mailbox sync', state: freshnessState(emailAt, 10, now, mailboxes.length > 0), lastAt: at(emailAt), detail: mailboxes.length ? `${mailboxes.length} mailbox(es) connected` : 'No mailbox connected — replies and bounces are not counted' },
    { source: 'CRM', label: 'Companies and deals', state: crmAt ? 'CURRENT' : 'NOT_CONNECTED', lastAt: at(crmAt), detail: crmAt ? 'Read live from the CRM records' : 'No companies yet' },
    { source: 'CALENDAR', label: 'Calendar', state: freshnessState(calAt, 60, now, calendars.length > 0), lastAt: at(calAt), detail: calendars.length ? `${calendars.length} calendar(s) connected` : 'No calendar connected — meetings are only those confirmed by a person' },
    { source: 'REVENUE', label: 'Revenue events', state: revenue ? 'CURRENT' : 'NOT_CONNECTED', lastAt: at(revenue?.createdAt ?? null), detail: revenue ? 'Won amounts, payments, expansions and refunds as recorded' : 'No revenue recorded yet' },
    { source: 'PROVIDER_COST', label: 'Provider costs', state: call ? (unknownCalls ? 'DELAYED' : 'CURRENT') : 'NOT_CONNECTED', lastAt: at(call?.startedAt ?? null), detail: call ? (unknownCalls ? `${unknownCalls} call(s) in 30 days without a reported cost — counted as unknown, not zero` : 'Every recent call has a cost') : 'No provider calls yet' },
    { source: 'PROJECTIONS', label: 'Daily metrics', state: freshnessState(projAt, 30, now), lastAt: at(projAt), detail: run ? `Rebuilt every 15 minutes (${run.rows} rows)` : 'Not built yet — trends and anomalies wait for the first rollup' },
  ];
}

