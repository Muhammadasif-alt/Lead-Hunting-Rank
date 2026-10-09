import { createHash, randomUUID } from 'node:crypto';
import type { AgentDefinition, AgentTask, AiFailureCategory, PrismaClient } from '@revenue-os/database';
import { writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import type { ProviderErrorKind, ProviderGateway } from '@revenue-os/providers';
import { describeError, RateLimitedError } from '@revenue-os/shared';
import { z } from 'zod';
import type { AgentOutcome, AgentSpec } from './agent.js';
import { campaignAgent } from './agents/campaign.js';
import { contactAgent } from './agents/contact.js';
import { conversationAgent } from './agents/conversation.js';
import { inboxAgent } from './agents/inbox.js';
import { researchAgent } from './agents/research.js';
import { scoringAgent } from './agents/scoring.js';
import { webAuditAgent } from './agents/web-audit.js';
import { buildCompanyContext, type CompanyContext } from './context.js';
import { renderPrompt, type PromptTemplate } from './prompts.js';
import { agentDefinition, capabilityFor, ToolNotAllowedError, TOOLSET_VERSION } from './registry.js';
import { blockingFailures, type ValidationResult } from './validators.js';

/** The agents in the order they run for a company: plan → interpret the website → contact route → assess. */
export const COMPANY_AGENTS: AgentSpec<any, any>[] = [researchAgent, webAuditAgent, contactAgent, scoringAgent];
export const PROMPTS: PromptTemplate[] = [...COMPANY_AGENTS, campaignAgent, inboxAgent, conversationAgent].map((a) => a.prompt);

export interface AiDeps {
  db: PrismaClient;
  providers: ProviderGateway;
  now?: () => Date;
}

export interface TaskResult {
  agentType: string;
  taskId: string | null;
  status: AgentTask['status'] | 'SKIPPED';
  detail?: string;
}

const WAIT_KINDS: ReadonlySet<ProviderErrorKind> = new Set(['RATE_LIMITED', 'QUOTA_EXCEEDED', 'UNAVAILABLE', 'TRANSIENT', 'UNKNOWN_OUTCOME']);
const TERMINAL: AgentTask['status'][] = ['COMPLETED', 'PARTIAL', 'BLOCKED', 'FAILED', 'CANCELLED'];
const TX = { timeout: 30_000, maxWait: 10_000 } as const;
const system = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'AI_AGENT', id: null } });
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Runs a company's agents (docs/17 §58-61): AgentTask → Context Builder → AI Gateway → structured answer → validators →
 * typed tools → AIDecision. Each agent's failure is contained — the next one still runs. Idempotent per input key: a
 * retried job skips the agents that already finished.
 */
export async function runCompanyIntelligence(deps: AiDeps, job: { workspaceId: string; companyId: string; inputKey: string }): Promise<{ skipped?: string; tasks: TaskResult[] }> {
  const company = await deps.db.company.findFirst({ where: { id: job.companyId, workspaceId: job.workspaceId }, select: { status: true, mergedIntoId: true } });
  if (!company) return { skipped: 'NOT_FOUND', tasks: [] };
  if (company.mergedIntoId || company.status === 'ARCHIVED') return { skipped: 'INACTIVE', tasks: [] };

  const now = () => deps.now?.() ?? new Date();
  const tasks: TaskResult[] = [];
  let ctx = await buildCompanyContext(deps.db, job.workspaceId, job.companyId, now());
  for (const spec of COMPANY_AGENTS) {
    // Scoring sees what the agents before it proposed (e.g. new AI hypotheses).
    if (spec.type === 'SCORING') ctx = await buildCompanyContext(deps.db, job.workspaceId, job.companyId, now());
    tasks.push(await runAgentTask(deps, spec, ctx, job.inputKey));
  }
  return { tasks };
}

