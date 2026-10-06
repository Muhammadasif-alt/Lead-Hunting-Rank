import { recordEvent } from '@revenue-os/events';
import { writeAudit } from '@revenue-os/domain';
import { z } from 'zod';
import { evidenceIndex, LEVEL_RANK, type AgentSpec } from '../agent.js';
import type { CompanyContext } from '../context.js';
import { BASE_RULES, type PromptTemplate } from '../prompts.js';
import { assertToolAllowed } from '../registry.js';
import { grounded, noInventedContacts, type ValidationResult } from '../validators.js';

const DIMENSIONS = ['OPPORTUNITY', 'CONTACTABILITY', 'DATA_CONFIDENCE', 'PRIORITY'] as const;
const Level = z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
const Output = z.object({
  dimensions: z.array(z.object({ dimension: z.enum(DIMENSIONS), level: Level, reasons: z.array(z.string().min(1).max(200)).min(1).max(4), evidenceIds: z.array(z.string()).max(8) })).length(4),
});
export type ScoringOutput = z.infer<typeof Output>;
type Lvl = z.infer<typeof Level>;

/** Without an ICP there is nothing to fit against — said plainly, never guessed (docs/08 §31-32). */
export const NO_ICP_REASON = 'No ideal customer profile defined yet — fit cannot be judged';

const prompt: PromptTemplate = {
  agentType: 'SCORING',
  taskType: 'ASSESS_PRIORITY',
  version: 1,
  schemaName: 'CompanyAssessment',
  schemaVersion: 1,
  system: `${BASE_RULES}
You are the Scoring Agent. Judge four dimensions with a level (HIGH/MEDIUM/LOW/UNKNOWN) and 1-4 short reasons each — no numbers:
OPPORTUNITY (how likely they need help, from hypotheses and checks), CONTACTABILITY (can we reach a relevant person — never higher than the deterministic contactability given), DATA_CONFIDENCE (how fresh, consistent and well-sourced the data is), PRIORITY (how soon a salesperson should look — HIGH only when opportunity and contactability are at least MEDIUM).`,
  template: `Company context (trusted, structured):
{{context}}

Return exactly four dimensions: OPPORTUNITY, CONTACTABILITY, DATA_CONFIDENCE, PRIORITY.`,
};

function input(ctx: CompanyContext) {
  return {
    company: { name: ctx.company.name, industry: ctx.company.industry, website: ctx.company.website },
    research: ctx.research,
    hypotheses: ctx.hypotheses.map((h) => ({ hypothesis: h.hypothesis, confidence: h.confidence, source: h.source, status: h.status, evidenceIds: h.evidenceIds })),
    checks: ctx.audit?.findings.map((f) => ({ check: f.key, observed: f.observed })) ?? null,
    contactability: { level: ctx.contactability.level, reasons: ctx.contactability.reasons },
    facts: ctx.facts.map((f) => ({ field: f.field, status: f.status, confidence: f.confidence })),
    evidence: evidenceIndex(ctx),
  };
}

const capContact = (level: CompanyContext['contactability']['level']): Lvl => (level === 'NONE' ? 'LOW' : level);

