import { randomBytes } from 'node:crypto';
import type { Campaign, CampaignObjective, CampaignStatus, EnrollmentStatus, Prisma } from '@revenue-os/database';
import { writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { loadPolicySettings } from '@revenue-os/policy';
import { BusinessRuleError, NotFoundError, ValidationError } from '@revenue-os/shared';
import { findAudience, parseAudience, type AudienceFilter } from './audience.js';

export const FOLLOW_UP_ANGLES = ['CLARIFY_VALUE', 'NEW_OBSERVATION', 'CLOSE_THE_LOOP'] as const;
export type FollowUpAngle = (typeof FOLLOW_UP_ANGLES)[number];

export interface CampaignStrategy {
  /** The one question every first email ends with, e.g. "Would a 15-minute call next week be useful?" */
  cta?: string;
  tone?: string;
  /** Things the AI must not say (on top of the built-in guardrails). */
  avoid?: string[];
}

export interface CampaignInput {
  name: string;
  objective: CampaignObjective;
  offer: string;
  audience: AudienceFilter;
  strategy: CampaignStrategy;
  mailboxIntegrationId: string | null;
  senderName: string;
  cohortSize: number;
  dailyNewLimit: number;
  followUps: { delayDays: number; angle: FollowUpAngle }[];
}

/** Default sequence (screen #6 §12): first email, a value follow-up after 3 days, a polite close after 4 more. */
export const DEFAULT_FOLLOW_UPS: CampaignInput['followUps'] = [
  { delayDays: 3, angle: 'CLARIFY_VALUE' },
  { delayDays: 4, angle: 'CLOSE_THE_LOOP' },
];

const EDITABLE: CampaignStatus[] = ['DRAFT', 'READY'];
/** Enrollment states in which the campaign still owns the cold sequence. */
export const LIVE_ENROLLMENT: EnrollmentStatus[] = ['ENROLLED', 'ACTIVE', 'PAUSED'];

function validateInput(input: Partial<CampaignInput>) {
  if (input.name !== undefined && !input.name.trim()) throw new ValidationError('Give the campaign a name', [{ path: 'name', message: 'Required' }]);
  if (input.cohortSize !== undefined && (input.cohortSize < 1 || input.cohortSize > 500)) throw new ValidationError('First cohort must be 1–500 prospects');
  if (input.dailyNewLimit !== undefined && (input.dailyNewLimit < 1 || input.dailyNewLimit > 200)) throw new ValidationError('New emails per day must be 1–200');
  if (input.followUps) {
    if (input.followUps.length > 3) throw new ValidationError('At most 3 follow-ups');
    if (input.followUps.some((f) => f.delayDays < 1 || f.delayDays > 30)) throw new ValidationError('Follow-ups wait 1–30 days');
  }
}

async function loadCampaign(db: Tx, ctx: ServiceContext, id: string): Promise<Campaign> {
  const c = await db.campaign.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!c) throw new NotFoundError('Campaign not found');
  return c;
}

/** Conditional status change (race-safe): only from the expected states. */
async function moveCampaign(tx: Tx, c: Pick<Campaign, 'id' | 'workspaceId'>, from: CampaignStatus[], data: Prisma.CampaignUpdateManyMutationInput & { status: CampaignStatus }) {
  const { count } = await tx.campaign.updateMany({ where: { id: c.id, workspaceId: c.workspaceId, status: { in: from } }, data: { ...data, version: { increment: 1 } } });
  if (count !== 1) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `The campaign can't go to ${data.status.toLowerCase()} from its current state`);
}

async function writeSteps(tx: Tx, c: Pick<Campaign, 'id' | 'workspaceId'>, followUps: CampaignInput['followUps']) {
  await tx.campaignStep.deleteMany({ where: { campaignId: c.id } });
  await tx.campaignStep.createMany({
    data: [
      { workspaceId: c.workspaceId, campaignId: c.id, position: 1, kind: 'FIRST_TOUCH' as const, delayDays: 0, angle: 'FIRST_TOUCH' },
      ...followUps.map((f, i) => ({ workspaceId: c.workspaceId, campaignId: c.id, position: i + 2, kind: 'FOLLOW_UP' as const, delayDays: f.delayDays, angle: f.angle })),
    ],
  });
}

