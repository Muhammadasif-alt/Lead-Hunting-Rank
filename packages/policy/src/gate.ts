import type { ExternalAction, ExternalActionStatus, Prisma, PrismaClient } from '@revenue-os/database';
import { writeAudit, type ServiceContext } from '@revenue-os/domain';
import { prepareExternalAction, queueExternalAction, recordEvent, type PrepareInput, type Revalidator, type Tx } from '@revenue-os/events';
import { BusinessRuleError, ConflictError, describeError, ForbiddenError, NotFoundError, POLICY_REASONS } from '@revenue-os/shared';
import { actionDefinition } from './actions.js';
import { actionFingerprint, buildPolicyContext, contextHash } from './context.js';
import { evaluate } from './engine.js';
import type { PolicyContext, PolicyRequest, PolicyResult, PolicyStage } from './types.js';

type Db = PrismaClient | Prisma.TransactionClient;

export interface Evaluation {
  result: PolicyResult;
  context: PolicyContext | null;
  decisionId: string;
}

/** Fail closed (docs/10 §92-94): a policy that cannot be checked allows nothing. */
const FAILED = (reason: string): PolicyResult => ({
  decision: 'BLOCK',
  reasonCodes: ['POLICY_EVALUATION_FAILED'],
  reasonSummary: `${POLICY_REASONS.POLICY_EVALUATION_FAILED}: ${reason}`.slice(0, 500),
  matchedRules: ['DEFAULT_DENY'],
  riskLevel: 'HIGH',
  resumeAt: null,
  requiredApproval: null,
});

/** Builds the context, decides, and stores the decision (append-only). Never throws for a policy problem. */
export async function evaluateAndRecord(db: Db, workspaceId: string, req: PolicyRequest, now = new Date()): Promise<Evaluation> {
  let context: PolicyContext | null = null;
  let result: PolicyResult;
  try {
    context = await buildPolicyContext(db, workspaceId, req, now);
    result = evaluate(req, context);
  } catch (err) {
    // Inside a caller's transaction a database error aborts it anyway — then nothing is prepared at all.
    result = FAILED(describeError(err));
  }
  const decision = await db.policyDecision.create({
    data: {
      workspaceId,
      stage: req.stage,
      actionType: req.actionType,
      actionClass: actionDefinition(req.actionType)?.class ?? 'E',
      actorType: req.actor.type,
      actorId: req.actor.id,
      agentType: req.actor.agentType ?? null,
      entityType: req.entity.type,
      entityId: req.entity.id,
      externalActionId: req.externalActionId ?? null,
      decision: result.decision,
      reasonCodes: result.reasonCodes,
      reasonSummary: result.reasonSummary,
      matchedRules: result.matchedRules,
      policyVersion: context?.policyVersion ?? 0,
      riskLevel: result.riskLevel,
      resumeAt: result.resumeAt ? new Date(result.resumeAt) : null,
      fingerprint: context?.fingerprint ?? actionFingerprint(req),
      contextHash: context ? contextHash(context) : '',
      input: { request: req, context } as unknown as Prisma.InputJsonValue,
    },
  });
  return { result, context, decisionId: decision.id };
}

function requestFor(action: Pick<ExternalAction, 'id' | 'actionType' | 'entityType' | 'entityId' | 'payload' | 'requestedByType' | 'requestedById' | 'requestedByAgent'>, stage: PolicyStage): PolicyRequest {
  return {
    stage,
    actionType: action.actionType,
    actor: { type: action.requestedByType, id: action.requestedById, agentType: action.requestedByAgent },
    entity: { type: action.entityType, id: action.entityId },
    externalActionId: action.id,
    payload: (action.payload ?? {}) as Record<string, unknown>,
  };
}

/** Conditional status change: only if the row is still in one of `from`. */
async function move(tx: Tx, action: Pick<ExternalAction, 'id' | 'workspaceId'>, from: ExternalActionStatus[], to: ExternalActionStatus, data: Prisma.ExternalActionUpdateManyMutationInput = {}) {
  const { count } = await tx.externalAction.updateMany({ where: { id: action.id, workspaceId: action.workspaceId, status: { in: from } }, data: { ...data, status: to, version: { increment: 1 } } });
  return count === 1;
}

