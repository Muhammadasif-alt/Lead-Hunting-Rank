import type { ExternalActionStatus } from '@revenue-os/database';
import { isUniqueViolation, writeAudit, type ServiceContext } from '@revenue-os/domain';
import { recordEvent, type Tx } from '@revenue-os/events';
import {
  AUTONOMY_LEVELS,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  normalizeSuppressionValue,
  NotFoundError,
  PolicyError,
  SUPPRESSION_REASONS,
  ValidationError,
  type AutonomyLevel,
  type OutboundState,
  type PermissionKey,
  type PolicySettings,
  type SuppressionReason,
  type SuppressionScope,
} from '@revenue-os/shared';
import { actionDefinition } from './actions.js';
import { actionTargets, type ActionTargets } from './context.js';
import { bumpPolicyVersion, loadPolicySettings, savePolicySettings } from './settings.js';

// ───────────────────────────── kill switch ─────────────────────────────

/** Who may move outbound between states (docs/10 §93-102): resuming after an emergency stop is owner-only. */
export function outboundPermissionFor(from: OutboundState, to: OutboundState): PermissionKey {
  if (to === 'EMERGENCY_STOP') return 'outbound.emergency_stop';
  if (from === 'EMERGENCY_STOP') return 'outbound.resume';
  return 'outbound.pause';
}

/**
 * Pause, emergency-stop or resume all outbound. Inbound, research, scoring and manual work keep running. Nothing queued
 * is sent on resume without being revalidated: emergency stop blocks queued actions at execution; paused ones wait and
 * are checked one by one after resuming.
 */
export async function setOutboundState(tx: Tx, ctx: ServiceContext, permissions: ReadonlySet<string>, to: OutboundState, reason: string | null) {
  const ws = await tx.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { outboundState: true } });
  const from = ws.outboundState as OutboundState;
  if (from === to) return { state: to, changed: false };
  const needed = outboundPermissionFor(from, to);
  if (!permissions.has(needed)) throw new ForbiddenError(`Missing permission: ${needed}`, [{ path: 'permission', message: needed }]);
  if (to !== 'ACTIVE' && !reason?.trim()) throw new ValidationError('Say why outbound is being stopped', [{ path: 'reason', message: 'Required' }]);
  const { count } = await tx.workspace.updateMany({
    where: { id: ctx.workspaceId, outboundState: from },
    data: { outboundState: to, outboundReason: reason?.trim() || null, outboundChangedAt: new Date(), outboundChangedBy: ctx.actor.type === 'HUMAN' ? ctx.actor.id : null },
  });
  if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'Outbound state changed meanwhile — reload and try again');
  await writeAudit(tx, ctx, { action: 'outbound.state_changed', entityType: 'WORKSPACE', entityId: ctx.workspaceId, before: { outboundState: from }, after: { outboundState: to }, reason: reason ?? undefined });
  await recordEvent(tx, ctx, 'OutboundStateChanged', ctx.workspaceId, { from, to, reason: reason?.trim() || null });
  return { state: to, changed: true };
}

// ───────────────────────────── autonomy + rules ─────────────────────────────

/** Changes the autonomy preset and/or configurable rules; a new policy version, audited with before/after. */
export async function updatePolicy(tx: Tx, ctx: ServiceContext, input: { autonomyLevel?: AutonomyLevel; settings?: PolicySettings }) {
  const before = await loadPolicySettings(tx, ctx.workspaceId);
  const ws = await tx.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { autonomyLevel: true } });
  const changed: string[] = [];
  if (input.autonomyLevel && input.autonomyLevel !== ws.autonomyLevel) {
    if (!AUTONOMY_LEVELS.includes(input.autonomyLevel)) throw new ValidationError('Unknown autonomy level');
    await tx.workspace.update({ where: { id: ctx.workspaceId }, data: { autonomyLevel: input.autonomyLevel } });
    changed.push('autonomyLevel');
  }
  let version = before.version;
  if (input.settings) {
    const diff = (Object.keys(input.settings) as (keyof PolicySettings)[]).filter((k) => JSON.stringify(input.settings![k]) !== JSON.stringify(before.settings[k]));
    if (diff.length) {
      version = await savePolicySettings(tx, ctx.workspaceId, input.settings);
      changed.push(...diff);
    }
  }
  if (!changed.length) return { version, changedFields: [] };
  if (version === before.version) version = await bumpPolicyVersion(tx, ctx.workspaceId);
  await writeAudit(tx, ctx, {
    action: 'policy.updated',
    entityType: 'WORKSPACE',
    entityId: ctx.workspaceId,
    before: { version: before.version, autonomyLevel: ws.autonomyLevel, settings: before.settings },
    after: { version, autonomyLevel: input.autonomyLevel ?? ws.autonomyLevel, settings: input.settings ?? before.settings },
  });
  await recordEvent(tx, ctx, 'PolicyUpdated', ctx.workspaceId, { version, changedFields: changed });
  return { version, changedFields: changed };
}

// ───────────────────────────── suppression ─────────────────────────────

const PENDING: ExternalActionStatus[] = ['PREPARED', 'WAITING_APPROVAL', 'APPROVED', 'QUEUED', 'WAITING'];

function hits(scope: string, value: string, t: ActionTargets): boolean {
  switch (scope) {
    case 'EMAIL':
      return t.emails.includes(value);
    case 'DOMAIN':
      return t.domains.includes(value);
    case 'PERSON':
      return t.personIds.includes(value);
    case 'COMPANY':
      return t.companyIds.includes(value);
    default:
      return false;
  }
}

