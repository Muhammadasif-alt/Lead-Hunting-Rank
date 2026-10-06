import { z } from 'zod';
import { evidenceIndex, type AgentSpec } from '../agent.js';
import type { CompanyContext } from '../context.js';
import { BASE_RULES, type PromptTemplate } from '../prompts.js';
import { assertToolAllowed } from '../registry.js';
import { lengthCap, noInventedContacts, type ValidationResult } from '../validators.js';

const Output = z.object({
  summary: z.string().min(1).max(600),
  known: z.array(z.string().max(160)).max(8),
  gaps: z.array(z.object({ gap: z.string().min(1).max(200), importance: z.enum(['HIGH', 'MEDIUM', 'LOW']) })).max(6),
  nextSteps: z.array(z.object({ action: z.enum(['REFRESH_RESEARCH', 'VERIFY_EMAILS', 'FIND_DECISION_MAKER', 'REVIEW_CONFLICTS', 'NONE']), reason: z.string().min(1).max(200) })).max(4),
});
export type ResearchOutput = z.infer<typeof Output>;

const prompt: PromptTemplate = {
  agentType: 'RESEARCH',
  taskType: 'PLAN_RESEARCH',
  version: 1,
  schemaName: 'ResearchPlan',
  schemaVersion: 1,
  system: `${BASE_RULES}
You are the Research Agent. Say what we know about the company, what is still missing that matters for selling to them, and the next research step. Ask only for what is missing — not everything. You recommend; you do not run anything.`,
  template: `Company context (trusted, structured):
{{context}}

Return: summary (2-3 sentences), known (short facts we hold), gaps (with importance), nextSteps (from the allowed actions, with a reason).`,
};

const STALE_DAYS = 90;

function input(ctx: CompanyContext) {
  return {
    company: ctx.company,
    research: ctx.research,
    website: ctx.website,
    facts: ctx.facts.map((f) => ({ field: f.field, value: f.value, status: f.status })),
    people: ctx.people.map((p) => ({ name: p.name, title: p.title, roleConfidence: p.confidence, emails: p.emails.map((e) => e.status) })),
    companyContacts: ctx.companyContacts.map((c) => ({ type: c.type, status: c.status })),
    contactability: ctx.contactability,
    evidence: evidenceIndex(ctx),
  };
}

/** Research Agent (docs/08 §18-21): gap-aware — what we need to know next, not "fetch everything". */
export const researchAgent: AgentSpec<ReturnType<typeof input>, ResearchOutput> = {
  type: 'RESEARCH',
  taskType: prompt.taskType,
  prompt,
  schema: Output,
  skipReason: () => null,
  objective: (ctx) => `Summarise what we know about ${ctx.company.name} and plan the next research step`,
  input,
  simulate(_input, ctx) {
    const conflicted = ctx.facts.filter((f) => f.status === 'CONFLICTED');
    const unverified = [...ctx.companyContacts, ...ctx.people.flatMap((p) => p.emails)].filter((c) => (c as { type?: string }).type !== 'BUSINESS_PHONE' && c.status === 'UNVERIFIED');
    const decider = ctx.people.find((p) => p.relevance === 'HIGH');
    const last = ctx.research?.completedAt ? new Date(ctx.research.completedAt) : null;
    const stale = !last || Date.now() - last.getTime() > STALE_DAYS * 86_400_000;
    const known = [
      ctx.company.website ? `Website ${ctx.company.website} (${ctx.website?.status.toLowerCase() ?? 'not checked'})` : 'No website on record',
      ...(ctx.company.phone ? ['Main phone on record'] : []),
      ...(decider ? [`${decider.name} — ${decider.title ?? 'role unknown'} (named on the website)`] : []),
      `${ctx.facts.length} fact(s) from ${new Set(ctx.evidence.map((e) => e.source)).size} source(s)`,
    ].slice(0, 8);
    const gaps: ResearchOutput['gaps'] = [
      ...(decider ? [] : [{ gap: 'No owner or decision maker identified', importance: 'HIGH' as const }]),
      ...(ctx.people.some((p) => p.emails.some((e) => e.status === 'VERIFIED')) ? [] : [{ gap: 'No verified email for a person', importance: 'HIGH' as const }]),
      ...(conflicted.length ? [{ gap: `${conflicted.length} fact(s) conflict between sources`, importance: 'MEDIUM' as const }] : []),
      ...(ctx.research?.gaps ?? []).slice(0, 2).map((g) => ({ gap: g.slice(0, 200), importance: 'LOW' as const })),
    ].slice(0, 6);
    const nextSteps: ResearchOutput['nextSteps'] = [
      ...(conflicted.length ? [{ action: 'REVIEW_CONFLICTS' as const, reason: 'Sources disagree on some facts — a person should pick the right value' }] : []),
      ...(stale ? [{ action: 'REFRESH_RESEARCH' as const, reason: last ? `Last researched more than ${STALE_DAYS} days ago` : 'Never researched' }] : []),
      ...(unverified.length ? [{ action: 'VERIFY_EMAILS' as const, reason: `${unverified.length} email(s) not verified yet` }] : []),
      ...(decider ? [] : [{ action: 'FIND_DECISION_MAKER' as const, reason: 'The website names no owner or founder' }]),
    ].slice(0, 4);
    return {
      summary: `${ctx.company.name}${ctx.company.industry ? ` (${ctx.company.industry})` : ''}: contactability ${ctx.contactability.level.toLowerCase()}, ${ctx.hypotheses.length} opportunity hypothesis(es).${gaps.length ? ` Most important gap: ${gaps[0]!.gap.toLowerCase()}.` : ''}`.slice(0, 600),
      known,
      gaps,
      nextSteps: nextSteps.length ? nextSteps : [{ action: 'NONE', reason: 'Nothing important is missing right now' }],
    };
  },
  validate(out, ctx): ValidationResult[] {
    const text = [out.summary, ...out.known, ...out.gaps.map((g) => g.gap), ...out.nextSteps.map((s) => s.reason)].join(' ');
    return [lengthCap('summary', out.summary, 600), noInventedContacts('research plan', text, ctx)];
  },
  async apply(_tx, _sctx, out, ctx, ref) {
    // Next steps are proposals: recorded on the decision, not executed (no research loop without a person).
    assertToolAllowed(ref.def, 'proposeNextStep');
    return {
      decision: 'PROPOSE',
      actionType: 'PLAN_RESEARCH',
      confidence: 'MEDIUM',
      risk: 'LOW',
      reasonSummary: out.summary,
      evidenceRefs: ctx.evidence.slice(0, 5).map((e) => e.id),
      uncertainties: out.gaps.map((g) => g.gap),
    };
  },
};