/** Applies a decision to an action that is PREPARED or APPROVED: queue, ask, wait or block — with its event. */
async function apply(tx: Tx, ctx: ServiceContext, action: ExternalAction, ev: Evaluation): Promise<string | null> {
  const { result } = ev;
  const base = { externalActionId: action.id, actionType: action.actionType };
  const from: ExternalActionStatus[] = [action.status];
  await tx.externalAction.update({ where: { id: action.id }, data: { policyDecisionId: ev.decisionId } });
  switch (result.decision) {
    case 'ACT':
      await queueExternalAction(tx, ctx, action.id);
      return null;
    case 'ASK': {
      if (action.status !== 'PREPARED') {
        // Asked again after an approval (e.g. it went stale): this action can't run — a fresh request is needed.
        await move(tx, action, from, 'BLOCKED', { statusReason: result.reasonSummary });
        await recordEvent(tx, ctx, 'ExternalActionBlocked', action.id, { ...base, reason: result.reasonSummary });
        return null;
      }
      const expiresAt = new Date(Date.now() + (result.requiredApproval?.ttlHours ?? 24) * 3_600_000);
      const approval = await tx.approvalRequest.create({
        data: {
          workspaceId: action.workspaceId,
          externalActionId: action.id,
          policyDecisionId: ev.decisionId,
          actionType: action.actionType,
          entityType: action.entityType,
          entityId: action.entityId,
          requestedByType: action.requestedByType,
          requestedById: action.requestedById,
          requestedByAgent: action.requestedByAgent,
          payloadSnapshot: action.payload as Prisma.InputJsonValue,
          fingerprint: ev.context?.fingerprint ?? actionFingerprint(requestFor(action, 'PREPARE')),
          riskLevel: result.riskLevel,
          reasonCodes: result.reasonCodes,
          reason: result.reasonSummary,
          requiredPermission: result.requiredApproval?.permission ?? 'approval.decide',
          expiresAt,
        },
      });
      await move(tx, action, from, 'WAITING_APPROVAL', { approvalRequestId: approval.id, statusReason: result.reasonSummary });
      await recordEvent(tx, ctx, 'ApprovalRequested', approval.id, { approvalId: approval.id, externalActionId: action.id, actionType: action.actionType, reasonCodes: result.reasonCodes, expiresAt: expiresAt.toISOString() });
      return approval.id;
    }
    case 'WAIT': {
      // No time given (outbound paused): the sweep looks again once outbound is back on.
      const resumeAt = result.resumeAt ? new Date(result.resumeAt) : new Date();
      await move(tx, action, from, 'WAITING', { statusReason: result.reasonSummary, resumeAt });
      await recordEvent(tx, ctx, 'ExternalActionWaiting', action.id, { ...base, reason: result.reasonSummary });
      return null;
    }
    case 'BLOCK':
      await move(tx, action, from, 'BLOCKED', { statusReason: result.reasonSummary });
      await recordEvent(tx, ctx, 'ExternalActionBlocked', action.id, { ...base, reason: result.reasonSummary });
      return null;
  }
}

/**
 * The one way to ask for an external side effect (docs/10 §130-131): prepare (idempotent) → Policy Engine → queue, ask
 * a person, wait, or block. Asking again with the same idempotency key returns the existing action unchanged.
 */
export async function requestExternalAction(db: PrismaClient, ctx: ServiceContext, input: PrepareInput) {
  return db.$transaction(async (tx) => {
    const { action, created } = await prepareExternalAction(tx, ctx, input);
    if (!created && action.status !== 'PREPARED') return { action, decision: null, approvalId: action.approvalRequestId };
    const ev = await evaluateAndRecord(tx, ctx.workspaceId, requestFor(action, 'PREPARE'));
    const approvalId = await apply(tx, ctx, action, ev);
    return { action: await tx.externalAction.findUniqueOrThrow({ where: { id: action.id } }), decision: ev.result, approvalId };
  });
}

export type ApprovalOutcome = 'QUEUED' | 'WAITING' | 'BLOCKED' | 'REJECTED' | 'EXPIRED' | 'INVALIDATED';

