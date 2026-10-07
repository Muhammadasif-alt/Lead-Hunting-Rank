import { createHash } from 'node:crypto';
import { AgentType, type Prisma, type PrismaClient } from '@revenue-os/database';
import { payloadHash } from '@revenue-os/events';
import { normalizeEmail, type AutonomyLevel, type OutboundState } from '@revenue-os/shared';
import { actionDefinition } from './actions.js';
import { loadPolicySettings } from './settings.js';
import { isValidTimezone, startOfLocalDay } from './time.js';
import type { PolicyContext, PolicyRequest } from './types.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** Material fields of an action: what it does, to whom, with which exact payload. A changed payload = new fingerprint. */
export function actionFingerprint(req: Pick<PolicyRequest, 'actionType' | 'entity' | 'payload'>): string {
  return createHash('sha256').update(`${req.actionType}|${req.entity.type}|${req.entity.id}|${payloadHash(req.payload)}`).digest('hex');
}

/** Hash of the context minus the clock — a different hash later means the situation changed. */
export function contextHash(ctx: PolicyContext): string {
  const { now: _now, ...rest } = ctx;
  return payloadHash(rest);
}

/** Recipient emails of an outbound action, normalized. */
export function recipientsOf(actionType: string, payload: Record<string, unknown>): string[] {
  if (actionType !== 'email.send') return [];
  const to = Array.isArray(payload.to) ? payload.to : typeof payload.to === 'string' ? [payload.to] : [];
  return [...new Set(to.map((v) => (typeof v === 'string' ? normalizeEmail(v) : null)).filter((v): v is string => !!v))];
}

/**
 * Who an action reaches: the addresses, their domains, and the people and companies behind them (through the action's
 * entity and through contact points carrying those addresses). Suppression on any of them blocks the action.
 */
export async function actionTargets(db: Db, workspaceId: string, req: Pick<PolicyRequest, 'actionType' | 'entity' | 'payload'>) {
  const emails = recipientsOf(req.actionType, req.payload);
  const domains = [...new Set(emails.map((e) => e.slice(e.lastIndexOf('@') + 1)))];
  const personIds = new Set<string>();
  const companyIds = new Set<string>();
  if (req.entity.type === 'PERSON') personIds.add(req.entity.id);
  if (req.entity.type === 'COMPANY') companyIds.add(req.entity.id);

  const points = emails.length
    ? await db.contactPoint.findMany({
        where: { workspaceId, type: 'EMAIL', normalizedValue: { in: emails }, archivedAt: null },
        select: { normalizedValue: true, entityType: true, entityId: true, status: true, verifications: { orderBy: { verifiedAt: 'desc' }, take: 1, select: { status: true } } },
      })
    : [];
  if (req.entity.type === 'CONTACT_POINT') {
    const cp = await db.contactPoint.findFirst({ where: { workspaceId, id: req.entity.id }, select: { entityType: true, entityId: true } });
    if (cp?.entityType === 'PERSON') personIds.add(cp.entityId);
    if (cp?.entityType === 'COMPANY') companyIds.add(cp.entityId);
  }
  for (const p of points) {
    if (p.entityType === 'PERSON') personIds.add(p.entityId);
    if (p.entityType === 'COMPANY') companyIds.add(p.entityId);
  }
  if (personIds.size) {
    const jobs = await db.employment.findMany({ where: { workspaceId, personId: { in: [...personIds] } }, select: { companyId: true } });
    for (const j of jobs) companyIds.add(j.companyId);
  }
  const invalid = new Set(points.filter((p) => p.status === 'INVALID' || p.verifications[0]?.status === 'INVALID').map((p) => p.normalizedValue));
  return { emails, domains, personIds: [...personIds], companyIds: [...companyIds], invalidEmails: [...invalid] };
}

export type ActionTargets = Awaited<ReturnType<typeof actionTargets>>;

/** Active suppressions that match any target. */
export async function matchingSuppressions(db: Db, workspaceId: string, t: ActionTargets) {
  const or: Prisma.SuppressionWhereInput[] = [];
  if (t.emails.length) or.push({ scope: 'EMAIL', value: { in: t.emails } });
  if (t.domains.length) or.push({ scope: 'DOMAIN', value: { in: t.domains } });
  if (t.personIds.length) or.push({ scope: 'PERSON', value: { in: t.personIds } });
  if (t.companyIds.length) or.push({ scope: 'COMPANY', value: { in: t.companyIds } });
  if (!or.length) return [];
  return db.suppression.findMany({ where: { workspaceId, status: 'ACTIVE', OR: or }, select: { id: true, scope: true, reason: true } });
}

/** Effective permissions of an active member (deny wins), or null when the user isn't an active member. */
export async function memberPermissions(db: Db, workspaceId: string, userId: string): Promise<string[] | null> {
  const member = await db.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    include: { roles: { include: { role: { include: { permissions: { include: { permission: { select: { key: true } } } } } } } } },
  });
  if (!member || member.status !== 'ACTIVE') return null;
  const allowed = new Set<string>();
  const denied = new Set<string>();
  for (const { role } of member.roles) for (const g of role.permissions) (g.effect === 'DENY' ? denied : allowed).add(g.permission.key);
  return [...allowed].filter((k) => !denied.has(k)).sort();
}

