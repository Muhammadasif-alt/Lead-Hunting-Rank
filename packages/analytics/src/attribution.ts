import type { Prisma, PrismaClient } from '@revenue-os/database';
import { isUniqueViolation, writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { NotFoundError, roleRelevance, TOUCH_TYPES, type DealLineage, type LineageStep, type TouchTypeKey } from '@revenue-os/shared';
import { HREF, nowOf, systemCtx, TX, type AnalyticsDeps } from './deps.js';

/** One acquisition-chain touch before it is stored. */
export interface DesiredTouch {
  touchType: TouchTypeKey;
  sourceType: string;
  sourceId: string;
  label: string;
  detail: Record<string, unknown>;
  occurredAt: Date;
}

const ORDER = new Map<string, number>(TOUCH_TYPES.map((t, i) => [t, i]));

/** Time order; ties follow the chain order (market before discovery before signal…). Positions start at 1. */
export function orderTouches<T extends { touchType: string; occurredAt: Date; sourceId: string }>(touches: T[]): (T & { position: number })[] {
  return [...touches]
    .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || ORDER.get(a.touchType)! - ORDER.get(b.touchType)! || a.sourceId.localeCompare(b.sourceId))
    .map((t, i) => ({ ...t, position: i + 1 }));
}

/** Persona bucket for slicing: decision maker / manager / other — from the enrolled person's current title. */
export function personaOf(title: string | null | undefined): string {
  if (!title) return 'Unknown role';
  const r = roleRelevance(title);
  return r === 'HIGH' ? 'Owner / decision maker' : r === 'MEDIUM' ? 'Manager / director' : 'Other role';
}

const short = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Rebuilds a deal's touches from the operational records of its company (docs/17 §111-113): market + discovery source,
 * signals and hypotheses before the deal closed, campaign enrollments and their first sent message, conversations,
 * booked meetings, and referral / manual creation. Facts only — a touch exists because a record exists.
 */
