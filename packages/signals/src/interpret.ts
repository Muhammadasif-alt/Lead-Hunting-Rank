import { buildCompanyContext, runAgentTask, signalAgent, type SignalContext } from '@revenue-os/ai';
import type { Signal } from '@revenue-os/database';
import { writeAudit } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { OPEN_SIGNAL_STATUSES, SIGNAL_TYPES, type Relevance, type SignalTypeKey } from '@revenue-os/shared';
import { typeLabel } from './detect-rules.js';
import { nowOf, systemCtx, TX, type SignalDeps } from './deps.js';

const HYPOTHESIS_TTL_DAYS = 180;

/**
 * What a change MAY mean (screen #9 §11-12) — always hedged, never intent. The deterministic baseline every signal
 * gets, and the Signal Agent's test-model answer.
 */
export function ruleInterpretation(type: string, relevance: Pick<Relevance, 'matchedServices' | 'commercialRelevance'>): string {
  const offer = relevance.matchedServices.length ? ` — ${relevance.matchedServices.slice(0, 2).join(' and ')} may be relevant` : '';
  switch (type as SignalTypeKey) {
    case 'NEW_SERVICE':
      return `They may be expanding what they offer; a new service often needs new customers, so lead generation or visibility for it could matter now${offer}.`;
    case 'NEW_LOCATION':
      return `They may be growing into a new area, which could bring a need to be found there${offer}.`;
    case 'EXPANSION':
      return `Several changes together may suggest the business is expanding — an inference, not a confirmed fact${offer}.`;
    case 'HIRING':
      return `Hiring may mean more work than the current team can handle; follow-up or automation could be relevant${offer}.`;
    case 'WEBSITE_LAUNCHED':
      return `A new website may mean they are starting to invest online; getting found and turning visits into enquiries could matter next${offer}.`;
    case 'WEBSITE_CHANGE':
      return `They may be investing in their online presence right now${offer}.`;
    case 'TECH_CHANGE':
      return `A tooling change may show they are working on how customers reach them; this could be a moment to compare options${offer}.`;
    case 'WEBSITE_DOWN':
      return 'The website may be down for a technical reason, an expired domain or a business change — recheck before any outreach; this is not a reason to contact them.';
    case 'WEBSITE_BACK':
      return 'The website loads again; the earlier outage may have been temporary.';
    case 'LEADERSHIP_CHANGE':
      return 'A new decision maker may review existing suppliers and priorities; the change could reopen past decisions.';
    case 'NEW_STAKEHOLDER':
      return 'Another decision maker may be involved in buying decisions.';
    case 'NEW_TO_DATASET':
      return 'This business is new to our dataset; it may be new, or it may simply not have been listed before.';
    case 'BUSINESS_CLOSED':
      return 'The business may have closed; outreach eligibility should be removed until confirmed otherwise.';
    case 'CONTACT_LATER_DUE':
      return 'They asked to be contacted around now; they may be ready to continue the conversation.';
    case 'LOST_DEAL_REVISIT':
      return 'The reason the deal was lost may have changed by the agreed revisit date.';
    case 'DORMANT_REENGAGED':
      return 'They may be ready to talk again after months of silence.';
    case 'PRICING_ASKED':
      return 'Asking for pricing may mean they are actively evaluating — a first-party signal for the owner.';
    case 'MEETING_ASKED':
      return 'Asking for a meeting may mean they want to move forward soon.';
    case 'TIMELINE_STATED':
      return 'A stated timeline may set when a decision could happen.';
    case 'CURRENT_SOLUTION_ISSUE':
      return 'Dissatisfaction with their current provider may make them open to an alternative — internal sales context, not for outreach copy.';
    case 'STAKEHOLDER_MENTIONED':
      return 'Another person may be involved in the decision.';
    default:
      return `This change may be relevant${offer}.`;
  }
}

/**
 * Interprets one signal (docs/17 §106-110): the rule-based reading always (hedged), a CANDIDATE hypothesis when we sell
 * something that fits, then the Signal Agent when a model is connected — its answer passes validators and is applied
 * through its tools, never written directly. Idempotent per signal (and per explicit re-analysis key).
 */
