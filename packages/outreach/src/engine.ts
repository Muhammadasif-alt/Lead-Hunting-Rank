import { createHash } from 'node:crypto';
import { buildCompanyContext, campaignAgent, runAgentTask, type DraftContext } from '@revenue-os/ai';
import type { CampaignEnrollment, CampaignMessageStatus, ExternalAction, PrismaClient } from '@revenue-os/database';
import { writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent, type Revalidator } from '@revenue-os/events';
import { requestExternalAction } from '@revenue-os/policy';
import type { ProviderGateway } from '@revenue-os/providers';
import { cancelPendingMessages, LIVE_ENROLLMENT, type CampaignStrategy } from './campaigns.js';

export interface OutreachDeps {
  db: PrismaClient;
  providers: ProviderGateway;
  /** Public web origin for unsubscribe links, e.g. https://app.example.com */
  publicUrl: string;
  now?: () => Date;
}

const DAY_MS = 86_400_000;
const system = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'SYSTEM', id: null } });
const aiActor = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'AI_AGENT', id: null } });

/** One logical email = one key (docs/11 §21). The guard and the settle handler parse it back. */
export const messageKey = (campaignId: string, enrollmentId: string, position: number) => `campaign:${campaignId}:enrollment:${enrollmentId}:step:${position}`;
export function parseMessageKey(key: string): { campaignId: string; enrollmentId: string; position: number } | null {
  const m = /^campaign:([0-9a-f-]{36}):enrollment:([0-9a-f-]{36}):step:(\d+)$/.exec(key);
  return m ? { campaignId: m[1]!, enrollmentId: m[2]!, position: Number(m[3]) } : null;
}

/** One-click unsubscribe endpoint (RFC 8058 POST; a browser GET is redirected to a confirmation page). */
export const unsubscribeUrl = (publicUrl: string, token: string) => `${publicUrl.replace(/\/$/, '')}/api/v1/public/unsubscribe/${token}`;
export const OPT_OUT_LINE = 'If you’d rather not hear from me, just reply “unsubscribe”.';

