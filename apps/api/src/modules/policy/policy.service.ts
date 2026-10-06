import { Injectable } from '@nestjs/common';
import type { ApprovalStatus, PolicyDecision, Prisma, SuppressionScope, SuppressionStatus } from '@revenue-os/database';
import {
  addSuppression,
  decideApproval,
  liftSuppression,
  loadPolicySettings,
  setOutboundState,
  simulatePolicy,
  updatePolicy,
  type PolicyDraft,
} from '@revenue-os/policy';
import { HARD_RULE_INFO, normalizeSuppressionValue, type AutonomyLevel, type OutboundState, type PolicySettings, type SuppressionReason } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';

const DAY_MS = 24 * 3_600_000;

/**
 * Policy Engine administration (Phase 10, screen #17): kill switch, autonomy, configurable rules, simulator, approvals
 * and the do-not-contact list. Decisions themselves are made in @revenue-os/policy, never here and never by the client.
 */
@Injectable()
export class PolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async outbound(workspaceId: string) {
    const ws = await this.prisma.client.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { outboundState: true, outboundReason: true, outboundChangedAt: true, outboundChangedBy: true } });
    const by = ws.outboundChangedBy ? await this.prisma.client.user.findUnique({ where: { id: ws.outboundChangedBy }, select: { name: true } }) : null;
    return { state: ws.outboundState, reason: ws.outboundReason, changedAt: ws.outboundChangedAt, changedBy: by?.name ?? null };
  }

  async overview(workspaceId: string) {
    const db = this.prisma.client;
    const since = new Date(Date.now() - 7 * DAY_MS);
    const [ws, rules, outbound, hard, counts, decisions, pendingApprovals, activeSuppressions] = await Promise.all([
      db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { autonomyLevel: true, defaultTimezone: true } }),
      loadPolicySettings(db, workspaceId),
      this.outbound(workspaceId),
      db.policyRule.findMany({ where: { workspaceId, isHardRule: true }, select: { ruleType: true, description: true } }),
      db.policyDecision.groupBy({ by: ['decision'], where: { workspaceId, evaluatedAt: { gte: since } }, _count: true }),
      db.policyDecision.findMany({ where: { workspaceId }, orderBy: { evaluatedAt: 'desc' }, take: 30 }),
      db.approvalRequest.count({ where: { workspaceId, status: 'PENDING' } }),
      db.suppression.count({ where: { workspaceId, status: 'ACTIVE' } }),
    ]);
    const hardRules = [...hard.map((r) => ({ key: r.ruleType, description: r.description ?? HARD_RULE_INFO[r.ruleType] ?? r.ruleType }))];
    if (!hardRules.some((r) => r.key === 'DEFAULT_DENY')) hardRules.push({ key: 'DEFAULT_DENY', description: HARD_RULE_INFO.DEFAULT_DENY! });
    return {
      outbound,
      autonomyLevel: ws.autonomyLevel,
      timezone: ws.defaultTimezone,
      policyVersion: rules.version,
      settings: rules.settings,
      hardRules,
      last7Days: Object.fromEntries(['ACT', 'ASK', 'WAIT', 'BLOCK'].map((d) => [d, counts.find((c) => c.decision === d)?._count ?? 0])),
      pendingApprovals,
      activeSuppressions,
      decisions: await this.presentDecisions(workspaceId, decisions),
    };
  }

  private async entityNames(workspaceId: string, refs: { entityType: string; entityId: string }[]) {
    const ids = (type: string) => [...new Set(refs.filter((r) => r.entityType === type).map((r) => r.entityId))];
    const [companies, people] = await Promise.all([
      this.prisma.client.company.findMany({ where: { workspaceId, id: { in: ids('COMPANY') } }, select: { id: true, displayName: true } }),
      this.prisma.client.person.findMany({ where: { workspaceId, id: { in: ids('PERSON') } }, select: { id: true, fullName: true } }),
    ]);
    const names = new Map<string, string>([...companies.map((c) => [c.id, c.displayName] as const), ...people.map((p) => [p.id, p.fullName] as const)]);
    return (type: string, id: string) => ({ type, id, name: names.get(id) ?? null });
  }

  private async presentDecisions(workspaceId: string, rows: PolicyDecision[]) {
    const name = await this.entityNames(workspaceId, rows);
    return rows.map((d) => ({
      id: d.id,
      stage: d.stage,
      actionType: d.actionType,
      actor: { type: d.actorType, id: d.actorId, agentType: d.agentType },
      entity: name(d.entityType, d.entityId),
      externalActionId: d.externalActionId,
      decision: d.decision,
      reasonCodes: d.reasonCodes,
      reasonSummary: d.reasonSummary,
      matchedRules: d.matchedRules,
      policyVersion: d.policyVersion,
      riskLevel: d.riskLevel,
      resumeAt: d.resumeAt,
      evaluatedAt: d.evaluatedAt,
    }));
  }

  async setOutbound(ctx: ServiceContext, permissions: ReadonlySet<string>, state: OutboundState, reason: string | null) {
    await this.prisma.client.$transaction((tx) => setOutboundState(tx, ctx, permissions, state, reason));
    return this.outbound(ctx.workspaceId);
  }

  async update(ctx: ServiceContext, input: { autonomyLevel?: AutonomyLevel; settings?: PolicySettings }) {
    return this.prisma.client.$transaction((tx) => updatePolicy(tx, ctx, input));
  }

  simulate(workspaceId: string, draft: Partial<PolicyDraft>) {
    return simulatePolicy(this.prisma.client, workspaceId, draft);
  }

  // ── approvals ──

  async approvals(workspaceId: string, status: ApprovalStatus | 'ALL') {
    const rows = await this.prisma.client.approvalRequest.findMany({
      where: { workspaceId, ...(status === 'ALL' ? {} : { status }) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    const name = await this.entityNames(workspaceId, rows);
    const userIds = [...new Set(rows.flatMap((r) => [r.decidedById, r.requestedByType === 'HUMAN' ? r.requestedById : null]).filter((x): x is string => !!x))];
    const users = await this.prisma.client.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
    const userName = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? null) : null);
    return rows.map((r) => {
      const p = (r.payloadSnapshot ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        status: r.status,
        actionType: r.actionType,
        entity: name(r.entityType, r.entityId),
        requestedBy: { type: r.requestedByType, agentType: r.requestedByAgent, name: r.requestedByType === 'HUMAN' ? userName(r.requestedById) : null },
        // What exactly would be sent — the frozen payload, so the approver sees the real thing.
        preview: { to: Array.isArray(p.to) ? p.to : [], subject: typeof p.subject === 'string' ? p.subject : null, text: typeof p.text === 'string' ? p.text.slice(0, 2000) : null },
        reasonCodes: r.reasonCodes,
        reason: r.reason,
        riskLevel: r.riskLevel,
        expiresAt: r.expiresAt,
        decidedBy: userName(r.decidedById),
        decidedAt: r.decidedAt,
        decisionNote: r.decisionNote,
        createdAt: r.createdAt,
      };
    });
  }

  async decide(ctx: ServiceContext, approvalId: string, decision: 'APPROVE' | 'REJECT', note?: string) {
    return { outcome: await decideApproval(this.prisma.client, ctx, approvalId, decision, note) };
  }

  // ── suppression ──

  async suppressions(workspaceId: string, q: { status: SuppressionStatus | 'ALL'; scope?: SuppressionScope; value?: string; search?: string }) {
    const where: Prisma.SuppressionWhereInput = { workspaceId, ...(q.status === 'ALL' ? {} : { status: q.status }) };
    if (q.scope) where.scope = q.scope;
    if (q.scope && q.value) where.value = normalizeSuppressionValue(q.scope, q.value) ?? q.value;
    if (q.search) where.value = { contains: q.search.trim().toLowerCase() };
    const rows = await this.prisma.client.suppression.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const name = await this.entityNames(
      workspaceId,
      rows.filter((r) => r.scope === 'COMPANY' || r.scope === 'PERSON').map((r) => ({ entityType: r.scope, entityId: r.value })),
    );
    return rows.map((r) => ({
      id: r.id,
      scope: r.scope,
      value: r.value,
      label: r.scope === 'COMPANY' || r.scope === 'PERSON' ? (name(r.scope, r.value).name ?? r.value) : r.value,
      reason: r.reason,
      status: r.status,
      note: r.note,
      source: r.source,
      createdByType: r.createdByType,
      createdAt: r.createdAt,
      liftedAt: r.liftedAt,
      liftReason: r.liftReason,
    }));
  }

  async suppress(ctx: ServiceContext, input: { scope: SuppressionScope; value: string; reason: SuppressionReason; note?: string | null }) {
    const r = await this.prisma.client.$transaction((tx) => addSuppression(tx, ctx, input));
    return { id: r.suppression.id, created: r.created, cancelledActions: r.cancelledActions };
  }

  lift(ctx: ServiceContext, id: string, reason: string) {
    return this.prisma.client.$transaction((tx) => liftSuppression(tx, ctx, id, reason));
  }
}