export async function createCampaign(tx: Tx, ctx: ServiceContext, input: Partial<CampaignInput> & { name: string }) {
  validateInput(input);
  const c = await tx.campaign.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: input.name.trim(),
      objective: input.objective ?? 'START_CONVERSATIONS',
      offer: input.offer?.trim() ?? '',
      audience: (input.audience ?? {}) as Prisma.InputJsonValue,
      strategy: (input.strategy ?? {}) as Prisma.InputJsonValue,
      mailboxIntegrationId: input.mailboxIntegrationId ?? null,
      senderName: input.senderName?.trim() ?? '',
      cohortSize: input.cohortSize ?? 25,
      dailyNewLimit: input.dailyNewLimit ?? 20,
      createdBy: ctx.actor.type === 'HUMAN' ? ctx.actor.id : null,
    },
  });
  await writeSteps(tx, c, input.followUps ?? DEFAULT_FOLLOW_UPS);
  await writeAudit(tx, ctx, { action: 'campaign.created', entityType: 'CAMPAIGN', entityId: c.id, after: { name: c.name } });
  await recordEvent(tx, ctx, 'CampaignCreated', c.id, { campaignId: c.id, name: c.name });
  return c;
}

/** Edits a DRAFT or READY campaign. A READY campaign goes back to DRAFT — its checks must run again. */
export async function updateCampaign(tx: Tx, ctx: ServiceContext, id: string, input: Partial<CampaignInput>) {
  validateInput(input);
  const c = await loadCampaign(tx, ctx, id);
  if (!EDITABLE.includes(c.status)) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only draft campaigns can be edited — pause and clone to change a running one');
  const data: Prisma.CampaignUpdateManyMutationInput = { status: 'DRAFT', checks: undefined, checkedAt: null };
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.objective !== undefined) data.objective = input.objective;
  if (input.offer !== undefined) data.offer = input.offer.trim();
  if (input.audience !== undefined) data.audience = input.audience as Prisma.InputJsonValue;
  if (input.strategy !== undefined) data.strategy = input.strategy as Prisma.InputJsonValue;
  if (input.mailboxIntegrationId !== undefined) data.mailboxIntegrationId = input.mailboxIntegrationId;
  if (input.senderName !== undefined) data.senderName = input.senderName.trim();
  if (input.cohortSize !== undefined) data.cohortSize = input.cohortSize;
  if (input.dailyNewLimit !== undefined) data.dailyNewLimit = input.dailyNewLimit;
  await moveCampaign(tx, c, EDITABLE, { ...data, status: 'DRAFT' });
  if (input.followUps) await writeSteps(tx, c, input.followUps);
  const changed = Object.keys(input);
  await writeAudit(tx, ctx, { action: 'campaign.updated', entityType: 'CAMPAIGN', entityId: c.id, after: { changedFields: changed } });
  await recordEvent(tx, ctx, 'CampaignUpdated', c.id, { campaignId: c.id, changedFields: changed });
  return tx.campaign.findUniqueOrThrow({ where: { id: c.id } });
}

export interface CampaignCheck {
  key: string;
  label: string;
  ok: boolean;
  blocking: boolean;
  detail: string;
}

/**
 * Pre-launch checks (docs/17 §67-76, screen #6 §35): audience, contacts, suppression, mailbox, sequence, AI, policy.
 * All blocking checks pass → READY. Nothing is sent by checking.
 */
