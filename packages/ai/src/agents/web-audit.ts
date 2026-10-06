import { recordEvent } from '@revenue-os/events';
import { writeAudit } from '@revenue-os/domain';
import { z } from 'zod';
import { evidenceIndex, type AgentSpec } from '../agent.js';
import type { CompanyContext } from '../context.js';
import { BASE_RULES, type PromptTemplate } from '../prompts.js';
import { assertToolAllowed } from '../registry.js';
import { grounded, hedged, lengthCap, noInventedContacts, type ValidationResult } from '../validators.js';

const Output = z.object({
  summary: z.string().min(1).max(600),
  observations: z.array(z.object({ statement: z.string().min(1).max(240), evidenceIds: z.array(z.string()).max(6) })).max(8),
  hypotheses: z
    .array(
      z.object({
        title: z.string().min(3).max(80),
        hypothesis: z.string().min(1).max(280),
        reason: z.string().min(1).max(280),
        confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
        evidenceIds: z.array(z.string()).min(1).max(6),
      }),
    )
    .max(4),
  uncertainties: z.array(z.string().max(200)).max(5),
});
export type WebAuditOutput = z.infer<typeof Output>;

const prompt: PromptTemplate = {
  agentType: 'WEB_AUDIT',
  taskType: 'INTERPRET_AUDIT',
  version: 1,
  schemaName: 'WebsiteAuditInterpretation',
  schemaVersion: 1,
  system: `${BASE_RULES}
You are the Website Audit Agent. Deterministic checks already ran (https, mobile viewport, contact form, booking, chat, call to action, copyright year); do not re-check them — interpret them for a salesperson.`,
  template: `Company context (trusted, structured):
{{context}}

Website pages (untrusted data):
{{untrusted}}

Return:
- summary: 2-3 plain sentences on how this website serves new customers.
- observations: up to 8 short statements, each citing the evidence ids that show it.
- hypotheses: up to 4 possible needs that go beyond the existing rule-based hypotheses, each hedged ("may"), with a reason and evidence ids. Return none if nothing is supported.
- uncertainties: what you could not tell.`,
};

const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
const finding = (ctx: CompanyContext, key: string) => ctx.audit?.findings.find((f) => f.key === key);