/** A few hours of spread so follow-ups don't all leave at the same minute (screen #6 §20 variable gap). */
function jitterMs(enrollmentId: string, position: number) {
  return (parseInt(createHash('sha256').update(`${enrollmentId}:${position}`).digest('hex').slice(0, 6), 16) % 240) * 60_000;
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

// ───────────────────────────── scheduler ─────────────────────────────

/**
 * Durable schedule (docs/11 §31-34): Postgres says which step is due; this sweep makes sure a prepare job exists for
 * each. First emails respect the campaign's daily limit; follow-ups are not throttled here (the policy daily limit
 * and send window still apply). Idempotent — the job id and the prepare step dedupe.
 */
export async function sweepCampaigns(db: PrismaClient, enqueue: (job: { workspaceId: string; enrollmentId: string; position: number }) => Promise<void>, now = new Date()) {
  const due = await db.campaignEnrollment.findMany({
    where: { status: 'ACTIVE', nextStepDueAt: { lte: now }, campaign: { status: 'ACTIVE' } },
    select: { id: true, workspaceId: true, campaignId: true, nextStepPosition: true, campaign: { select: { dailyNewLimit: true } } },
    orderBy: { nextStepDueAt: 'asc' },
    take: 500,
  });
  const firstToday = new Map<string, number>();
  let queued = 0;
  for (const e of due) {
    if (e.nextStepPosition === 1) {
      if (!firstToday.has(e.campaignId)) {
        firstToday.set(e.campaignId, await db.campaignMessage.count({ where: { campaignId: e.campaignId, position: 1, createdAt: { gte: startOfUtcDay(now) } } }));
      }
      const used = firstToday.get(e.campaignId)!;
      if (used >= e.campaign.dailyNewLimit) continue;
      firstToday.set(e.campaignId, used + 1);
    }
    await enqueue({ workspaceId: e.workspaceId, enrollmentId: e.id, position: e.nextStepPosition });
    queued++;
  }
  return { due: due.length, queued };
}

// ───────────────────────────── prepare one step ─────────────────────────────

export type PrepareOutcome = 'PREPARED' | 'ALREADY_PREPARED' | 'NOT_DUE' | 'CAMPAIGN_NOT_ACTIVE' | 'ENROLLMENT_NOT_ACTIVE' | 'COMPLETED' | 'BLOCKED' | 'WAITING_FOR_AI' | 'DRAFT_REJECTED';

async function setEnrollment(tx: Tx | PrismaClient, e: Pick<CampaignEnrollment, 'id' | 'workspaceId' | 'campaignId'>, status: 'BLOCKED' | 'COMPLETED' | 'REMOVED' | 'SUPPRESSED', reason: string | null) {
  const { count } = await tx.campaignEnrollment.updateMany({
    where: { id: e.id, status: { in: LIVE_ENROLLMENT } },
    data: { status, statusReason: reason, nextStepDueAt: null, ...(status === 'COMPLETED' ? { completedAt: new Date() } : {}), version: { increment: 1 } },
  });
  return count === 1;
}

async function enrollmentEvent(tx: Tx, e: Pick<CampaignEnrollment, 'id' | 'workspaceId' | 'campaignId'>, status: 'BLOCKED' | 'COMPLETED' | 'REMOVED' | 'SUPPRESSED', reason: string) {
  const ctx = system(e.workspaceId);
  const base = { enrollmentId: e.id, campaignId: e.campaignId };
  if (status === 'BLOCKED') await recordEvent(tx, ctx, 'EnrollmentBlocked', e.id, { ...base, reason });
  else if (status === 'SUPPRESSED') await recordEvent(tx, ctx, 'EnrollmentSuppressed', e.id, { ...base, reason });
  else if (status === 'REMOVED') await recordEvent(tx, ctx, 'EnrollmentRemoved', e.id, { ...base, reason });
  else await recordEvent(tx, ctx, 'EnrollmentCompleted', e.id, base);
}

async function endEnrollment(db: PrismaClient, e: Pick<CampaignEnrollment, 'id' | 'workspaceId' | 'campaignId'>, status: 'BLOCKED' | 'COMPLETED' | 'REMOVED' | 'SUPPRESSED', reason: string) {
  await db.$transaction(async (tx) => {
    if (await setEnrollment(tx, e, status, reason)) await enrollmentEvent(tx, e, status, reason);
  });
}

/**
 * One step for one prospect (screen #6 §13, docs/11 §31-34): reload current state → re-check the prospect → the
 * Campaign Agent drafts → validators → Policy Engine (ACT / ASK / WAIT / BLOCK) → ExternalAction. A follow-up never
 * fires blindly: a reply, an unsubscribe, a paused campaign or an invalid email ends it here.
 */
export async function prepareStep(deps: OutreachDeps, job: { workspaceId: string; enrollmentId: string; position: number }): Promise<PrepareOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const e = await db.campaignEnrollment.findFirst({ where: { id: job.enrollmentId, workspaceId: job.workspaceId }, include: { campaign: { include: { steps: { orderBy: { position: 'asc' } } } } } });
  if (!e) return 'ENROLLMENT_NOT_ACTIVE';
  const c = e.campaign;
  if (c.status !== 'ACTIVE') return 'CAMPAIGN_NOT_ACTIVE';
  if (e.status !== 'ACTIVE') return 'ENROLLMENT_NOT_ACTIVE';
  if (e.nextStepPosition !== job.position) return 'NOT_DUE';
  const step = c.steps.find((s) => s.position === job.position);
  if (!step) {
    await endEnrollment(db, e, 'COMPLETED', 'Sequence finished');
    return 'COMPLETED';
  }
  if (await db.campaignMessage.findUnique({ where: { enrollmentId_stepId: { enrollmentId: e.id, stepId: step.id } } })) return 'ALREADY_PREPARED';

  // Fresh eligibility (screen #6 §13): still an active company, still a usable address?
  const [company, point] = await Promise.all([
    db.company.findFirst({ where: { id: e.companyId, workspaceId: e.workspaceId }, select: { status: true, mergedIntoId: true } }),
    e.contactPointId ? db.contactPoint.findFirst({ where: { id: e.contactPointId, workspaceId: e.workspaceId }, select: { status: true, archivedAt: true } }) : null,
  ]);
  if (!company || company.status === 'ARCHIVED' || company.mergedIntoId) {
    await endEnrollment(db, e, 'REMOVED', 'The company was archived or merged');
    return 'BLOCKED';
  }
  if (point && (point.status === 'INVALID' || point.archivedAt)) {
    await endEnrollment(db, e, 'BLOCKED', 'The email address is no longer valid');
    return 'BLOCKED';
  }
  const mailbox = c.mailboxIntegrationId ? await db.integration.findFirst({ where: { id: c.mailboxIntegrationId, workspaceId: e.workspaceId } }) : null;
  if (!mailbox) {
    await endEnrollment(db, e, 'BLOCKED', 'The campaign has no mailbox');
    return 'BLOCKED';
  }

  // Draft (idempotent per step: a retried job reuses the finished agent task).
  const previous = await db.campaignMessage.findMany({ where: { enrollmentId: e.id, status: 'SENT' }, orderBy: { position: 'asc' }, select: { position: true, subject: true, body: true, externalActionId: true, threadRef: true } });
  const strategy = (c.strategy ?? {}) as CampaignStrategy;
  const base = await buildCompanyContext(db, e.workspaceId, e.companyId, now);
  const snap = (e.eligibilitySnapshot ?? {}) as { name?: string; title?: string };
  const ctx: DraftContext = {
    ...base,
    campaign: { name: c.name, objective: c.objective, offer: c.offer, cta: strategy.cta ?? null, tone: strategy.tone ?? null, avoid: strategy.avoid ?? [], senderName: c.senderName },
    recipient: { firstName: e.firstName, name: snap.name ?? null, title: snap.title ?? null, email: e.email },
    step: { position: step.position, kind: step.kind, angle: step.angle, total: c.steps.length },
    previous: previous.map((p) => ({ position: p.position, subject: p.subject, body: p.body })),
  };
  const key = messageKey(c.id, e.id, step.position);
  const draft = await runAgentTask({ db, providers: deps.providers, now: deps.now }, campaignAgent, ctx, key);
  const task = draft.taskId ? await db.agentTask.findUnique({ where: { id: draft.taskId } }) : null;
  if (task?.status !== 'COMPLETED') {
    if (task?.status === 'BLOCKED') {
      // No model, budget spent or agent off: try again later — nothing is sent without a validated draft.
      await db.campaignEnrollment.updateMany({ where: { id: e.id, status: 'ACTIVE' }, data: { nextStepDueAt: new Date(now.getTime() + 60 * 60_000), statusReason: `Waiting for AI: ${task.reasonSummary ?? 'not available'}`.slice(0, 300) } });
      return 'WAITING_FOR_AI';
    }
    const reason = `AI draft rejected: ${task?.reasonSummary ?? draft.detail ?? 'unknown'}`.slice(0, 500);
    await db.$transaction(async (tx) => {
      await tx.campaignMessage.createMany({
        data: [{ workspaceId: e.workspaceId, campaignId: c.id, enrollmentId: e.id, stepId: step.id, position: step.position, agentTaskId: task?.id ?? null, subject: '(no draft)', body: '', status: 'DRAFT_REJECTED', statusReason: reason }],
        skipDuplicates: true,
      });
      if (await setEnrollment(tx, e, 'BLOCKED', reason)) await enrollmentEvent(tx, e, 'BLOCKED', reason);
    });
    return 'DRAFT_REJECTED';
  }
  const out = task.output as { subject: string; body: string; claims: unknown[] };

  // Signature and the plain-text opt-out are added by the system, not the AI.
  const text = `${out.body.trim()}\n\n${c.senderName || mailbox.name}\n\n${OPT_OUT_LINE}`;
  const prev = previous.at(-1);
  const prevAction = prev?.externalActionId ? await db.externalAction.findUnique({ where: { id: prev.externalActionId }, select: { responseMeta: true } }) : null;
  const inReplyTo = (prevAction?.responseMeta as { internetMessageId?: string } | null)?.internetMessageId;
  const from = mailbox.accountRef.includes('@') ? mailbox.accountRef : 'outreach@test-mailbox.example';
  const payload: Record<string, unknown> = { from, fromName: c.senderName || undefined, to: [e.email], subject: out.subject, text, unsubscribeUrl: unsubscribeUrl(deps.publicUrl, e.unsubscribeToken) };
  if (e.threadRef) payload.threadRef = e.threadRef;
  if (inReplyTo) payload.inReplyTo = inReplyTo;
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

  // The AI asks; the Policy Engine decides (and the worker decides again right before sending).
  const { action, decision } = await requestExternalAction(db, aiActor(e.workspaceId), {
    actionType: 'email.send',
    provider: mailbox.provider,
    providerAccountId: mailbox.id,
    entityType: e.personId ? 'PERSON' : 'COMPANY',
    entityId: e.personId ?? e.companyId,
    idempotencyKey: key,
    payload,
    requestedByAgent: 'CAMPAIGN',
  });
  await db.$transaction(async (tx) => {
    const { count } = await tx.campaignMessage.createMany({
      data: [{ workspaceId: e.workspaceId, campaignId: c.id, enrollmentId: e.id, stepId: step.id, position: step.position, agentTaskId: task.id, externalActionId: action.id, subject: out.subject, body: out.body, claims: out.claims as object[], status: messageStatusFor(action.status) ?? 'QUEUED', statusReason: action.statusReason }],
      skipDuplicates: true,
    });
    await tx.campaignEnrollment.updateMany({ where: { id: e.id, status: 'ACTIVE' }, data: { nextStepDueAt: null, statusReason: null } });
    if (count === 1) {
      const msg = await tx.campaignMessage.findUniqueOrThrow({ where: { enrollmentId_stepId: { enrollmentId: e.id, stepId: step.id } } });
      await recordEvent(tx, aiActor(e.workspaceId), 'CampaignMessageDrafted', msg.id, { messageId: msg.id, enrollmentId: e.id, campaignId: c.id, position: step.position, decision: decision?.decision ?? action.status });
    }
  });
  // The action may already have been decided (or even sent) — bring the message and enrollment up to date.
  await settleCampaignAction(db, action.id, now);
  return 'PREPARED';
}