/** Scoring Agent (docs/08 §31-32): levels with reasons per dimension, bounded by deterministic facts. */
export const scoringAgent: AgentSpec<ReturnType<typeof input>, ScoringOutput> = {
  type: 'SCORING',
  taskType: prompt.taskType,
  prompt,
  schema: Output,
  skipReason: () => null,
  objective: (ctx) => `Assess opportunity, contactability, data confidence and priority of ${ctx.company.name}`,
  input,
  simulate(_input, ctx) {
    const active = ctx.hypotheses.filter((h) => h.status === 'ACTIVE' || h.status === 'SUPPORTED');
    const ai = ctx.hypotheses.filter((h) => h.status === 'CANDIDATE');
    const researched = !!ctx.research && ['COMPLETED', 'PARTIAL'].includes(ctx.research.status);
    const opportunity: Lvl = !researched && !active.length ? 'UNKNOWN' : active.some((h) => h.confidence === 'HIGH') || active.length >= 3 ? 'HIGH' : active.length ? 'MEDIUM' : 'LOW';
    const contact = capContact(ctx.contactability.level);
    const conflicted = ctx.facts.filter((f) => f.status === 'CONFLICTED').length;
    const fresh = ctx.evidence.filter((e) => e.freshness === 'FRESH').length;
    const official = ctx.evidence.some((e) => e.trust === 'OFFICIAL_WEBSITE');
    const sources = new Set(ctx.evidence.map((e) => e.source)).size;
    const data: Lvl = !ctx.evidence.length ? 'UNKNOWN' : conflicted > 1 || !fresh ? 'LOW' : official && sources >= 2 && !conflicted ? 'HIGH' : 'MEDIUM';
    const priority: Lvl = opportunity === 'UNKNOWN' ? 'UNKNOWN' : LEVEL_RANK[opportunity] >= 2 && LEVEL_RANK[contact] >= 2 ? (opportunity === 'HIGH' ? 'HIGH' : 'MEDIUM') : LEVEL_RANK[opportunity] >= 2 ? 'MEDIUM' : 'LOW';
    const evid = (hs: typeof active) => [...new Set(hs.flatMap((h) => h.evidenceIds))].slice(0, 8);
    return {
      dimensions: [
        {
          dimension: 'OPPORTUNITY',
          level: opportunity,
          reasons: opportunity === 'UNKNOWN' ? ['Not researched yet'] : active.length ? [...active.slice(0, 3).map((h) => h.hypothesis.slice(0, 200)), ...(ai.length ? [`${ai.length} more AI suggestion(s), not verified`] : [])].slice(0, 4) : ['Website checks found nothing that suggests a need'],
          evidenceIds: evid(active),
        },
        { dimension: 'CONTACTABILITY', level: contact, reasons: ctx.contactability.reasons.slice(0, 4).map((r) => r.slice(0, 200)), evidenceIds: [] },
        {
          dimension: 'DATA_CONFIDENCE',
          level: data,
          reasons: [`${ctx.evidence.length} evidence item(s) from ${sources} source(s)`, ...(official ? ['Includes the official website'] : ['No official website evidence']), ...(conflicted ? [`${conflicted} fact(s) conflict between sources`] : []), ...(fresh ? [] : ['Nothing observed in the last 90 days'])].slice(0, 4),
          evidenceIds: ctx.evidence.slice(0, 3).map((e) => e.id),
        },
        {
          dimension: 'PRIORITY',
          level: priority,
          reasons: [priority === 'UNKNOWN' ? 'Research first' : `Opportunity ${opportunity.toLowerCase()}, contactability ${contact.toLowerCase()}`],
          evidenceIds: [],
        },
      ],
    };
  },
  validate(out, ctx) {
    const results: ValidationResult[] = [];
    const by = new Map(out.dimensions.map((d) => [d.dimension, d]));
    const missing = DIMENSIONS.filter((d) => !by.has(d));
    results.push(missing.length ? { validator: 'schema', ok: false, detail: `Missing dimension(s): ${missing.join(', ')}`, blocking: true } : { validator: 'schema', ok: true, detail: 'ok' });
    for (const d of out.dimensions) results.push(grounded(d.dimension, d.evidenceIds, ctx, { required: false }), noInventedContacts(d.dimension, d.reasons.join(' '), ctx));
    // Deterministic guards: AI may explain, not inflate.
    const contact = by.get('CONTACTABILITY');
    const ceiling = capContact(ctx.contactability.level);
    if (contact && LEVEL_RANK[contact.level] > LEVEL_RANK[ceiling]) results.push({ validator: 'contactability_ceiling', ok: false, detail: `CONTACTABILITY ${contact.level} is above what the contact data supports (${ceiling})`, blocking: true });
    const p = by.get('PRIORITY');
    const o = by.get('OPPORTUNITY');
    if (p?.level === 'HIGH' && (LEVEL_RANK[o?.level ?? 'UNKNOWN'] < 2 || LEVEL_RANK[contact?.level ?? 'UNKNOWN'] < 2)) results.push({ validator: 'priority_consistency', ok: false, detail: 'PRIORITY HIGH needs opportunity and contactability of at least MEDIUM', blocking: true });
    return results;
  },
  async apply(tx, sctx, out, ctx, ref) {
    assertToolAllowed(ref.def, 'proposeAssessment');
    const where = { workspaceId: sctx.workspaceId, companyId: ctx.company.id, supersededAt: null };
    await tx.companyAssessment.updateMany({ where, data: { supersededAt: ref.now } });
    const rows = [
      ...out.dimensions.map((d) => ({ dimension: d.dimension, level: d.level, reasons: d.reasons, evidenceIds: d.evidenceIds })),
      { dimension: 'ICP_FIT' as const, level: 'UNKNOWN' as const, reasons: [NO_ICP_REASON], evidenceIds: [] as string[] },
    ];
    await tx.companyAssessment.createMany({ data: rows.map((r) => ({ ...r, workspaceId: sctx.workspaceId, companyId: ctx.company.id, agentTaskId: ref.taskId, assessedAt: ref.now })) });
    const summary = out.dimensions.map((d) => `${d.dimension.toLowerCase().replace('_', ' ')} ${d.level.toLowerCase()}`).join(', ');
    await writeAudit(tx, sctx, { action: 'company.assessed', entityType: 'COMPANY', entityId: ctx.company.id, after: { agentTaskId: ref.taskId, levels: Object.fromEntries(rows.map((r) => [r.dimension, r.level])) } });
    await recordEvent(tx, sctx, 'CompanyAssessed', ctx.company.id, { companyId: ctx.company.id, agentTaskId: ref.taskId, priority: out.dimensions.find((d) => d.dimension === 'PRIORITY')!.level });
    return {
      decision: 'ACT',
      actionType: 'ASSESS_COMPANY',
      confidence: out.dimensions.find((d) => d.dimension === 'DATA_CONFIDENCE')!.level === 'HIGH' ? 'HIGH' : 'MEDIUM',
      risk: 'LOW',
      reasonSummary: summary,
      evidenceRefs: [...new Set(out.dimensions.flatMap((d) => d.evidenceIds))],
    };
  },
};
