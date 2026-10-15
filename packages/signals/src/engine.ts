import type { Prisma, Signal } from '@revenue-os/database';
import { requestResearchTx, writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import {
  assessRelevance,
  decideStatus,
  OPEN_SIGNAL_STATUSES,
  parseRuleConditions,
  recommendAction,
  ruleMatches,
  signalDedupeKey,
  signalExpiry,
  SIGNAL_TYPES,
  signalWindowEnd,
  whyNow,
  type Level,
  type Relevance,
  type SignalTypeKey,
  type SourceKind,
  type SourceTrust,
} from '@revenue-os/shared';
import { companySignalContext, offerFor, trustOf, type CompanySignalContext } from './context.js';
import { DAY } from './deps.js';

export interface SignalEvidenceInput {
  evidenceId: string;
  /** Independent source name (the website domain, "conversation", a lead source) — distinct names count as sources. */
  source: string;
  note?: string | null;
  observedAt: Date;
}

export interface SignalInput {
  companyId: string;
  type: SignalTypeKey;
  /** What the event is about — the dedupe subject (a service name, "booking", "commitment:<id>"). */
  subject: string;
  title: string;
  /** What was observed, with its source — a fact, never an interpretation. */
  fact: string;
  sourceKind: SourceKind;
  evidence: SignalEvidenceInput[];
  /** When the change happened if known (a follow-up date); default now. */
  effectiveAt?: Date;
  change?: { label: string; previous: string[] | string | null; current: string[] | string | null } | null;
  confidence?: Level;
  /** Shortens the type lifetime (never lengthens it). */
  lifetimeDays?: number | null;
  personId?: string | null;
  commitmentId?: string | null;
  opportunityId?: string | null;
  conversationId?: string | null;
  marketId?: string | null;
  /** A rule-based interpretation known at detection (e.g. the expansion cluster) — always hedged. */
  interpretation?: string | null;
  now: Date;
}

export interface RecordedSignal {
  signal: Signal;
  outcome: 'CREATED' | 'MERGED' | 'UNCHANGED';
}

/** Relevance as stored: the explainable components plus the ICP level at the time (SignalRow.icp). */
export type StoredRelevance = Relevance & { icp: Level | null };

const sourcesOf = (rows: { source: string; sourceType: string }[]): { trust: SourceTrust; source: string }[] => rows.map((r) => ({ trust: trustOf(r.sourceType), source: r.source }));

function evaluate(type: SignalTypeKey, c: CompanySignalContext, sources: { trust: SourceTrust; source: string }[], detectedAt: Date, fact: string, now: Date) {
  const info = SIGNAL_TYPES[type];
  const relevance = assessRelevance({ type, detectedAt, now, sources, icp: c.icp, ...offerFor(type, c.services), relationship: c.relationship });
  const why = whyNow({ type, companyName: c.company.name, fact, relevance, relationship: c.relationship, detectedAt, now });
  const action = recommendAction({ type, relationship: c.relationship, relevance, researchFresh: c.researchFresh });
  const status = decideStatus(relevance, why, info.negative);
  return { relevance: { ...relevance, icp: c.icp } as StoredRelevance, why, action, status };
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * Records one detected change (screen #9 §15): the same event from another source — or seen again — merges into the
 * open signal (more evidence, recomputed relevance), never a second signal. A new signal gets explainable relevance,
 * a "why now" (or none), the recommended action for its relationship, its expiry and action window, then the enabled
 * rules run (none of them sends anything). Writes audit + outbox events in the caller's transaction.
 */
export async function recordSignal(tx: Tx, ctx: ServiceContext, input: SignalInput): Promise<RecordedSignal> {
  const { now } = input;
  const info = SIGNAL_TYPES[input.type];
  // One writer per company at a time: find-then-create stays race free across parallel detection jobs.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`signal:${input.companyId}`}))`;
  const effectiveAt = input.effectiveAt ?? now;
  const dedupeKey = signalDedupeKey(input.companyId, input.type, input.subject, now);
  const existing =
    (await tx.signal.findFirst({
      where: { workspaceId: ctx.workspaceId, companyId: input.companyId, type: input.type, subject: { equals: input.subject, mode: 'insensitive' }, status: { in: OPEN_SIGNAL_STATUSES }, detectedAt: { gte: new Date(now.getTime() - info.lifetimeDays * DAY) } },
      orderBy: { detectedAt: 'desc' },
    })) ?? (await tx.signal.findUnique({ where: { workspaceId_dedupeKey: { workspaceId: ctx.workspaceId, dedupeKey } } }));

  if (existing) return mergeInto(tx, ctx, existing, input);

  const c = await companySignalContext(tx, ctx.workspaceId, input.companyId, now);
  const sources = input.evidence.map((e) => ({ source: e.source, sourceType: '' }));
  const evRows = input.evidence.length ? await tx.evidence.findMany({ where: { workspaceId: ctx.workspaceId, id: { in: input.evidence.map((e) => e.evidenceId) } }, select: { id: true, sourceType: true } }) : [];
  for (const [i, e] of input.evidence.entries()) sources[i]!.sourceType = evRows.find((r) => r.id === e.evidenceId)?.sourceType ?? '';
  const freshFrom = effectiveAt > now ? now : effectiveAt;
  const ev = evaluate(input.type, c, sourcesOf(sources), freshFrom, input.fact, now);
  const relatesToDeal = c.relationship === 'OPEN_DEAL' || c.relationship === 'LOST_DEAL';
  const relatesToConversation = c.relationship === 'IN_CONVERSATION' || c.relationship === 'DORMANT';

  let signal = await tx.signal.create({
    data: {
      workspaceId: ctx.workspaceId,
      companyId: input.companyId,
      personId: input.personId ?? null,
      type: input.type,
      category: info.category,
      subject: input.subject.slice(0, 200),
      title: input.title.slice(0, 200),
      fact: input.fact.slice(0, 1000),
      dedupeKey,
      status: ev.status,
      strength: ev.relevance.strength,
      relevance: json(ev.relevance),
      confidence: input.confidence ?? ev.relevance.sourceReliability,
      change: input.change ? json(input.change) : undefined,
      sourceKind: input.sourceKind,
      relationship: c.relationship,
      interpretation: input.interpretation ?? null,
      interpretationSource: input.interpretation ? 'RULE' : null,
      whyNow: ev.why,
      opportunityId: input.opportunityId ?? (relatesToDeal ? c.opportunityId : null),
      conversationId: input.conversationId ?? (relatesToConversation ? c.conversationId : null),
      commitmentId: input.commitmentId ?? null,
      marketId: input.marketId ?? c.marketIds[0] ?? null,
      recommendedAction: ev.action,
      autoActions: [],
      ruleIds: [],
      evidenceCount: 0,
      sourceCount: 0,
      detectedAt: now,
      effectiveAt,
      lastSeenAt: now,
      expiresAt: signalExpiry(input.type, effectiveAt, input.lifetimeDays),
      windowEndsAt: signalWindowEnd(input.type, effectiveAt),
    },
  });
  if (input.evidence.length) {
    await tx.signalEvidence.createMany({ data: input.evidence.map((e) => ({ workspaceId: ctx.workspaceId, signalId: signal.id, evidenceId: e.evidenceId, source: e.source.slice(0, 200), note: e.note?.slice(0, 300) ?? null, observedAt: e.observedAt })), skipDuplicates: true });
  }
  signal = await tx.signal.update({ where: { id: signal.id }, data: { evidenceCount: input.evidence.length, sourceCount: new Set(input.evidence.map((e) => e.source)).size } });
  signal = await applyRules(tx, ctx, signal, c, now);

  await writeAudit(tx, ctx, { action: 'signal.detected', entityType: 'SIGNAL', entityId: signal.id, after: { type: signal.type, companyId: signal.companyId, subject: signal.subject, strength: signal.strength, status: signal.status, recommendedAction: signal.recommendedAction, whyNow: signal.whyNow !== null, evidenceIds: input.evidence.map((e) => e.evidenceId) } });
  await recordEvent(tx, ctx, 'SignalDetected', signal.id, { signalId: signal.id, companyId: signal.companyId, type: signal.type, strength: signal.strength, status: signal.status, sourceKind: signal.sourceKind });
  return { signal, outcome: 'CREATED' };
}

/** Same event again: add only new evidence, recompute relevance from all of it; a repeat of known evidence is a no-op. */
async function mergeInto(tx: Tx, ctx: ServiceContext, existing: Signal, input: SignalInput): Promise<RecordedSignal> {
  const { now } = input;
  const linked = await tx.signalEvidence.findMany({ where: { signalId: existing.id }, select: { evidenceId: true } });
  const known = new Set(linked.map((l) => l.evidenceId));
  const fresh = input.evidence.filter((e, i, all) => !known.has(e.evidenceId) && all.findIndex((x) => x.evidenceId === e.evidenceId) === i);
  if (!fresh.length) return { signal: existing, outcome: 'UNCHANGED' };
  await tx.signalEvidence.createMany({ data: fresh.map((e) => ({ workspaceId: ctx.workspaceId, signalId: existing.id, evidenceId: e.evidenceId, source: e.source.slice(0, 200), note: e.note?.slice(0, 300) ?? null, observedAt: e.observedAt })), skipDuplicates: true });

  const all = await tx.signalEvidence.findMany({ where: { signalId: existing.id }, include: { evidence: { select: { sourceType: true } } } });
  const sourceCount = new Set(all.map((a) => a.source)).size;
  const open = (OPEN_SIGNAL_STATUSES as string[]).includes(existing.status);
  let data: Prisma.SignalUpdateInput = { evidenceCount: all.length, sourceCount, lastSeenAt: now, version: { increment: 1 } };
  let statusChange: { from: string; to: string } | null = null;
  if (open) {
    const c = await companySignalContext(tx, ctx.workspaceId, existing.companyId, now);
    const ev = evaluate(existing.type as SignalTypeKey, c, sourcesOf(all.map((a) => ({ source: a.source, sourceType: a.evidence.sourceType }))), existing.effectiveAt > now ? now : existing.effectiveAt, existing.fact, now);
    // A person's VALIDATED stays; detection-owned statuses follow the evidence.
    const status = existing.status === 'VALIDATED' ? existing.status : ev.status;
    if (status !== existing.status) statusChange = { from: existing.status, to: status };
    data = { ...data, relevance: json(ev.relevance), strength: ev.relevance.strength, whyNow: ev.why, recommendedAction: ev.action, relationship: c.relationship, status, ...(statusChange ? { statusReason: 'More evidence arrived' } : {}) };
  }
  const signal = await tx.signal.update({ where: { id: existing.id }, data });
  for (const e of fresh) await recordEvent(tx, ctx, 'SignalEvidenceAdded', signal.id, { signalId: signal.id, companyId: signal.companyId, evidenceId: e.evidenceId, sourceCount });
  if (statusChange) await recordEvent(tx, ctx, 'SignalStatusChanged', signal.id, { signalId: signal.id, ...statusChange, reason: 'More evidence arrived' });
  await writeAudit(tx, ctx, { action: 'signal.evidence_added', entityType: 'SIGNAL', entityId: signal.id, before: { evidenceCount: existing.evidenceCount, strength: existing.strength }, after: { evidenceCount: signal.evidenceCount, sourceCount, strength: signal.strength, evidenceIds: fresh.map((e) => e.evidenceId) } });
  return { signal, outcome: 'MERGED' };
}

/**
 * IF a signal matches THEN … (screen #9 §22-24). Rules only record, prioritise, queue research, mark a campaign
 * candidate (cold prospects only) or ignore noise — no rule sends anything.
 */
async function applyRules(tx: Tx, ctx: ServiceContext, signal: Signal, c: CompanySignalContext, now: Date): Promise<Signal> {
  const rules = await tx.signalRule.findMany({ where: { workspaceId: ctx.workspaceId, enabled: true }, orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] });
  if (!rules.length) return signal;
  const subject = { type: signal.type, category: signal.category, strength: signal.strength, icp: c.icp, industry: c.company.industry, marketIds: c.marketIds, relationship: c.relationship };
  const auto = new Set<string>();
  const ruleIds: string[] = [];
  let priority = signal.priority;
  let campaignCandidate = signal.campaignCandidate;
  let ignoredBy: string | null = null;
  for (const rule of rules) {
    if (!ruleMatches(parseRuleConditions(rule.conditions), subject)) continue;
    ruleIds.push(rule.id);
    const applied: string[] = [];
    for (const a of rule.actions) {
      if (a === 'IGNORE') {
        ignoredBy = rule.name;
        applied.push(a);
      } else if (a === 'PRIORITY') {
        priority = true;
        applied.push(a);
      } else if (a === 'CAMPAIGN_CANDIDATE') {
        // Never for anyone we already talk to, sell to or have a deal with (existing relationship protection).
        if (c.relationship === 'COLD' && signal.status === 'ACTIONABLE') {
          campaignCandidate = true;
          applied.push(a);
        }
      } else if (a === 'RESEARCH') {
        if (!c.researchFresh) {
          await requestResearchTx(tx, ctx, signal.companyId, 'MONITOR');
          auto.add('RESEARCH');
          applied.push(a);
        }
      } else if (a === 'NOTIFY_OWNER') {
        auto.add('NOTIFY_OWNER');
        applied.push(a);
      } else if (a === 'RECORD') applied.push(a);
    }
    if (priority) auto.add('PRIORITY');
    if (campaignCandidate) auto.add('CAMPAIGN_CANDIDATE');
    await tx.signalRule.update({ where: { id: rule.id }, data: { matches: { increment: 1 }, lastMatchedAt: now } });
    await recordEvent(tx, ctx, 'SignalRuleMatched', signal.id, { signalId: signal.id, ruleId: rule.id, actions: applied });
    if (ignoredBy) break;
  }
  if (!ruleIds.length) return signal;
  const updated = await tx.signal.update({
    where: { id: signal.id },
    data: {
      ruleIds,
      autoActions: [...auto],
      priority: ignoredBy ? false : priority,
      campaignCandidate: ignoredBy ? false : campaignCandidate,
      ...(ignoredBy ? { status: 'DISMISSED' as const, statusReason: `Ignored by rule "${ignoredBy}"`.slice(0, 300) } : {}),
    },
  });
  if (ignoredBy) await recordEvent(tx, ctx, 'SignalStatusChanged', signal.id, { signalId: signal.id, from: signal.status, to: 'DISMISSED', reason: `Ignored by rule "${ignoredBy}"` });
  return updated;
}