function messageStatusFor(status: ExternalAction['status']): CampaignMessageStatus | null {
  switch (status) {
    case 'WAITING_APPROVAL':
      return 'PENDING_APPROVAL';
    case 'PREPARED':
    case 'APPROVED':
    case 'QUEUED':
    case 'EXECUTING':
    case 'UNKNOWN_OUTCOME':
      return 'QUEUED';
    case 'WAITING':
      return 'WAITING';
    case 'SUCCEEDED':
      return 'SENT';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'CANCELLED':
      return 'CANCELLED';
    case 'FAILED':
      return 'FAILED';
  }
}

const SUPPRESSION_HINT = /suppress|do-not-contact|unsubscrib/i;

/**
 * Campaign bookkeeping when its outbound action changes state (job campaign.action.settled). Sent → the next step is
 * scheduled from the send time (or the prospect completes). Blocked/cancelled/failed → the prospect stops, with the
 * reason. Idempotent and safe to run for any action — non-campaign actions are ignored.
 */
export async function settleCampaignAction(db: PrismaClient, externalActionId: string, now = new Date()): Promise<string> {
  const msg = await db.campaignMessage.findUnique({ where: { externalActionId }, include: { enrollment: true } });
  if (!msg) return 'NOT_CAMPAIGN';
  const action = await db.externalAction.findUniqueOrThrow({ where: { id: externalActionId } });
  const next = messageStatusFor(action.status);
  if (!next || msg.status === 'SENT') return 'UNCHANGED';
  const e = msg.enrollment;

  return db.$transaction(async (tx) => {
    if (next !== 'SENT') {
      if (msg.status === next && msg.statusReason === action.statusReason) return 'UNCHANGED';
      await tx.campaignMessage.update({ where: { id: msg.id }, data: { status: next, statusReason: action.statusReason } });
      if (next === 'BLOCKED' || next === 'CANCELLED' || next === 'FAILED') {
        const reason = action.statusReason ?? `Message ${next.toLowerCase()}`;
        // A pause or stop the campaign itself caused doesn't end the prospect; everything else does, with the reason.
        const status = SUPPRESSION_HINT.test(reason) ? 'SUPPRESSED' : 'BLOCKED';
        if (e.status === 'ACTIVE' && !/^Campaign (ended|archived)/.test(reason) && (await setEnrollment(tx, e, status, reason))) await enrollmentEvent(tx, e, status, reason);
      }
      return next;
    }
    const meta = (action.responseMeta ?? {}) as { threadId?: string };
    const sentAt = action.executedAt ?? now;
    await tx.campaignMessage.update({ where: { id: msg.id }, data: { status: 'SENT', statusReason: null, providerMessageId: action.responseRef, threadRef: meta.threadId ?? null, sentAt } });
    await tx.campaignEnrollment.update({ where: { id: e.id }, data: { lastSentAt: sentAt, threadRef: e.threadRef ?? meta.threadId ?? null } });
    if (e.status !== 'ACTIVE') return 'SENT';
    const following = await tx.campaignStep.findUnique({ where: { campaignId_position: { campaignId: msg.campaignId, position: msg.position + 1 } } });
    if (following) {
      await tx.campaignEnrollment.updateMany({
        where: { id: e.id, status: 'ACTIVE', nextStepPosition: msg.position },
        data: { nextStepPosition: following.position, nextStepDueAt: new Date(sentAt.getTime() + following.delayDays * DAY_MS + jitterMs(e.id, following.position)) },
      });
    } else if (await setEnrollment(tx, e, 'COMPLETED', 'Sequence finished')) {
      await enrollmentEvent(tx, e, 'COMPLETED', 'Sequence finished');
    }
    return 'SENT';
  });
}