export async function checkCampaign(tx: Tx, ctx: ServiceContext, id: string, opts: { persist?: boolean; now?: Date } = {}) {
  const c = await loadCampaign(tx, ctx, id);
  const audience = await findAudience(tx, ctx.workspaceId, parseAudience(c.audience), { campaignId: c.id, now: opts.now });
  // One query at a time — this runs inside a transaction.
  const mailbox = c.mailboxIntegrationId ? await tx.integration.findFirst({ where: { id: c.mailboxIntegrationId, workspaceId: ctx.workspaceId }, include: { health: true } }) : null;
  const steps = await tx.campaignStep.count({ where: { campaignId: c.id } });
  const ws = await tx.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { outboundState: true } });
  const rules = await loadPolicySettings(tx, ctx.workspaceId);
  const model = await tx.integration.count({ where: { workspaceId: ctx.workspaceId, capabilities: { has: 'LLM_REASONING' }, status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] } } });
  const agent = await tx.agentDefinition.findUnique({ where: { workspaceId_agentType: { workspaceId: ctx.workspaceId, agentType: 'CAMPAIGN' } }, select: { enabled: true } });
  const live = mailbox && !['DISABLED', 'DISCONNECTED', 'CONNECTING', 'AUTH_EXPIRED'].includes(mailbox.status);
  const sendDown = mailbox?.health.some((h) => h.capability === 'EMAIL_SEND' && (h.state === 'UNAVAILABLE' || h.state === 'AUTH_REQUIRED'));
  const checks: CampaignCheck[] = [
    { key: 'offer', label: 'Offer described', ok: c.offer.trim().length >= 3, blocking: true, detail: c.offer.trim() ? c.offer : 'Say what you offer — the AI only uses what you write here' },
    {
      key: 'audience',
      label: 'Contactable prospects',
      ok: audience.eligible.length > 0,
      blocking: true,
      detail: `${audience.eligible.length} of ${audience.matched} matching companies can be contacted (${audience.excluded.noVerifiedEmail} without a verified email, ${audience.excluded.suppressed} on the do-not-contact list, ${audience.excluded.inOtherCampaign} in another campaign, ${audience.excluded.recentlyContacted} contacted recently)`,
    },
    {
      key: 'mailbox',
      label: 'Mailbox connected',
      ok: !!live && !!mailbox?.capabilities.includes('EMAIL_SEND') && !sendDown,
      blocking: true,
      detail: !mailbox ? 'Pick the mailbox to send from' : !live ? `${mailbox.name} is ${mailbox.status.toLowerCase()}` : sendDown ? `${mailbox.name} can't send right now` : `Sending from ${mailbox.name}`,
    },
    {
      key: 'replies',
      label: 'Replies can be noticed',
      ok: !!mailbox?.capabilities.includes('EMAIL_READ'),
      blocking: true,
      detail: mailbox?.capabilities.includes('EMAIL_READ') ? 'Replies, unsubscribes and bounces stop the sequence automatically' : 'The mailbox must allow reading, or a reply could not stop follow-ups',
    },
    { key: 'sequence', label: 'Sequence', ok: steps >= 1, blocking: true, detail: `${steps} step(s): first email${steps > 1 ? ` + ${steps - 1} follow-up(s)` : ''}` },
    { key: 'ai', label: 'AI model for drafting', ok: model > 0 && agent?.enabled !== false, blocking: true, detail: model === 0 ? 'Connect an AI model in Integrations' : agent?.enabled === false ? 'The Campaign Agent is turned off (AI Control Center)' : 'The Campaign Agent drafts each email; validators check it' },
    { key: 'outbound', label: 'Outbound is on', ok: ws.outboundState === 'ACTIVE', blocking: true, detail: ws.outboundState === 'ACTIVE' ? 'Kill switch is off' : `Outbound is ${ws.outboundState.toLowerCase().replace('_', ' ')} — resume it in the AI Control Center` },
    {
      key: 'limits',
      label: 'Sending limits',
      ok: rules.settings.dailySendLimit === null || c.dailyNewLimit <= rules.settings.dailySendLimit,
      blocking: false,
      detail: `${c.dailyNewLimit} new/day for this campaign; workspace limit ${rules.settings.dailySendLimit ?? 'none'}/day${rules.settings.sendWindow.enabled ? `, ${rules.settings.sendWindow.startHour}:00–${rules.settings.sendWindow.endHour}:00` : ''}`,
    },
  ];
  const failed = checks.filter((x) => x.blocking && !x.ok).map((x) => x.key);
  if (opts.persist !== false && EDITABLE.includes(c.status)) {
    const status: CampaignStatus = failed.length ? 'DRAFT' : 'READY';
    await tx.campaign.update({ where: { id: c.id }, data: { status, checks: checks as unknown as Prisma.InputJsonValue, checkedAt: new Date() } });
    await recordEvent(tx, ctx, 'CampaignChecked', c.id, { campaignId: c.id, status, failed });
  }
  return { checks, ready: failed.length === 0, audience: { matched: audience.matched, eligible: audience.eligible.length, excluded: audience.excluded } };
}

/** Enrolls up to `count` eligible prospects; each gets its own unsubscribe token. */
async function enroll(tx: Tx, ctx: ServiceContext, c: Campaign, count: number, now: Date) {
  const { eligible } = await findAudience(tx, ctx.workspaceId, parseAudience(c.audience), { campaignId: c.id, limit: count, now });
  if (!eligible.length) return 0;
  await tx.campaignEnrollment.createMany({
    data: eligible.map((e) => ({
      workspaceId: ctx.workspaceId,
      campaignId: c.id,
      companyId: e.companyId,
      personId: e.personId,
      contactPointId: e.contactPointId,
      email: e.email,
      firstName: e.firstName,
      status: 'ACTIVE' as const,
      nextStepPosition: 1,
      nextStepDueAt: now,
      eligibilitySnapshot: { name: e.name, title: e.title, relevance: e.relevance, priority: e.priority, opportunityKeys: e.opportunityKeys, at: now.toISOString() },
      unsubscribeToken: randomBytes(24).toString('base64url'),
    })),
    skipDuplicates: true,
  });
  await recordEvent(tx, ctx, 'ProspectsEnrolled', c.id, { campaignId: c.id, count: eligible.length });
  return eligible.length;
}

