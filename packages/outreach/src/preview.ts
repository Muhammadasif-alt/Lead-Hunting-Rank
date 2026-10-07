import { buildCompanyContext, campaignAgent, runAgentTask, type DraftContext } from '@revenue-os/ai';
import type { ServiceContext } from '@revenue-os/domain';
import { buildPolicyContext, evaluate } from '@revenue-os/policy';
import { NotFoundError } from '@revenue-os/shared';
import { findAudience, parseAudience } from './audience.js';
import type { CampaignStrategy } from './campaigns.js';
import { OPT_OUT_LINE, type OutreachDeps } from './engine.js';

/**
 * Dry run (screen #6 §11, §36): the real Campaign Agent drafts first emails for a few eligible prospects, the validators
 * check them, and the Policy Engine says what it would decide — nothing is sent, queued or recorded as a decision.
 */
export async function previewDrafts(deps: OutreachDeps, ctx: ServiceContext, campaignId: string, count = 3) {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const c = await db.campaign.findFirst({ where: { id: campaignId, workspaceId: ctx.workspaceId }, include: { steps: { orderBy: { position: 'asc' } } } });
  if (!c) throw new NotFoundError('Campaign not found');
  const mailbox = c.mailboxIntegrationId ? await db.integration.findFirst({ where: { id: c.mailboxIntegrationId, workspaceId: ctx.workspaceId } }) : null;
  const { eligible } = await findAudience(db, ctx.workspaceId, parseAudience(c.audience), { campaignId: c.id, limit: Math.min(Math.max(count, 1), 5), now });
  const strategy = (c.strategy ?? {}) as CampaignStrategy;
  const step = c.steps.find((s) => s.position === 1);
  const results = [];
  for (const cand of eligible) {
    const base = await buildCompanyContext(db, ctx.workspaceId, cand.companyId, now);
    const dctx: DraftContext = {
      ...base,
      campaign: { name: c.name, objective: c.objective, offer: c.offer, cta: strategy.cta ?? null, tone: strategy.tone ?? null, avoid: strategy.avoid ?? [], senderName: c.senderName },
      recipient: { firstName: cand.firstName, name: cand.name, title: cand.title, email: cand.email },
      step: { position: 1, kind: 'FIRST_TOUCH', angle: step?.angle ?? 'FIRST_TOUCH', total: c.steps.length },
      previous: [],
    };
    // Keyed by campaign version: editing the campaign gives fresh previews; asking again reuses them.
    const r = await runAgentTask({ db, providers: deps.providers, now: deps.now }, campaignAgent, dctx, `preview:${c.id}:v${c.version}:${cand.companyId}`);
    const task = r.taskId ? await db.agentTask.findUnique({ where: { id: r.taskId } }) : null;
    const decision = task ? await db.aiDecision.findFirst({ where: { agentTaskId: task.id }, orderBy: { createdAt: 'desc' } }) : null;
    const out = task?.status === 'COMPLETED' ? (task.output as { subject: string; body: string; claims: { text: string; evidenceIds: string[] }[]; confidence: string }) : null;
    let policy = null;
    if (out) {
      const payload = { from: mailbox?.accountRef.includes('@') ? mailbox.accountRef : 'outreach@test-mailbox.example', to: [cand.email], subject: out.subject, text: out.body };
      const req = { stage: 'PREPARE' as const, actionType: 'email.send', actor: { type: 'AI_AGENT' as const, id: null, agentType: 'CAMPAIGN' }, entity: { type: 'PERSON' as const, id: cand.personId }, payload };
      const p = evaluate(req, await buildPolicyContext(db, ctx.workspaceId, req, now));
      policy = { decision: p.decision, reasonCodes: p.reasonCodes, reasonSummary: p.reasonSummary };
    }
    results.push({
      company: { id: cand.companyId, name: cand.companyName },
      recipient: { name: cand.name, title: cand.title, email: cand.email },
      status: task?.status ?? r.status,
      reason: out ? null : (task?.reasonSummary ?? r.detail ?? null),
      subject: out?.subject ?? null,
      body: out ? `${out.body.trim()}\n\n${c.senderName || mailbox?.name || ''}\n\n${OPT_OUT_LINE}` : null,
      claims: out?.claims ?? [],
      confidence: out?.confidence ?? null,
      validation: (decision?.validation ?? []) as { validator: string; ok: boolean; detail: string }[],
      policy,
    });
  }
  return { drafts: results, eligible: eligible.length };
}