// ───────────────────────────── execution guard ─────────────────────────────

/**
 * Campaign checks right before a campaign email is sent (docs/11 §34): campaign active? prospect still in the sequence
 * (not replied, unsubscribed, removed)? Then the Policy Engine decides as for any action. A paused campaign waits.
 */
export function withCampaignGuard(inner: Revalidator): Revalidator {
  return async (view, db) => {
    const ref = parseMessageKey(view.idempotencyKey);
    if (ref) {
      const [c, e] = await Promise.all([
        db.campaign.findFirst({ where: { id: ref.campaignId, workspaceId: view.workspaceId }, select: { status: true } }),
        db.campaignEnrollment.findFirst({ where: { id: ref.enrollmentId, workspaceId: view.workspaceId }, select: { status: true } }),
      ]);
      if (!c || !e) return { ok: false, status: 'CANCELLED', reason: 'Campaign or prospect no longer exists' };
      if (c.status === 'PAUSED') return { ok: false, status: 'WAITING', reason: 'Campaign paused', resumeAt: new Date(Date.now() + 15 * 60_000) };
      if (c.status !== 'ACTIVE') return { ok: false, status: 'CANCELLED', reason: `Campaign ${c.status.toLowerCase()}` };
      if (e.status !== 'ACTIVE') {
        return { ok: false, status: 'CANCELLED', reason: e.status === 'REPLIED' ? 'Prospect replied — the cold sequence stopped' : `Prospect ${e.status.toLowerCase()}` };
      }
    }
    return inner(view, db);
  };
}

