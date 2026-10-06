import { Injectable } from '@nestjs/common';
import { agentDefinition, AGENTS, capabilityFor, PROMPTS, TOOLS } from '@revenue-os/ai';
import type { AgentType } from '@revenue-os/database';
import { recordEvent } from '@revenue-os/events';
import { writeAudit, type ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';

const startOfDay = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/**
 * AI agents for the AI Control Center (Phase 9 slice of screen #17): what each agent may do, what it spent today, and
 * its latest decisions. Turning an agent off or capping its runs is audited; autonomy levels and the kill switch
 * arrive with the Policy Engine (Phase 10).
 */
@Injectable()
export class AiService {
  constructor(private readonly prisma: PrismaService) {}

  async agents(workspaceId: string) {
    const db = this.prisma.client;
    const types = Object.keys(AGENTS) as AgentType[];
    const defs = await Promise.all(types.map((t) => agentDefinition(db, workspaceId, t)));
    const today = startOfDay();
    const [runs, tasks, models, decisions] = await Promise.all([
      db.aiRun.groupBy({ by: ['agentType', 'status'], where: { workspaceId, startedAt: { gte: today } }, _count: true, _sum: { inputTokens: true, outputTokens: true, costMinor: true } }),
      db.agentTask.groupBy({ by: ['agentType', 'status'], where: { workspaceId, createdAt: { gte: today } }, _count: true }),
      db.integration.findMany({ where: { workspaceId, category: 'AI', status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] } }, select: { provider: true, name: true, capabilities: true } }),
      db.aiDecision.findMany({ where: { workspaceId }, orderBy: { createdAt: 'desc' }, take: 25 }),
    ]);
    const companies = await db.company.findMany({ where: { workspaceId, id: { in: [...new Set(decisions.map((d) => d.entityId))] } }, select: { id: true, displayName: true } });
    return {
      models: models.map((m) => ({ provider: m.provider, name: m.name, capabilities: m.capabilities })),
      agents: defs.map((d) => {
        const r = runs.filter((x) => x.agentType === d.agentType);
        const t = tasks.filter((x) => x.agentType === d.agentType);
        const prompt = PROMPTS.find((p) => p.agentType === d.agentType);
        const count = (rows: { _count: number; status: string }[], ...statuses: string[]) => rows.filter((x) => !statuses.length || statuses.includes(x.status)).reduce((n, x) => n + x._count, 0);
        const costs = r.map((x) => x._sum.costMinor);
        return {
          agentType: d.agentType,
          label: AGENTS[d.agentType].label,
          purpose: AGENTS[d.agentType].purpose,
          version: d.version,
          enabled: d.enabled,
          modelClass: d.modelClass,
          capability: capabilityFor(d.modelClass),
          modelConnected: models.some((m) => m.capabilities.includes(capabilityFor(d.modelClass))),
          allowedTools: d.allowedTools.map((key) => ({ key, ...(TOOLS[key as keyof typeof TOOLS] ?? { category: 'UNKNOWN', description: key }) })),
          dailyRunLimit: d.dailyRunLimit,
          dailyCostLimitMinor: d.dailyCostLimitMinor,
          prompt: prompt ? { taskType: prompt.taskType, version: prompt.version } : null,
          today: {
            runs: count(r),
            rejected: count(r, 'REJECTED'),
            failedRuns: count(r, 'FAILED'),
            tasksCompleted: count(t, 'COMPLETED'),
            tasksBlocked: count(t, 'BLOCKED'),
            tasksFailed: count(t, 'FAILED'),
            tokens: r.reduce((n, x) => n + (x._sum.inputTokens ?? 0) + (x._sum.outputTokens ?? 0), 0),
            // Unknown cost stays unknown (null) — never shown as zero.
            costMinor: costs.length && costs.every((c) => c !== null) ? costs.reduce((n, c) => n + (c ?? 0), 0) : null,
          },
        };
      }),
      decisions: decisions.map((d) => ({
        id: d.id,
        agentType: d.agentType,
        actionType: d.actionType,
        decision: d.decision,
        confidence: d.confidence,
        reasonSummary: d.reasonSummary,
        model: d.model,
        promptVersion: d.promptVersion,
        passed: (d.validation as { ok: boolean }[]).every((v) => v.ok),
        entity: { type: d.entityType, id: d.entityId, name: companies.find((c) => c.id === d.entityId)?.displayName ?? null },
        createdAt: d.createdAt,
      })),
    };
  }

  async update(ctx: ServiceContext, agentType: AgentType, input: { enabled?: boolean; dailyRunLimit?: number | null }) {
    return this.prisma.client.$transaction(async (tx) => {
      const before = await agentDefinition(tx, ctx.workspaceId, agentType);
      const after = await tx.agentDefinition.update({ where: { id: before.id }, data: { ...input } });
      await writeAudit(tx, ctx, { action: 'agent.updated', entityType: 'WORKSPACE', entityId: ctx.workspaceId, before: { agentType, enabled: before.enabled, dailyRunLimit: before.dailyRunLimit }, after: { agentType, enabled: after.enabled, dailyRunLimit: after.dailyRunLimit } });
      await recordEvent(tx, ctx, 'AgentDefinitionUpdated', ctx.workspaceId, { agentType, changedFields: Object.keys(input) });
      return { agentType, enabled: after.enabled, dailyRunLimit: after.dailyRunLimit };
    });
  }
}