/**
 * Puts someone on the do-not-contact list and cancels every pending outbound action that would reach them, in the same
 * transaction (docs/10 §37-47: suppression created → pending outbound cancelled → audit/event, no AI discretion).
 * Adding an existing active suppression returns it unchanged.
 */
export async function addSuppression(
  tx: Tx,
  ctx: ServiceContext,
  input: { scope: SuppressionScope; value: string; reason: SuppressionReason; note?: string | null; source?: string },
) {
  const value = normalizeSuppressionValue(input.scope, input.value);
  if (!value) throw new ValidationError(`That is not a valid ${input.scope.toLowerCase()}`, [{ path: 'value', message: 'Invalid' }]);
  if (input.scope === 'PERSON' || input.scope === 'COMPANY') {
    const exists = input.scope === 'PERSON'
      ? await tx.person.findFirst({ where: { id: value, workspaceId: ctx.workspaceId }, select: { id: true } })
      : await tx.company.findFirst({ where: { id: value, workspaceId: ctx.workspaceId }, select: { id: true } });
    if (!exists) throw new NotFoundError(`${input.scope.toLowerCase()} not found`);
  }
  const existing = await tx.suppression.findFirst({ where: { workspaceId: ctx.workspaceId, scope: input.scope, value, status: 'ACTIVE' } });
  if (existing) return { suppression: existing, created: false, cancelledActions: 0 };

  let suppression;
  try {
    // A racing insert of the same suppression hits the partial unique index.
    suppression = await tx.suppression.create({
      data: {
        workspaceId: ctx.workspaceId,
        scope: input.scope,
        value,
        reason: input.reason,
        note: input.note?.trim() || null,
        source: input.source ?? 'MANUAL',
        createdByType: ctx.actor.type,
        createdById: ctx.actor.id,
      },
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('VERSION_CONFLICT', 'This was just suppressed by someone else — reload');
    throw err;
  }

  // Cancel pending outbound that would reach the suppressed target. Execution would block it anyway; cancelling now
  // keeps approvals and queues honest.
  const pending = await tx.externalAction.findMany({ where: { workspaceId: ctx.workspaceId, status: { in: PENDING } }, take: 1000 });
  let cancelled = 0;
  for (const action of pending) {
    if (!actionDefinition(action.actionType)?.outbound) continue;
    const targets = await actionTargets(tx, ctx.workspaceId, { actionType: action.actionType, entity: { type: action.entityType, id: action.entityId }, payload: action.payload as Record<string, unknown> });
    if (!hits(input.scope, value, targets)) continue;
    const reason = `Recipient suppressed (${SUPPRESSION_REASONS[input.reason].label.toLowerCase()})`;
    const { count } = await tx.externalAction.updateMany({ where: { id: action.id, status: { in: PENDING } }, data: { status: 'CANCELLED', statusReason: reason, version: { increment: 1 } } });
    if (count !== 1) continue;
    cancelled++;
    await tx.approvalRequest.updateMany({ where: { externalActionId: action.id, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date(), decisionNote: reason } });
    await recordEvent(tx, ctx, 'ExternalActionCancelled', action.id, { externalActionId: action.id, actionType: action.actionType, reason });
  }

  await writeAudit(tx, ctx, { action: 'suppression.added', entityType: 'SUPPRESSION', entityId: suppression.id, after: { scope: input.scope, reason: input.reason, cancelledActions: cancelled }, reason: input.note ?? undefined });
  await recordEvent(tx, ctx, 'SuppressionAdded', suppression.id, { suppressionId: suppression.id, scope: input.scope, reason: input.reason, cancelledActions: cancelled });
  return { suppression, created: true, cancelledActions: cancelled };
}

/** Lifts a suppression a person chose. Unsubscribes, complaints and legal holds can't be lifted (docs/10 §103-109). */
export async function liftSuppression(tx: Tx, ctx: ServiceContext, suppressionId: string, reason: string) {
  if (!reason.trim()) throw new ValidationError('Say why it is being lifted', [{ path: 'reason', message: 'Required' }]);
  const s = await tx.suppression.findFirst({ where: { id: suppressionId, workspaceId: ctx.workspaceId } });
  if (!s) throw new NotFoundError('Suppression not found');
  if (s.status !== 'ACTIVE') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This suppression is already lifted');
  if (!SUPPRESSION_REASONS[s.reason as SuppressionReason].liftable) {
    throw new PolicyError('POLICY_BLOCKED', `${SUPPRESSION_REASONS[s.reason as SuppressionReason].label} can't be lifted — the person asked not to be contacted`);
  }
  const { count } = await tx.suppression.updateMany({
    where: { id: s.id, status: 'ACTIVE' },
    data: { status: 'LIFTED', liftedAt: new Date(), liftedById: ctx.actor.type === 'HUMAN' ? ctx.actor.id : null, liftReason: reason.trim(), version: { increment: 1 } },
  });
  if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This suppression changed meanwhile — reload');
  await writeAudit(tx, ctx, { action: 'suppression.lifted', entityType: 'SUPPRESSION', entityId: s.id, before: { status: 'ACTIVE' }, after: { status: 'LIFTED' }, reason });
  await recordEvent(tx, ctx, 'SuppressionLifted', s.id, { suppressionId: s.id, scope: s.scope, reason: s.reason });
  return { id: s.id, status: 'LIFTED' as const };
}