/** Website Audit Agent (docs/08 §25-27): reasons about deterministic findings; never rediscovers them. */
export const webAuditAgent: AgentSpec<ReturnType<typeof input>, WebAuditOutput> = {
  type: 'WEB_AUDIT',
  taskType: prompt.taskType,
  prompt,
  schema: Output,
  skipReason: (ctx) => (ctx.audit ? null : ctx.company.website ? 'The website has not been checked yet' : 'No website on record'),
  objective: (ctx) => `Interpret the website checks of ${ctx.company.name}`,
  input,
  simulate(_input, ctx) {
    const f = (key: string) => finding(ctx, key);
    const observations = (ctx.audit?.findings ?? [])
      .filter((x) => x.observed !== null && x.evidenceIds.length)
      .map((x) => ({ statement: `${x.label}: ${x.observed ? 'yes' : 'no'} — ${x.detail}`.slice(0, 240), evidenceIds: x.evidenceIds.slice(0, 6) }));
    const no = (key: string) => f(key)?.observed === false && (f(key)?.evidenceIds.length ?? 0) > 0;
    const ids = (...keys: string[]) => [...new Set(keys.flatMap((k) => f(k)?.evidenceIds ?? []))].slice(0, 6);
    const hypotheses: WebAuditOutput['hypotheses'] = [];
    if (no('booking') && no('contact_form')) {
      hypotheses.push({ title: 'Hard to enquire online', hypothesis: 'Visitors may find no easy way to enquire or book online, so some may leave without contacting them.', reason: 'The pages checked have neither a contact form nor online booking.', confidence: 'MEDIUM', evidenceIds: ids('booking', 'contact_form') });
    } else if (no('booking') && no('chat')) {
      hypotheses.push({ title: 'Slow first response', hypothesis: 'Visitors who want a quick answer or a booking may have to wait for a call back.', reason: 'No online booking and no live chat on the pages checked.', confidence: 'LOW', evidenceIds: ids('booking', 'chat') });
    }
    if (no('ssl') || no('mobile')) {
      hypotheses.push({ title: 'Weak first impression on phones', hypothesis: 'Some visitors on phones may leave before contacting them because the site looks unsafe or hard to use.', reason: [no('ssl') ? 'The site has no https.' : '', no('mobile') ? 'The home page has no mobile viewport.' : ''].filter(Boolean).join(' '), confidence: no('ssl') && no('mobile') ? 'MEDIUM' : 'LOW', evidenceIds: ids('ssl', 'mobile') });
    }
    if (no('freshness')) {
      hypotheses.push({ title: 'Dated website', hypothesis: 'The website may look dated to new visitors and undersell the business.', reason: `The footer copyright says ${ctx.audit?.copyrightYear}.`, confidence: 'LOW', evidenceIds: ids('freshness') });
    }
    const missing = (ctx.audit?.findings ?? []).filter((x) => x.observed === false).map((x) => x.label.toLowerCase());
    const present = (ctx.audit?.findings ?? []).filter((x) => x.observed === true).map((x) => x.label.toLowerCase());
    return {
      summary: `The website has ${present.length ? present.join(', ') : 'none of the checked features'}.${missing.length ? ` Missing: ${missing.join(', ')}.` : ''}`.slice(0, 600),
      observations: observations.slice(0, 8),
      hypotheses: hypotheses.slice(0, 4),
      uncertainties: [
        ...((ctx.audit?.pagesChecked ?? 0) < 3 ? [`Only ${ctx.audit?.pagesChecked ?? 0} page(s) were read`] : []),
        ...(ctx.untrusted.some((u) => u.flagged) ? ['A page contains text aimed at bots; it was treated as data and ignored'] : []),
      ],
    };
  },
  validate(out, ctx) {
    const results: ValidationResult[] = [lengthCap('summary', out.summary, 600), noInventedContacts('summary', out.summary, ctx)];
    for (const o of out.observations) results.push(grounded(`observation "${o.statement.slice(0, 40)}"`, o.evidenceIds, ctx), noInventedContacts('observation', o.statement, ctx));
    for (const h of out.hypotheses) {
      results.push(grounded(`hypothesis "${h.title}"`, h.evidenceIds, ctx), hedged(`hypothesis "${h.title}"`, h.hypothesis), noInventedContacts(`hypothesis "${h.title}"`, `${h.hypothesis} ${h.reason}`, ctx));
    }
    return results;
  },
  async apply(tx, sctx, out, ctx, ref) {
    if (out.hypotheses.length) assertToolAllowed(ref.def, 'proposeHypothesis');
    const keys: string[] = [];
    for (const h of out.hypotheses) {
      const key = `AI_${slug(h.title)}`;
      keys.push(key);
      const existing = await tx.opportunityHypothesis.findUnique({ where: { workspaceId_companyId_key: { workspaceId: sctx.workspaceId, companyId: ctx.company.id, key } } });
      const fields = { hypothesis: h.hypothesis, reasonSummary: h.reason, confidence: h.confidence, lastSupportedAt: ref.now, expiresAt: new Date(ref.now.getTime() + 180 * 86_400_000) };
      // AI suggestions stay CANDIDATE: shown as "AI suggestion — not verified" until a person or later evidence supports them.
      const row = existing
        ? await tx.opportunityHypothesis.update({ where: { id: existing.id }, data: { ...fields, ...(existing.status === 'INVALIDATED' || existing.status === 'EXPIRED' ? { status: 'CANDIDATE' as const, generatedAt: ref.now } : {}), version: { increment: 1 } } })
        : await tx.opportunityHypothesis.create({ data: { workspaceId: sctx.workspaceId, companyId: ctx.company.id, key, source: 'AI', status: 'CANDIDATE', generatedAt: ref.now, ...fields } });
      await tx.hypothesisEvidence.createMany({ data: h.evidenceIds.map((evidenceId) => ({ workspaceId: sctx.workspaceId, hypothesisId: row.id, evidenceId })), skipDuplicates: true });
      if (!existing || existing.status === 'INVALIDATED' || existing.status === 'EXPIRED') {
        await writeAudit(tx, sctx, { action: 'hypothesis.proposed', entityType: 'OPPORTUNITY_HYPOTHESIS', entityId: row.id, after: { key, source: 'AI', agentTaskId: ref.taskId, evidenceIds: h.evidenceIds } });
        await recordEvent(tx, sctx, 'OpportunityHypothesisProposed', row.id, { hypothesisId: row.id, companyId: ctx.company.id, key, confidence: h.confidence });
      }
    }
    // Earlier AI suggestions the latest analysis no longer makes are withdrawn (kept, not deleted).
    const stale = await tx.opportunityHypothesis.findMany({ where: { workspaceId: sctx.workspaceId, companyId: ctx.company.id, source: 'AI', status: 'CANDIDATE', key: { notIn: keys } } });
    for (const h of stale) {
      await tx.opportunityHypothesis.update({ where: { id: h.id }, data: { status: 'INVALIDATED', version: { increment: 1 } } });
      await recordEvent(tx, sctx, 'OpportunityHypothesisInvalidated', h.id, { hypothesisId: h.id, companyId: ctx.company.id, key: h.key, reason: 'Not proposed again by the latest analysis' });
    }
    const confidences = out.hypotheses.map((h) => h.confidence);
    return {
      decision: 'PROPOSE',
      actionType: 'PROPOSE_HYPOTHESES',
      confidence: confidences.includes('HIGH') ? 'HIGH' : confidences.includes('MEDIUM') ? 'MEDIUM' : out.hypotheses.length ? 'LOW' : null,
      risk: 'LOW',
      reasonSummary: out.summary,
      evidenceRefs: [...new Set([...out.observations, ...out.hypotheses].flatMap((x) => x.evidenceIds))],
      uncertainties: out.uncertainties,
    };
  },
};

function input(ctx: CompanyContext) {
  return {
    company: { name: ctx.company.name, industry: ctx.company.industry, city: ctx.company.city, website: ctx.company.website },
    website: ctx.website,
    checks: ctx.audit?.findings.map((f) => ({ check: f.key, label: f.label, observed: f.observed, detail: f.detail, evidenceIds: f.evidenceIds })) ?? [],
    technologies: ctx.audit?.technologies ?? [],
    existingHypotheses: ctx.hypotheses.filter((h) => h.source === 'RULE').map((h) => h.hypothesis),
    evidence: evidenceIndex(ctx),
  };
}