export async function desiredTouches(db: Tx | PrismaClient, workspaceId: string, opportunityId: string, now: Date): Promise<{ touches: DesiredTouch[]; opp: Prisma.OpportunityGetPayload<object> }> {
  const opp = await db.opportunity.findFirst({ where: { id: opportunityId, workspaceId } });
  if (!opp) throw new NotFoundError(`Opportunity ${opportunityId} not found`);
  const cutoff = opp.status === 'WON' || opp.status === 'LOST' ? (opp.closedAt ?? now) : now;
  const companyId = opp.companyId;
  const touches: DesiredTouch[] = [];

  const [obs, signals, hyps, enrollments, convs, meetings] = await Promise.all([
    db.discoveryObservation.findFirst({ where: { workspaceId, companyId }, orderBy: { observedAt: 'asc' }, include: { mission: { include: { market: true } } } }),
    db.signal.findMany({ where: { workspaceId, companyId, detectedAt: { lt: cutoff }, status: { notIn: ['DISMISSED', 'CANDIDATE'] } }, orderBy: { detectedAt: 'asc' }, take: 10 }),
    db.opportunityHypothesis.findMany({ where: { workspaceId, companyId, generatedAt: { lt: cutoff }, status: { in: ['ACTIVE', 'SUPPORTED', 'CONVERTED'] } }, orderBy: { generatedAt: 'asc' }, take: 5 }),
    db.campaignEnrollment.findMany({ where: { workspaceId, companyId, enrolledAt: { lt: cutoff } }, include: { campaign: { select: { name: true } } }, orderBy: { enrolledAt: 'asc' } }),
    db.conversation.findMany({ where: { workspaceId, OR: [{ opportunityId: opp.id }, { companyId, createdAt: { lt: cutoff } }] }, orderBy: { createdAt: 'asc' }, take: 10 }),
    db.meeting.findMany({ where: { workspaceId, companyId, bookedAt: { not: null, lt: cutoff }, status: { not: 'CANCELLED' } }, include: { outcome: { select: { outcome: true } } }, orderBy: { bookedAt: 'asc' }, take: 10 }),
  ]);

  if (obs) {
    const m = obs.mission.market;
    touches.push({ touchType: 'MARKET', sourceType: 'Market', sourceId: m.id, label: m.name, detail: { industry: m.industry, city: m.city, region: m.region, country: m.country }, occurredAt: obs.observedAt });
    touches.push({ touchType: 'DISCOVERY', sourceType: 'DiscoveryMission', sourceId: obs.missionId, label: `Found via ${obs.provider}`, detail: { provider: obs.provider, missionId: obs.missionId, marketId: m.id, observationId: obs.id, outcome: obs.outcome }, occurredAt: obs.observedAt });
  }
  for (const s of signals) touches.push({ touchType: 'SIGNAL', sourceType: 'Signal', sourceId: s.id, label: short(s.title), detail: { signalType: s.type, category: s.category, strength: s.strength }, occurredAt: s.detectedAt });
  for (const h of hyps) touches.push({ touchType: 'HYPOTHESIS', sourceType: 'OpportunityHypothesis', sourceId: h.id, label: short(h.hypothesis), detail: { key: h.key, confidence: h.confidence, source: h.source }, occurredAt: h.generatedAt });

  if (enrollments.length) {
    const personIds = enrollments.map((e) => e.personId).filter((x): x is string => !!x);
    const jobs = personIds.length ? await db.employment.findMany({ where: { workspaceId, companyId, personId: { in: personIds } }, orderBy: [{ isCurrent: 'desc' }, { createdAt: 'desc' }], select: { personId: true, title: true } }) : [];
    const titleOf = new Map<string, string | null>();
    for (const j of jobs) if (!titleOf.has(j.personId)) titleOf.set(j.personId, j.title);
    const firstSent = await db.campaignMessage.findMany({ where: { workspaceId, enrollmentId: { in: enrollments.map((e) => e.id) }, status: 'SENT', sentAt: { not: null, lt: cutoff } }, include: { step: { select: { angle: true, kind: true } } }, orderBy: { sentAt: 'asc' } });
    for (const e of enrollments) {
      const title = e.personId ? (titleOf.get(e.personId) ?? null) : null;
      const persona = personaOf(title);
      touches.push({ touchType: 'CAMPAIGN', sourceType: 'Campaign', sourceId: e.campaignId, label: e.campaign.name, detail: { enrollmentId: e.id, personaTitle: title, persona }, occurredAt: e.enrolledAt });
      const msg = firstSent.find((m) => m.enrollmentId === e.id);
      if (msg) touches.push({ touchType: 'MESSAGE', sourceType: 'CampaignMessage', sourceId: msg.id, label: `Step ${msg.position}: ${short(msg.subject, 60)}`, detail: { campaignId: e.campaignId, step: msg.position, variant: msg.step.angle, kind: msg.step.kind, subjectLength: msg.subject.length, personaTitle: title, persona }, occurredAt: msg.sentAt! });
    }
  }
  for (const c of convs) touches.push({ touchType: 'CONVERSATION', sourceType: 'Conversation', sourceId: c.id, label: short(c.subject || 'Conversation'), detail: { intent: c.primaryIntent, campaignId: c.campaignId, linkedToDeal: c.opportunityId === opp.id }, occurredAt: c.createdAt });
  for (const m of meetings) touches.push({ touchType: 'MEETING', sourceType: 'Meeting', sourceId: m.id, label: short(m.title), detail: { status: m.status, outcome: m.outcome?.outcome ?? null, startAt: m.startAt?.toISOString() ?? null }, occurredAt: m.bookedAt! });
  if (opp.source === 'REFERRAL') touches.push({ touchType: 'REFERRAL', sourceType: 'Opportunity', sourceId: opp.id, label: opp.originReason ? short(`Referral: ${opp.originReason}`) : 'Referral', detail: { originReason: opp.originReason }, occurredAt: opp.createdAt });
  if (opp.createdByType === 'HUMAN' && opp.source === 'MANUAL') {
    const owner = opp.ownerUserId ? await db.user.findUnique({ where: { id: opp.ownerUserId }, select: { name: true, email: true } }) : null;
    const ownerName = owner ? owner.name || owner.email : null;
    touches.push({ touchType: 'HUMAN', sourceType: 'Opportunity', sourceId: opp.id, label: ownerName ? `Created by ${ownerName}` : 'Created by a person', detail: { owner: ownerName, ownerUserId: opp.ownerUserId, createdById: opp.createdById }, occurredAt: opp.createdAt });
  }
  return { touches, opp };
}

const signature = (rows: { touchType: string; sourceId: string; position: number; label: string }[]) =>
  rows
    .map((r) => `${r.position}:${r.touchType}:${r.sourceId}:${r.label}`)
    .sort()
    .join('|');

export interface AttributionResult {
  opportunityId: string;
  touches: number;
  changed: boolean;
  revenueRecorded: boolean;
  gaps: string[];
}

/**
 * Idempotently (re)builds a deal's attribution touches and, for a won deal, records the WON revenue event once
 * (dedupeKey `won:<id>`; amount = won amount, else the estimate; neither → nothing recorded and the gap is reported).
 * Audit + AttributionUpdated / RevenueRecorded in the same transaction. Re-running with no new records changes nothing.
 */