/** AI Gateway for one task (docs/08 §64-68): enabled? budget? model? → call → validate → apply through tools → record. */
export async function runAgentTask(deps: AiDeps, spec: AgentSpec<any, any>, ctx: CompanyContext, inputKey: string): Promise<TaskResult> {
  const { db } = deps;
  const now = () => deps.now?.() ?? new Date();
  const { workspaceId } = ctx;
  const sctx = system(workspaceId);
  const scope = { workspaceId, agentType: spec.type, taskType: spec.taskType, inputKey };

  let task = await db.agentTask.findUnique({ where: { workspaceId_agentType_taskType_inputKey: scope } });
  if (task && TERMINAL.includes(task.status)) return { agentType: spec.type, taskId: task.id, status: 'SKIPPED', detail: 'Already done for this input' };
  if (!task) {
    task = await db.agentTask.create({
      data: { ...scope, entityType: 'COMPANY', entityId: ctx.company.id, objective: spec.objective(ctx), status: 'PENDING', inputRefs: { companyId: ctx.company.id, evidence: ctx.evidence.length } },
    });
  }

  const skip = spec.skipReason(ctx);
  if (skip) {
    await db.agentTask.update({ where: { id: task.id }, data: { status: 'CANCELLED', reasonSummary: `Skipped: ${skip}`, completedAt: now() } });
    return { agentType: spec.type, taskId: task.id, status: 'CANCELLED', detail: skip };
  }

  const def = await agentDefinition(db, workspaceId, spec.type);
  const blocked = await whyBlocked(db, def, workspaceId, now());
  if (blocked) return settle(deps, task, sctx, ctx, spec, { status: 'BLOCKED', category: blocked.category, reason: blocked.reason, decision: 'WAIT' });

  await db.agentTask.update({ where: { id: task.id }, data: { status: 'RUNNING', attempts: { increment: 1 }, startedAt: task.startedAt ?? now() } });
  const input = spec.input(ctx);
  const prompt = renderPrompt(spec.prompt, input, spec.type === 'WEB_AUDIT' ? ctx.untrusted : []);
  const inputHash = createHash('sha256').update(spec.prompt.system + prompt).digest('hex');
  const startedAt = now();
  const t0 = performance.now();
  const runBase = { workspaceId, agentTaskId: task.id, agentType: spec.type, modelClass: def.modelClass, promptVersion: spec.prompt.version, toolsetVersion: TOOLSET_VERSION, schemaName: spec.prompt.schemaName, inputHash, startedAt };

  let result;
  try {
    result = await deps.providers.call(
      { workspaceId, capability: capabilityFor(def.modelClass), operation: `agent.${spec.type.toLowerCase()}`, entity: { type: 'COMPANY', id: ctx.company.id }, timeoutMs: def.timeoutMs },
      (adapter, options) =>
        adapter.generateStructured(
          {
            modelClass: def.modelClass as 'FAST' | 'STANDARD' | 'REASONING' | 'EXTRACTION',
            system: spec.prompt.system,
            prompt,
            schema: spec.schema,
            schemaName: spec.prompt.schemaName,
            jsonSchema: z.toJSONSchema(spec.schema) as Record<string, unknown>,
            simulated: () => spec.simulate(input, ctx),
            maxOutputTokens: 2048,
          },
          options,
        ),
    );
  } catch (err) {
    const kind = (err as { providerErrorKind?: ProviderErrorKind }).providerErrorKind;
    if (!kind) throw err;
    const category: AiFailureCategory = kind === 'PERMANENT' ? 'MODEL_FAILURE' : 'PROVIDER_FAILURE';
    await db.aiRun.create({ data: { ...runBase, status: 'FAILED', error: describeError(err).slice(0, 500), failureCategory: category, latencyMs: Math.round(performance.now() - t0), completedAt: now() } });
    if (WAIT_KINDS.has(kind)) {
      // "Not now": the job retries with backoff and this task continues (it is not terminal).
      await db.agentTask.update({ where: { id: task.id }, data: { status: 'WAITING_TOOL', error: describeError(err).slice(0, 500) } });
      throw new RateLimitedError(`${spec.type}: ${describeError(err)}`, (err as { retryAfterMs?: number }).retryAfterMs);
    }
    const auth = kind === 'AUTH_REQUIRED' || kind === 'PERMISSION_DENIED';
    return settle(deps, task, sctx, ctx, spec, { status: auth ? 'BLOCKED' : 'FAILED', category, reason: describeError(err), decision: auth ? 'WAIT' : 'BLOCK' });
  }

  const output = result.value.data;
  const usage = { provider: result.provider, model: result.value.model, inputTokens: result.value.inputTokens, outputTokens: result.value.outputTokens, costMinor: result.value.costMinor ?? null, costIsEstimate: result.value.costIsEstimate ?? true, latencyMs: Math.round(performance.now() - t0) };
  const validation = spec.validate(output, ctx);
  const failures = blockingFailures(validation);
  if (failures.length) {
    const run = await db.aiRun.create({ data: { ...runBase, ...usage, status: 'REJECTED', output: output as object, error: failures.map((f) => f.detail).join('; ').slice(0, 500), failureCategory: 'VALIDATION_FAILURE', completedAt: now() } });
    return settle(deps, task, sctx, ctx, spec, { status: 'FAILED', category: 'VALIDATION_FAILURE', reason: `The answer was rejected: ${failures[0]!.detail}`, decision: 'BLOCK', runId: run.id, model: usage.model, validation });
  }

  try {
    return await db.$transaction(async (tx) => {
      const run = await tx.aiRun.create({ data: { ...runBase, ...usage, status: 'SUCCEEDED', output: output as object, completedAt: now() } });
      const outcome = await spec.apply(tx, sctx, output, ctx, { def, taskId: task!.id, runId: run.id, now: now() });
      await record(tx, sctx, task!, ctx, spec, outcome, { runId: run.id, model: usage.model, validation });
      await tx.agentTask.update({
        where: { id: task!.id },
        data: { status: 'COMPLETED', output: output as object, confidence: outcome.confidence, uncertainties: outcome.uncertainties ?? [], reasonSummary: outcome.reasonSummary.slice(0, 1000), failureCategory: null, error: null, completedAt: now() },
      });
      await recordEvent(tx, sctx, 'AgentTaskCompleted', task!.id, { agentTaskId: task!.id, agentType: spec.type, entityType: 'COMPANY', entityId: ctx.company.id, decision: outcome.decision });
      return { agentType: spec.type, taskId: task!.id, status: 'COMPLETED' as const };
    }, TX);
  } catch (err) {
    if (!(err instanceof ToolNotAllowedError)) throw err;
    // Least privilege held: the answer needed a tool this agent may not use, so nothing was applied.
    const run = await db.aiRun.create({ data: { ...runBase, ...usage, status: 'REJECTED', output: output as object, error: err.message, failureCategory: 'POLICY_BLOCK', completedAt: now() } });
    return settle(deps, task, sctx, ctx, spec, { status: 'BLOCKED', category: 'POLICY_BLOCK', reason: err.message, decision: 'BLOCK', runId: run.id, model: usage.model, validation });
  }
}