// ───────────────────────────── replies ─────────────────────────────

/**
 * A genuine reply (docs/09 §28-33 ACTIVE→REPLIED): the campaign loses the cold sequence for good — pending follow-ups
 * are cancelled in the same transaction. Phase 12's conversation engine takes over from here.
 */
export async function recordReplyTx(tx: Tx, ctx: ServiceContext, e: Pick<CampaignEnrollment, 'id' | 'workspaceId' | 'campaignId' | 'companyId' | 'status'>, mailboxMessageId: string | null, at = new Date()) {
  if (!['ENROLLED', 'ACTIVE', 'PAUSED', 'COMPLETED'].includes(e.status)) return false;
  const { count } = await tx.campaignEnrollment.updateMany({
    where: { id: e.id, status: { in: ['ENROLLED', 'ACTIVE', 'PAUSED', 'COMPLETED'] } },
    data: { status: 'REPLIED', repliedAt: at, nextStepDueAt: null, statusReason: 'Replied', version: { increment: 1 } },
  });
  if (count !== 1) return false;
  await cancelPendingMessages(tx, ctx, [e.id], 'Prospect replied — the cold sequence stopped');
  await writeAudit(tx, ctx, { action: 'campaign.prospect_replied', entityType: 'CAMPAIGN_ENROLLMENT', entityId: e.id, after: { mailboxMessageId } });
  await recordEvent(tx, ctx, 'EnrollmentReplied', e.id, { enrollmentId: e.id, campaignId: e.campaignId, companyId: e.companyId, mailboxMessageId });
  return true;
}