/**
 * Launch (docs/09 §21-27 StartCampaign): READY → ACTIVE through an explicit command, after the checks pass again, and
 * the first cohort is enrolled. The caller checks the person's campaign.start permission and audience authority.
 */
export async function launchCampaign(tx: Tx, ctx: ServiceContext, id: string, now = new Date()) {
  const c = await loadCampaign(tx, ctx, id);
  if (c.status !== 'READY') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Run the pre-launch checks first — only a READY campaign can launch');
  const check = await checkCampaign(tx, ctx, id, { persist: false, now });
  if (!check.ready) throw new BusinessRuleError('STALE_CONTEXT', `Checks no longer pass: ${check.checks.filter((x) => x.blocking && !x.ok).map((x) => x.label.toLowerCase()).join(', ')}`);
  await moveCampaign(tx, c, ['READY'], { status: 'ACTIVE', launchedAt: now, statusReason: null });
  const enrolled = await enroll(tx, ctx, c, c.cohortSize, now);
  await writeAudit(tx, ctx, { action: 'campaign.started', entityType: 'CAMPAIGN', entityId: c.id, after: { enrolled, cohortSize: c.cohortSize } });
  await recordEvent(tx, ctx, 'CampaignStarted', c.id, { campaignId: c.id, enrolled });
  return { enrolled };
}

/** Adds the next cohort to an ACTIVE campaign (screen #6 §34: validation → expansion). */
export async function enrollMore(tx: Tx, ctx: ServiceContext, id: string, count: number, now = new Date()) {
  const c = await loadCampaign(tx, ctx, id);
  if (c.status !== 'ACTIVE') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only an active campaign can enroll more prospects');
  if (count < 1 || count > 500) throw new ValidationError('Enroll 1–500 at a time');
  const enrolled = await enroll(tx, ctx, c, count, now);
  await writeAudit(tx, ctx, { action: 'campaign.enrolled', entityType: 'CAMPAIGN', entityId: c.id, after: { enrolled } });
  return { enrolled };
}

export async function pauseCampaign(tx: Tx, ctx: ServiceContext, id: string, reason: string | null) {
  const c = await loadCampaign(tx, ctx, id);
  await moveCampaign(tx, c, ['ACTIVE'], { status: 'PAUSED', pausedAt: new Date(), statusReason: reason });
  await writeAudit(tx, ctx, { action: 'campaign.paused', entityType: 'CAMPAIGN', entityId: c.id, reason: reason ?? undefined });
  await recordEvent(tx, ctx, 'CampaignPaused', c.id, { campaignId: c.id, reason });
}

/** Resume revalidates first (docs/09 §21-27): mailbox and outbound must be fine; every prospect is re-checked per step. */
export async function resumeCampaign(tx: Tx, ctx: ServiceContext, id: string) {
  const c = await loadCampaign(tx, ctx, id);
  const { checks } = await checkCampaign(tx, ctx, id, { persist: false });
  const bad = checks.filter((x) => x.blocking && !x.ok && ['mailbox', 'replies', 'outbound', 'ai'].includes(x.key));
  if (bad.length) throw new BusinessRuleError('STALE_CONTEXT', `Can't resume: ${bad.map((x) => x.detail).join('; ')}`);
  await moveCampaign(tx, c, ['PAUSED'], { status: 'ACTIVE', pausedAt: null, statusReason: null });
  await writeAudit(tx, ctx, { action: 'campaign.resumed', entityType: 'CAMPAIGN', entityId: c.id });
  await recordEvent(tx, ctx, 'CampaignResumed', c.id, { campaignId: c.id });
}