/**
 * A person approves or rejects (docs/10 §76-92). Only a human decides; the first terminal decision wins. An approval is
 * for one exact action: if it changed, or the approval expired, it no longer applies. Approving revalidates at once —
 * approval ≠ execution, and the worker checks everything again right before sending.
 */
export async function decideApproval(db: PrismaClient, ctx: ServiceContext, approvalId: string, decision: 'APPROVE' | 'REJECT', note?: string): Promise<ApprovalOutcome> {
  if (ctx.actor.type !== 'HUMAN' || !ctx.actor.id) throw new ForbiddenError('Only a person can approve or reject');
  return db.$transaction(async (tx) => {
    const approval = await tx.approvalRequest.findFirst({ where: { id: approvalId, workspaceId: ctx.workspaceId } });
    if (!approval) throw new NotFoundError('Approval request not found');
    if (approval.status !== 'PENDING') throw new ConflictError('APPROVAL_ALREADY_RESOLVED', `This request was already ${approval.status.toLowerCase()}`);
    const action = await tx.externalAction.findFirstOrThrow({ where: { id: approval.externalActionId, workspaceId: ctx.workspaceId } });
    const now = new Date();
    const settle = async (status: 'EXPIRED' | 'INVALIDATED' | 'REJECTED' | 'APPROVED', reason: string) => {
      const { count } = await tx.approvalRequest.updateMany({
        where: { id: approval.id, status: 'PENDING' },
        data: { status, decidedById: status === 'APPROVED' || status === 'REJECTED' ? ctx.actor.id : null, decidedAt: now, decisionNote: note ?? (status === 'APPROVED' || status === 'REJECTED' ? null : reason), version: { increment: 1 } },
      });
      if (count !== 1) throw new ConflictError('APPROVAL_ALREADY_RESOLVED', 'This request was already decided');
      await writeAudit(tx, ctx, { action: `approval.${status.toLowerCase()}`, entityType: 'APPROVAL_REQUEST', entityId: approval.id, after: { status, externalActionId: action.id }, reason: note ?? reason });
    };
    const cancel = async (reason: string) => {
      if (await move(tx, action, ['WAITING_APPROVAL'], 'CANCELLED', { statusReason: reason })) {
        await recordEvent(tx, ctx, 'ExternalActionCancelled', action.id, { externalActionId: action.id, actionType: action.actionType, reason });
      }
    };

    if (approval.expiresAt <= now) {
      await settle('EXPIRED', 'Approval expired before anyone decided');
      await cancel('Approval expired');
      await recordEvent(tx, ctx, 'ApprovalExpired', approval.id, { approvalId: approval.id, externalActionId: action.id });
      return 'EXPIRED';
    }
    if (actionFingerprint(requestFor(action, 'APPROVAL')) !== approval.fingerprint || action.status !== 'WAITING_APPROVAL') {
      const reason = action.status !== 'WAITING_APPROVAL' ? `The action is now ${action.status.toLowerCase()}` : 'The action changed after approval was requested';
      await settle('INVALIDATED', reason);
      await cancel(reason);
      await recordEvent(tx, ctx, 'ApprovalInvalidated', approval.id, { approvalId: approval.id, externalActionId: action.id, reason });
      return 'INVALIDATED';
    }
    if (decision === 'REJECT') {
      await settle('REJECTED', 'Rejected');
      await cancel(note ? `Rejected: ${note}` : 'Rejected by a person');
      await recordEvent(tx, ctx, 'ApprovalRejected', approval.id, { approvalId: approval.id, externalActionId: action.id });
      return 'REJECTED';
    }

    await settle('APPROVED', 'Approved');
    if (!(await move(tx, action, ['WAITING_APPROVAL'], 'APPROVED', { statusReason: null }))) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'The action is no longer waiting for approval');
    const approved = await tx.externalAction.findUniqueOrThrow({ where: { id: action.id } });
    const ev = await evaluateAndRecord(tx, ctx.workspaceId, requestFor(approved, 'APPROVAL'), now);
    await apply(tx, ctx, approved, ev);
    const outcome: ApprovalOutcome = ev.result.decision === 'ACT' ? 'QUEUED' : ev.result.decision === 'WAIT' ? 'WAITING' : 'BLOCKED';
    await recordEvent(tx, ctx, 'ApprovalGranted', approval.id, { approvalId: approval.id, externalActionId: action.id, outcome });
    return outcome;
  });
}