export async function analyzeSignal(deps: SignalDeps, job: { workspaceId: string; signalId: string; inputKey?: string }): Promise<{ outcome: 'SKIPPED' | 'RULE' | 'AI'; reason?: string; aiStatus?: string }> {
  const { db } = deps;
  const now = nowOf(deps);
  const signal = await db.signal.findFirst({ where: { id: job.signalId, workspaceId: job.workspaceId } });
  if (!signal) return { outcome: 'SKIPPED', reason: 'NOT_FOUND' };
  if (!(OPEN_SIGNAL_STATUSES as string[]).includes(signal.status)) return { outcome: 'SKIPPED', reason: 'NOT_OPEN' };
  const relevance = signal.relevance as unknown as Relevance;
  const info = SIGNAL_TYPES[signal.type as SignalTypeKey];
  const rule = signal.interpretation && signal.interpretationSource === 'RULE' ? signal.interpretation : ruleInterpretation(signal.type, relevance);
  const ctx = systemCtx(job.workspaceId);

  // 1) Rule baseline (only when nothing — or only a rule — interpreted it yet).
  if (signal.interpretationSource !== 'AI') {
    await db.$transaction(async (tx) => {
      let hypothesisId = signal.hypothesisId;
      if (!info?.negative && relevance.commercialRelevance !== 'LOW') {
        const key = `SIGNAL_${signal.type}`;
        const links = await tx.signalEvidence.findMany({ where: { signalId: signal.id }, select: { evidenceId: true } });
        const existing = await tx.opportunityHypothesis.findUnique({ where: { workspaceId_companyId_key: { workspaceId: job.workspaceId, companyId: signal.companyId, key } } });
        const reopen = !existing || existing.status === 'INVALIDATED' || existing.status === 'EXPIRED';
        const fields = { hypothesis: rule.slice(0, 500), reasonSummary: signal.fact.slice(0, 500), confidence: relevance.commercialRelevance === 'HIGH' && signal.strength === 'STRONG' ? ('MEDIUM' as const) : ('LOW' as const), lastSupportedAt: now, expiresAt: new Date(now.getTime() + HYPOTHESIS_TTL_DAYS * 86_400_000) };
        // A hypothesis from a signal is a CANDIDATE — a possibility with evidence, never a fact.
        const row = existing
          ? await tx.opportunityHypothesis.update({ where: { id: existing.id }, data: { lastSupportedAt: now, ...(reopen ? { ...fields, status: 'CANDIDATE' as const, generatedAt: now } : {}), version: { increment: 1 } } })
          : await tx.opportunityHypothesis.create({ data: { workspaceId: job.workspaceId, companyId: signal.companyId, key, source: 'RULE', status: 'CANDIDATE', generatedAt: now, ...fields } });
        if (links.length) await tx.hypothesisEvidence.createMany({ data: links.map((l) => ({ workspaceId: job.workspaceId, hypothesisId: row.id, evidenceId: l.evidenceId })), skipDuplicates: true });
        if (reopen) {
          await writeAudit(tx, ctx, { action: 'hypothesis.proposed', entityType: 'OPPORTUNITY_HYPOTHESIS', entityId: row.id, after: { key, source: 'RULE', signalId: signal.id, evidenceIds: links.map((l) => l.evidenceId) } });
          await recordEvent(tx, ctx, 'OpportunityHypothesisProposed', row.id, { hypothesisId: row.id, companyId: signal.companyId, key, confidence: row.confidence });
        }
        hypothesisId = row.id;
      }
      if (signal.interpretation === rule && signal.hypothesisId === hypothesisId) return;
      await tx.signal.update({ where: { id: signal.id }, data: { interpretation: rule, interpretationSource: 'RULE', hypothesisId, version: { increment: 1 } } });
      await writeAudit(tx, ctx, { action: 'signal.interpreted', entityType: 'SIGNAL', entityId: signal.id, after: { source: 'RULE', hypothesisId } });
      await recordEvent(tx, ctx, 'SignalInterpreted', signal.id, { signalId: signal.id, source: 'RULE', hypothesisId, whyNow: signal.whyNow !== null });
    }, TX);
  }

  // 2) The Signal Agent, when a model is connected (no model → the rule reading stands; nothing is pretended).
  const models = await db.integration.count({ where: { workspaceId: job.workspaceId, capabilities: { hasSome: ['LLM_REASONING', 'LLM_EXTRACTION'] }, status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] } } });
  if (!models) return { outcome: 'RULE', reason: 'No AI model connected' };
  const fresh = (await db.signal.findUniqueOrThrow({ where: { id: signal.id } })) as Signal;
  const context: SignalContext = { ...(await buildCompanyContext(db, job.workspaceId, signal.companyId, now)), signal: await signalView(deps, fresh, rule) };
  const result = await runAgentTask({ db, providers: deps.providers, now: deps.now }, signalAgent, context, job.inputKey ?? `signal:${signal.id}`);
  return { outcome: result.status === 'COMPLETED' ? 'AI' : 'RULE', aiStatus: result.status, reason: result.detail };
}

async function signalView(deps: SignalDeps, s: Signal, rule: string): Promise<SignalContext['signal']> {
  const relevance = s.relevance as unknown as Relevance;
  const links = await deps.db.signalEvidence.findMany({ where: { signalId: s.id }, include: { evidence: { select: { contentExcerpt: true } } }, orderBy: { observedAt: 'desc' }, take: 10 });
  return {
    id: s.id,
    type: s.type,
    typeLabel: typeLabel(s.type),
    category: s.category,
    title: s.title,
    fact: s.fact,
    strength: s.strength,
    relationship: s.relationship,
    commercialRelevance: relevance.commercialRelevance,
    matchedServices: relevance.matchedServices ?? [],
    whyNow: s.whyNow,
    ruleInterpretation: rule,
    evidence: links.map((l) => ({ id: l.evidenceId, source: l.source, excerpt: l.evidence.contentExcerpt, observedAt: l.observedAt.toISOString() })),
    negative: SIGNAL_TYPES[s.type as SignalTypeKey]?.negative ?? false,
  };
}