const EMAIL_STATES = ['SUCCEEDED', 'EXECUTING', 'UNKNOWN_OUTCOME'] as const;

/**
 * Loads the current truth for one decision. Suppression, kill switch and permissions are always read fresh — a
 * decision is never made from a cached copy of them (docs/10 §110-118).
 */
export async function buildPolicyContext(db: Db, workspaceId: string, req: PolicyRequest, now = new Date()): Promise<PolicyContext> {
  const def = actionDefinition(req.actionType);
  // Sequential: `db` is often the caller's transaction, which runs one query at a time.
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { status: true, outboundState: true, autonomyLevel: true, defaultTimezone: true } });
  const rules = await loadPolicySettings(db, workspaceId);
  const timezone = isValidTimezone(workspace.defaultTimezone) ? workspace.defaultTimezone : 'UTC';

  let agent: AutonomyLevel | null = null;
  let agentEnabled: boolean | null = null;
  const agentType = req.actor.type === 'AI_AGENT' ? req.actor.agentType : null;
  if (agentType && Object.hasOwn(AgentType, agentType)) {
    const row = await db.agentDefinition.findUnique({ where: { workspaceId_agentType: { workspaceId, agentType: agentType as AgentType } }, select: { enabled: true, autonomyLevel: true } });
    agent = row?.autonomyLevel ?? null;
    agentEnabled = row?.enabled ?? null;
  }

  const actorPermissions = req.actor.type === 'HUMAN' && req.actor.id ? await memberPermissions(db, workspaceId, req.actor.id) : null;

  const targets = def?.outbound ? await actionTargets(db, workspaceId, req) : { emails: [], domains: [], personIds: [], companyIds: [], invalidEmails: [] };
  const suppressions = def?.outbound ? await matchingSuppressions(db, workspaceId, targets) : [];

  // Earlier outbound to these recipients (first touch, cool-down) and today's volume (daily limit).
  const notThis = req.externalActionId ? { id: { not: req.externalActionId } } : {};
  let lastContactAt: Date | null = null;
  let sentToday = 0;
  if (def?.outbound && targets.emails.length) {
    const previous = await db.externalAction.findFirst({
      where: { workspaceId, actionType: req.actionType, status: { in: [...EMAIL_STATES] }, OR: targets.emails.map((e) => ({ payload: { path: ['to'], array_contains: [e] } })), ...notThis },
      orderBy: [{ executedAt: { sort: 'desc', nulls: 'last' } }, { updatedAt: 'desc' }],
      select: { executedAt: true, updatedAt: true },
    });
    lastContactAt = previous ? (previous.executedAt ?? previous.updatedAt) : null;
    sentToday = await db.externalAction.count({
      where: { workspaceId, actionType: req.actionType, status: { in: [...EMAIL_STATES] }, OR: [{ executedAt: { gte: startOfLocalDay(now, timezone) } }, { executedAt: null }], ...notThis },
    });
  }

  let providerAvailable: boolean | null = null;
  if (def?.outbound && req.externalActionId) {
    const action = await db.externalAction.findFirst({ where: { id: req.externalActionId, workspaceId }, select: { providerAccountId: true } });
    if (action?.providerAccountId) {
      const integration = await db.integration.findFirst({ where: { id: action.providerAccountId, workspaceId }, select: { status: true } });
      providerAvailable = !!integration && !['DISABLED', 'DISCONNECTED', 'CONNECTING'].includes(integration.status);
    }
  }

  const approvalRow = req.externalActionId
    ? await db.approvalRequest.findFirst({
        where: { workspaceId, externalActionId: req.externalActionId, status: { in: ['APPROVED', 'REJECTED'] } },
        orderBy: { decidedAt: 'desc' },
        select: { id: true, status: true, fingerprint: true, expiresAt: true },
      })
    : null;

  return {
    now: now.toISOString(),
    timezone,
    workspaceStatus: workspace.status,
    outboundState: workspace.outboundState as OutboundState,
    policyVersion: rules.version,
    settings: rules.settings,
    autonomy: { workspace: workspace.autonomyLevel as AutonomyLevel, agent, agentEnabled },
    actorPermissions,
    recipients: targets.emails,
    suppressions,
    invalidRecipients: targets.invalidEmails,
    firstTouch: lastContactAt === null,
    sentToday,
    lastContactAt: lastContactAt?.toISOString() ?? null,
    providerAvailable,
    approval: approvalRow ? { id: approvalRow.id, status: approvalRow.status as 'APPROVED' | 'REJECTED', fingerprint: approvalRow.fingerprint, expiresAt: approvalRow.expiresAt.toISOString() } : null,
    fingerprint: actionFingerprint(req),
  };
}