/** Ends the campaign: live prospects complete, pending messages are cancelled. A completed campaign never sends again. */
export async function completeCampaign(tx: Tx, ctx: ServiceContext, id: string, reason = 'Ended by a person') {
  const c = await loadCampaign(tx, ctx, id);
  await moveCampaign(tx, c, ['ACTIVE', 'PAUSED', 'BLOCKED'], { status: 'COMPLETED', completedAt: new Date(), statusReason: reason });
  const live = await tx.campaignEnrollment.findMany({ where: { campaignId: c.id, status: { in: LIVE_ENROLLMENT } }, select: { id: true } });
  await cancelPendingMessages(tx, ctx, live.map((e) => e.id), 'Campaign ended');
  await tx.campaignEnrollment.updateMany({ where: { campaignId: c.id, status: { in: LIVE_ENROLLMENT } }, data: { status: 'COMPLETED', completedAt: new Date(), nextStepDueAt: null } });
  await writeAudit(tx, ctx, { action: 'campaign.completed', entityType: 'CAMPAIGN', entityId: c.id, reason });
  await recordEvent(tx, ctx, 'CampaignCompleted', c.id, { campaignId: c.id, reason });
}

export async function archiveCampaign(tx: Tx, ctx: ServiceContext, id: string) {
  const c = await loadCampaign(tx, ctx, id);
  if (c.status === 'ACTIVE') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Pause or end the campaign before archiving it');
  await moveCampaign(tx, c, ['DRAFT', 'READY', 'PAUSED', 'COMPLETED', 'BLOCKED'], { status: 'ARCHIVED' });
  if (c.status === 'PAUSED' || c.status === 'BLOCKED') {
    const live = await tx.campaignEnrollment.findMany({ where: { campaignId: c.id, status: { in: LIVE_ENROLLMENT } }, select: { id: true } });
    await cancelPendingMessages(tx, ctx, live.map((e) => e.id), 'Campaign archived');
    await tx.campaignEnrollment.updateMany({ where: { campaignId: c.id, status: { in: LIVE_ENROLLMENT } }, data: { status: 'REMOVED', statusReason: 'Campaign archived', nextStepDueAt: null } });
  }
  await writeAudit(tx, ctx, { action: 'campaign.archived', entityType: 'CAMPAIGN', entityId: c.id });
  await recordEvent(tx, ctx, 'CampaignArchived', c.id, { campaignId: c.id });
}

const PENDING_ACTION = ['PREPARED', 'WAITING_APPROVAL', 'APPROVED', 'QUEUED', 'WAITING'] as const;

/** Cancels every not-yet-sent message of these enrollments: the action, its approval, the message (one transaction). */
export async function cancelPendingMessages(tx: Tx, ctx: ServiceContext, enrollmentIds: string[], reason: string): Promise<number> {
  if (!enrollmentIds.length) return 0;
  const messages = await tx.campaignMessage.findMany({ where: { enrollmentId: { in: enrollmentIds }, status: { in: ['PENDING_APPROVAL', 'WAITING', 'QUEUED'] } } });
  let cancelled = 0;
  for (const m of messages) {
    if (m.externalActionId) {
      const { count } = await tx.externalAction.updateMany({ where: { id: m.externalActionId, status: { in: [...PENDING_ACTION] } }, data: { status: 'CANCELLED', statusReason: reason, version: { increment: 1 } } });
      if (count === 1) {
        await tx.approvalRequest.updateMany({ where: { externalActionId: m.externalActionId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date(), decisionNote: reason } });
        await recordEvent(tx, ctx, 'ExternalActionCancelled', m.externalActionId, { externalActionId: m.externalActionId, actionType: 'email.send', reason });
      }
    }
    await tx.campaignMessage.update({ where: { id: m.id }, data: { status: 'CANCELLED', statusReason: reason } });
    cancelled++;
  }
  return cancelled;
}

/** A person removes a prospect: nothing more is sent to them by this campaign. */
export async function removeEnrollment(tx: Tx, ctx: ServiceContext, enrollmentId: string, reason: string) {
  const e = await tx.campaignEnrollment.findFirst({ where: { id: enrollmentId, workspaceId: ctx.workspaceId } });
  if (!e) throw new NotFoundError('Prospect not found in this campaign');
  if (!LIVE_ENROLLMENT.includes(e.status)) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `This prospect is already ${e.status.toLowerCase()}`);
  await cancelPendingMessages(tx, ctx, [e.id], reason);
  await tx.campaignEnrollment.update({ where: { id: e.id }, data: { status: 'REMOVED', statusReason: reason, nextStepDueAt: null } });
  await writeAudit(tx, ctx, { action: 'campaign.prospect_removed', entityType: 'CAMPAIGN_ENROLLMENT', entityId: e.id, reason });
  await recordEvent(tx, ctx, 'EnrollmentRemoved', e.id, { enrollmentId: e.id, campaignId: e.campaignId, reason });
}