export async function attributeOpportunity(deps: AnalyticsDeps, input: { workspaceId: string; opportunityId: string }, ctx: ServiceContext = systemCtx(input.workspaceId)): Promise<AttributionResult> {
  const now = nowOf(deps);
  return deps.db.$transaction(async (tx) => {
    const { touches, opp } = await desiredTouches(tx, input.workspaceId, input.opportunityId, now);
    const ordered = orderTouches(touches);
    const existing = await tx.attributionTouch.findMany({ where: { workspaceId: input.workspaceId, opportunityId: opp.id }, select: { touchType: true, sourceId: true, position: true, label: true } });
    const changed = signature(existing) !== signature(ordered);
    const gaps: string[] = [];
    if (changed) {
      await tx.attributionTouch.deleteMany({ where: { workspaceId: input.workspaceId, opportunityId: opp.id } });
      if (ordered.length)
        await tx.attributionTouch.createMany({
          data: ordered.map((t) => ({ workspaceId: input.workspaceId, opportunityId: opp.id, companyId: opp.companyId, touchType: t.touchType, sourceType: t.sourceType, sourceId: t.sourceId, label: t.label.slice(0, 200), detail: t.detail as Prisma.InputJsonValue, occurredAt: t.occurredAt, position: t.position })),
        });
      await writeAudit(tx, ctx, { action: 'attribution.updated', entityType: 'OPPORTUNITY', entityId: opp.id, before: { touches: existing.length }, after: { touches: ordered.length, chain: ordered.map((t) => t.touchType) } });
      await recordEvent(tx, ctx, 'AttributionUpdated', opp.id, { opportunityId: opp.id, touches: ordered.length });
    }

    let revenueRecorded = false;
    if (opp.status === 'WON') {
      const amount = opp.wonAmountMinor ?? opp.amountMinor;
      const dedupeKey = `won:${opp.id}`;
      const already = await tx.revenueEvent.findUnique({ where: { workspaceId_dedupeKey: { workspaceId: input.workspaceId, dedupeKey } }, select: { id: true } });
      if (amount == null) gaps.push('Won without a value — no revenue recorded until a won amount is entered');
      else if (!already) {
        const ev = await tx.revenueEvent.create({ data: { workspaceId: input.workspaceId, opportunityId: opp.id, companyId: opp.companyId, type: 'WON', amountMinor: Math.max(0, amount), currency: opp.currency, occurredAt: opp.closedAt ?? now, note: opp.wonNote, dedupeKey, createdByType: ctx.actor.type, createdById: ctx.actor.id } });
        await writeAudit(tx, ctx, { action: 'revenue.recorded', entityType: 'REVENUE_EVENT', entityId: ev.id, after: { opportunityId: opp.id, type: 'WON', amountMinor: ev.amountMinor, currency: ev.currency } });
        await recordEvent(tx, ctx, 'RevenueRecorded', ev.id, { revenueEventId: ev.id, opportunityId: opp.id, companyId: opp.companyId, type: 'WON', amountMinor: ev.amountMinor, currency: ev.currency });
        revenueRecorded = true;
      }
    }
    return { opportunityId: opp.id, touches: ordered.length, changed, revenueRecorded, gaps };
  }, TX).catch((err) => {
    // A concurrent run won the race on the WON event / touch keys: the other run's result stands.
    if (isUniqueViolation(err)) return { opportunityId: input.opportunityId, touches: -1, changed: false, revenueRecorded: false, gaps: [] };
    throw err;
  });
}

/** Attributes every open / won deal that has no touches yet (or a won deal without its WON event). Bounded per run. */
export async function backfillAttribution(deps: AnalyticsDeps, workspaceId: string, limit = 200): Promise<number> {
  const opps = await deps.db.opportunity.findMany({ where: { workspaceId, status: { in: ['OPEN', 'WON'] } }, select: { id: true, status: true, wonAmountMinor: true, amountMinor: true }, orderBy: { createdAt: 'asc' }, take: 5000 });
  if (!opps.length) return 0;
  const ids = opps.map((o) => o.id);
  const [touched, won] = await Promise.all([
    deps.db.attributionTouch.findMany({ where: { workspaceId, opportunityId: { in: ids } }, select: { opportunityId: true }, distinct: ['opportunityId'] }),
    deps.db.revenueEvent.findMany({ where: { workspaceId, type: 'WON', opportunityId: { in: ids } }, select: { opportunityId: true } }),
  ]);
  const has = new Set(touched.map((t) => t.opportunityId));
  const hasWon = new Set(won.map((w) => w.opportunityId));
  const todo = opps.filter((o) => !has.has(o.id) || (o.status === 'WON' && !hasWon.has(o.id) && (o.wonAmountMinor ?? o.amountMinor) != null)).slice(0, limit);
  let n = 0;
  for (const o of todo) {
    const r = await attributeOpportunity(deps, { workspaceId, opportunityId: o.id });
    if (r.changed || r.revenueRecorded) n++;
  }
  return n;
}