/** Disabled agent, spent budget or no model connected → the task waits; nothing is silently overspent (docs/08 §87-90). */
async function whyBlocked(db: PrismaClient, def: AgentDefinition, workspaceId: string, now: Date): Promise<{ category: AiFailureCategory; reason: string } | null> {
  if (!def.enabled) return { category: 'POLICY_BLOCK', reason: `${def.agentType} is turned off for this workspace` };
  const today = { workspaceId, agentType: def.agentType, startedAt: { gte: startOfDay(now) } };
  if (def.dailyRunLimit !== null && (await db.aiRun.count({ where: today })) >= def.dailyRunLimit) {
    return { category: 'BUDGET_BLOCK', reason: `Daily limit of ${def.dailyRunLimit} runs reached for ${def.agentType}` };
  }
  if (def.dailyCostLimitMinor !== null) {
    const spent = (await db.aiRun.aggregate({ where: today, _sum: { costMinor: true } }))._sum.costMinor ?? 0;
    if (spent >= def.dailyCostLimitMinor) return { category: 'BUDGET_BLOCK', reason: `Daily AI budget reached for ${def.agentType}` };
  }
  const capability = capabilityFor(def.modelClass);
  const models = await db.integration.count({ where: { workspaceId, capabilities: { has: capability }, status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] } } });
  if (!models) return { category: 'PROVIDER_FAILURE', reason: 'No AI model connected — connect one in Integrations' };
  return null;
}