/**
 * Execution gate (docs/10 §5-6, §130): right before the provider call the worker asks the Policy Engine again with the
 * current truth — kill switch, suppression, the requester's permission and autonomy, the approval. Anything but ACT
 * stops the call. A policy that can't be evaluated waits and is retried (never sends).
 */
export function createPolicyRevalidator(): Revalidator {
  return async (view, db) => {
    const action = await db.externalAction.findFirst({ where: { id: view.id, workspaceId: view.workspaceId } });
    if (!action) return { ok: false, status: 'BLOCKED', reason: 'Action not found' };
    // Execute what was approved — the frozen payload — so the fingerprint is checked against exactly that.
    const ev = await evaluateAndRecord(db, view.workspaceId, requestFor({ ...action, payload: view.payload as Prisma.JsonValue }, 'EXECUTION'));
    const r = ev.result;
    if (r.decision === 'ACT') return { ok: true };
    if (r.decision === 'WAIT') return { ok: false, status: 'WAITING', reason: r.reasonSummary, resumeAt: r.resumeAt ? new Date(r.resumeAt) : new Date() };
    if (r.reasonCodes.includes('POLICY_EVALUATION_FAILED')) return { ok: false, status: 'WAITING', reason: r.reasonSummary, resumeAt: new Date(Date.now() + 5 * 60_000) };
    return { ok: false, status: 'BLOCKED', reason: r.decision === 'ASK' ? `Needs approval again: ${r.reasonSummary}` : r.reasonSummary };
  };
}

/**
 * Periodic (job policy.sweep): expire undecided approvals (their actions are cancelled), and re-queue WAITING actions
 * whose time has come in workspaces where outbound is on. Each re-queued action is revalidated before it runs —
 * resuming never sends everything blindly (docs/10 §93-102).
 */
export async function policySweep(db: PrismaClient, now = new Date(), limit = 200): Promise<{ expired: number; resumed: number }> {
  const system: ServiceContext['actor'] = { type: 'SYSTEM', id: null };
  let expired = 0;
  const stale = await db.approvalRequest.findMany({ where: { status: 'PENDING', expiresAt: { lte: now } }, take: limit });
  for (const a of stale) {
    await db.$transaction(async (tx) => {
      const { count } = await tx.approvalRequest.updateMany({ where: { id: a.id, status: 'PENDING' }, data: { status: 'EXPIRED', decidedAt: now, decisionNote: 'Nobody decided in time', version: { increment: 1 } } });
      if (count !== 1) return;
      expired++;
      const ctx = { workspaceId: a.workspaceId, actor: system };
      if (await move(tx, { id: a.externalActionId, workspaceId: a.workspaceId }, ['WAITING_APPROVAL'], 'CANCELLED', { statusReason: 'Approval expired' })) {
        await recordEvent(tx, ctx, 'ExternalActionCancelled', a.externalActionId, { externalActionId: a.externalActionId, actionType: a.actionType, reason: 'Approval expired' });
      }
      await recordEvent(tx, ctx, 'ApprovalExpired', a.id, { approvalId: a.id, externalActionId: a.externalActionId });
    });
  }

  let resumed = 0;
  const due = await db.externalAction.findMany({
    where: { status: 'WAITING', resumeAt: { lte: now }, workspace: { status: 'ACTIVE' } },
    include: { workspace: { select: { outboundState: true } } },
    orderBy: { resumeAt: 'asc' },
    take: limit,
  });
  for (const a of due) {
    if (actionDefinition(a.actionType)?.outbound && a.workspace.outboundState !== 'ACTIVE') continue;
    await db.$transaction(async (tx) => {
      await tx.externalAction.updateMany({ where: { id: a.id, status: 'WAITING' }, data: { resumeAt: null } });
      if (await queueExternalAction(tx, { workspaceId: a.workspaceId, actor: system }, a.id).catch(() => false)) resumed++;
    });
  }
  return { expired, resumed };
}