const stepHref = (t: { touchType: string; sourceId: string; detail: Record<string, unknown> }, companyId: string, opportunityId: string): string | null => {
  switch (t.touchType) {
    case 'MARKET':
      return HREF.market(t.sourceId);
    case 'DISCOVERY':
      return HREF.mission(t.sourceId);
    case 'SIGNAL':
      return HREF.signal(t.sourceId);
    case 'HYPOTHESIS':
      return HREF.company(companyId);
    case 'CAMPAIGN':
      return HREF.campaign(t.sourceId);
    case 'MESSAGE':
      return typeof t.detail.campaignId === 'string' ? HREF.campaign(t.detail.campaignId) : null;
    case 'CONVERSATION':
      return HREF.conversation(t.sourceId);
    case 'MEETING':
      return HREF.meeting(t.sourceId);
    default:
      return HREF.opportunity(opportunityId);
  }
};

/** Gaps in a chain, in words — what is missing is said, never filled in. */
export function lineageGaps(types: Set<string>, o: { status: string; wonAmountMinor: number | null; amountMinor: number | null }, revenueCount: number): string[] {
  const gaps: string[] = [];
  if (!types.size) gaps.push('No touches on record yet — attribution has not run for this deal');
  if (!types.has('DISCOVERY') && types.size) gaps.push('No discovery source on record — the company was added by hand');
  if (!types.has('CAMPAIGN') && !types.has('CONVERSATION') && types.size) gaps.push('No outreach or conversation on record before the deal');
  if (!types.has('MEETING') && types.size) gaps.push('No booked meeting on record');
  if (o.status === 'WON' && o.wonAmountMinor == null && o.amountMinor == null) gaps.push('Won without a value — no revenue recorded');
  else if (o.status === 'WON' && !revenueCount) gaps.push('Won, but the revenue event has not been recorded yet');
  return gaps;
}

/** One deal's acquisition chain with links to every record, its revenue events and the human owner beside it. */
export async function lineage(db: PrismaClient, workspaceId: string, opportunityId: string): Promise<DealLineage> {
  const o = await db.opportunity.findFirst({ where: { id: opportunityId, workspaceId } });
  if (!o) throw new NotFoundError(`Opportunity ${opportunityId} not found`);
  return (await lineages(db, workspaceId, [o]))[0]!;
}

/** Batched lineage for several deals (attribution report). */
export async function lineages(db: PrismaClient, workspaceId: string, opps: { id: string; name: string; companyId: string; status: string; amountMinor: number | null; wonAmountMinor: number | null; currency: string; closedAt: Date | null; ownerUserId: string | null }[]): Promise<DealLineage[]> {
  if (!opps.length) return [];
  const ids = opps.map((o) => o.id);
  const [touches, revenue, companies, owners] = await Promise.all([
    db.attributionTouch.findMany({ where: { workspaceId, opportunityId: { in: ids } }, orderBy: { position: 'asc' } }),
    db.revenueEvent.findMany({ where: { workspaceId, opportunityId: { in: ids } }, orderBy: { occurredAt: 'asc' } }),
    db.company.findMany({ where: { workspaceId, id: { in: [...new Set(opps.map((o) => o.companyId))] } }, select: { id: true, displayName: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(opps.map((o) => o.ownerUserId).filter((x): x is string => !!x))] } }, select: { id: true, name: true, email: true } }),
  ]);
  const companyName = new Map(companies.map((c) => [c.id, c.displayName]));
  const ownerName = new Map(owners.map((u) => [u.id, u.name || u.email]));
  return opps.map((o) => {
    const mine = touches.filter((t) => t.opportunityId === o.id);
    const rev = revenue.filter((r) => r.opportunityId === o.id);
    const steps: LineageStep[] = mine.map((t) => {
      const detail = (t.detail ?? {}) as Record<string, unknown>;
      return { touchType: t.touchType as TouchTypeKey, label: t.label, occurredAt: t.occurredAt.toISOString(), href: stepHref({ touchType: t.touchType, sourceId: t.sourceId, detail }, o.companyId, o.id), detail };
    });
    return {
      opportunityId: o.id,
      name: o.name,
      company: companyName.get(o.companyId) ?? 'Unknown company',
      companyId: o.companyId,
      status: o.status,
      amountMinor: o.amountMinor,
      wonAmountMinor: o.wonAmountMinor,
      currency: o.currency,
      closedAt: o.closedAt?.toISOString() ?? null,
      steps,
      revenue: rev.map((r) => ({ id: r.id, type: r.type, amountMinor: r.amountMinor, currency: r.currency, occurredAt: r.occurredAt.toISOString(), note: r.note })),
      owner: o.ownerUserId ? (ownerName.get(o.ownerUserId) ?? null) : null,
      gaps: lineageGaps(new Set(mine.map((t) => t.touchType)), o, rev.filter((r) => r.type === 'WON').length),
    };
  });
}