async function record(tx: Tx, sctx: ServiceContext, task: AgentTask, ctx: CompanyContext, spec: AgentSpec, outcome: AgentOutcome, ref: { runId?: string; model?: string; validation?: ValidationResult[] }) {
  const decision = await tx.aiDecision.create({
    data: {
      workspaceId: sctx.workspaceId,
      agentTaskId: task.id,
      aiRunId: ref.runId ?? null,
      agentType: spec.type,
      actionType: outcome.actionType,
      entityType: 'COMPANY',
      entityId: ctx.company.id,
      decision: outcome.decision,
      confidence: outcome.confidence,
      risk: outcome.risk,
      reasonSummary: outcome.reasonSummary.slice(0, 1000),
      evidenceRefs: outcome.evidenceRefs,
      promptVersion: spec.prompt.version,
      model: ref.model ?? null,
      validation: (ref.validation ?? []) as object[],
    },
  });
  await writeAudit(tx, sctx, { action: `ai.${outcome.decision.toLowerCase()}`, entityType: 'AI_DECISION', entityId: decision.id, after: { agentType: spec.type, actionType: outcome.actionType, companyId: ctx.company.id, agentTaskId: task.id } });
}

/** A task that ends without an applied answer still leaves a decision saying why. */
async function settle(
  deps: AiDeps,
  task: AgentTask,
  sctx: ServiceContext,
  ctx: CompanyContext,
  spec: AgentSpec,
  r: { status: 'BLOCKED' | 'FAILED'; category: AiFailureCategory; reason: string; decision: 'WAIT' | 'BLOCK'; runId?: string; model?: string; validation?: ValidationResult[] },
): Promise<TaskResult> {
  const reason = r.reason.slice(0, 500);
  await deps.db.$transaction(async (tx) => {
    await tx.agentTask.update({ where: { id: task.id }, data: { status: r.status, failureCategory: r.category, error: reason, reasonSummary: reason, completedAt: deps.now?.() ?? new Date() } });
    await record(tx, sctx, task, ctx, spec, { decision: r.decision, actionType: spec.taskType, confidence: null, risk: 'LOW', reasonSummary: reason, evidenceRefs: [] }, r);
    const payload = { agentTaskId: task.id, agentType: spec.type, entityType: 'COMPANY', entityId: ctx.company.id, category: r.category, reason };
    await recordEvent(tx, sctx, r.status === 'BLOCKED' ? 'AgentTaskBlocked' : 'AgentTaskFailed', task.id, payload);
  }, TX);
  return { agentType: spec.type, taskId: task.id, status: r.status, detail: reason };
}

/** "Assess again": a person asks for a fresh pass; the event schedules the job (outbox, same transaction). */
export async function requestCompanyIntelligenceTx(tx: Tx, ctx: ServiceContext, companyId: string): Promise<{ requestId: string }> {
  const requestId = randomUUID();
  await writeAudit(tx, ctx, { action: 'ai.assessment_requested', entityType: 'COMPANY', entityId: companyId, after: { requestId } });
  await recordEvent(tx, ctx, 'CompanyIntelligenceRequested', companyId, { companyId, requestId });
  return { requestId };
}
