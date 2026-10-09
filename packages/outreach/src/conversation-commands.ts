import type { Conversation, ConversationMode, Prisma, PrismaClient } from '@revenue-os/database';
import { writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { addSuppression } from '@revenue-os/policy';
import { BusinessRuleError, ConflictError, NotFoundError, PolicyError, ValidationError } from '@revenue-os/shared';
import { cancelPendingReplies, submitReply, type ConversationContextMap } from './conversation-engine.js';
import { categorize, priorityOf } from './conversation-rules.js';

const TX = { timeout: 30_000, maxWait: 10_000 } as const;

async function load(tx: Tx | PrismaClient, ctx: ServiceContext, id: string) {
  const c = await tx.conversation.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!c) throw new NotFoundError('Conversation not found');
  return c;
}

/** Applies a change and recomputes category and priority from the result (the rules, not the caller, decide those). */
async function update(tx: Tx, c: Conversation, patch: Partial<Pick<Conversation, 'stage' | 'mode' | 'waitingOn' | 'needsHuman' | 'escalationReason' | 'snoozedUntil' | 'resolvedAt' | 'assignedToId' | 'takenOverById' | 'takenOverAt' | 'context' | 'lastMessageAt'>>, now = new Date()) {
  const next = { ...c, ...patch };
  const latest = await tx.messageClassification.findFirst({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' }, select: { riskFlags: true } });
  const { priority, reasons } = priorityOf({ primaryIntent: next.primaryIntent, needsHuman: next.needsHuman, riskFlags: next.needsHuman ? (latest?.riskFlags ?? []) : [], waitingOn: next.waitingOn, stage: next.stage });
  const { count } = await tx.conversation.updateMany({
    where: { id: c.id, version: c.version },
    data: { ...(patch as unknown as Prisma.ConversationUpdateManyMutationInput), category: categorize(next, now), priority, priorityReasons: reasons, version: { increment: 1 } },
  });
  if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This conversation just changed — reload and try again');
}

/**
 * AUTO / ASSIST / HUMAN (screen #5 §15-16). Switching to HUMAN is the one-action "Take Over": every AI reply that has
 * not gone out yet is cancelled in the same transaction (and the worker re-checks the mode before sending anyway).
 * AI drafts stay as suggestions. Returning to the AI keeps everything a person wrote in its context.
 */
export async function setConversationMode(db: PrismaClient, ctx: ServiceContext, id: string, mode: ConversationMode) {
  return db.$transaction(async (tx) => {
    const c = await load(tx, ctx, id);
    if (c.mode === mode) return { mode, cancelledReplies: 0 };
    const takeover = mode === 'HUMAN';
    const cancelled = takeover ? await cancelPendingReplies(tx, ctx, c.id, 'A person took over this conversation', { aiOnly: true }) : 0;
    const now = new Date();
    await update(tx, c, takeover ? { mode, takenOverById: ctx.actor.id, takenOverAt: now } : { mode, takenOverById: null, takenOverAt: null }, now);
    await writeAudit(tx, ctx, { action: takeover ? 'conversation.taken_over' : 'conversation.mode_changed', entityType: 'CONVERSATION', entityId: c.id, before: { mode: c.mode }, after: { mode, cancelledReplies: cancelled } });
    await recordEvent(tx, ctx, 'ConversationModeChanged', c.id, { conversationId: c.id, from: c.mode, to: mode, takeover, cancelledReplies: cancelled });
    return { mode, cancelledReplies: cancelled };
  }, TX);
}

/**
 * A person sends a reply (Smart Compose or their own words). When it started from an AI draft, the draft is kept as
 * "used, edited or not" — learning data, never auto-applied. The Policy Engine still decides (suppression, kill switch).
 */
export async function sendHumanReply(db: PrismaClient, ctx: ServiceContext, id: string, input: { body: string; subject?: string | null; fromReplyId?: string | null; signature?: string | null }) {
  const body = input.body.trim();
  if (!body) throw new ValidationError('Write a reply first', [{ path: 'body', message: 'Required' }]);
  const reply = await db.$transaction(async (tx) => {
    const c = await load(tx, ctx, id);
    if (c.stage === 'SUPPRESSED') throw new PolicyError('SUPPRESSED', 'They asked not to be contacted — no reply can be sent');
    const subject = (input.subject?.trim() || (/^re:/i.test(c.subject) ? c.subject : `Re: ${c.subject}`)).slice(0, 300);
    if (input.fromReplyId) {
      const draft = await tx.conversationReply.findFirst({ where: { id: input.fromReplyId, conversationId: c.id, status: 'DRAFT' } });
      if (draft) {
        const edited = draft.body.trim() !== body;
        await tx.conversationReply.update({ where: { id: draft.id }, data: { status: 'SUPERSEDED', statusReason: edited ? 'Sent by a person after editing' : 'Sent by a person as drafted' } });
      }
    }
    const latest = await tx.conversationMessage.findFirst({ where: { conversationId: c.id, direction: 'INBOUND' }, orderBy: { occurredAt: 'desc' }, select: { id: true } });
    const r = await tx.conversationReply.create({
      data: { workspaceId: c.workspaceId, conversationId: c.id, inReplyToMessageId: latest?.id ?? null, author: 'HUMAN', authorUserId: ctx.actor.id, subject, body, status: 'DRAFT' },
    });
    await writeAudit(tx, ctx, { action: 'conversation.reply_requested', entityType: 'CONVERSATION', entityId: c.id, after: { replyId: r.id, fromAiDraft: !!input.fromReplyId } });
    await recordEvent(tx, ctx, 'ConversationReplyDrafted', c.id, { conversationId: c.id, replyId: r.id, author: 'HUMAN', status: 'DRAFT' });
    return r;
  }, TX);
  return submitReply(db, ctx, id, reply.id, { agent: false, signature: input.signature ?? undefined });
}

/** Throws away a draft, or withdraws a reply still waiting for approval or its send time. */
export async function discardReply(db: PrismaClient, ctx: ServiceContext, id: string, replyId: string) {
  return db.$transaction(async (tx) => {
    const c = await load(tx, ctx, id);
    const r = await tx.conversationReply.findFirst({ where: { id: replyId, conversationId: c.id } });
    if (!r) throw new NotFoundError('Reply not found');
    if (r.status === 'PENDING_APPROVAL' || r.status === 'WAITING' || r.status === 'QUEUED') {
      if (r.externalActionId) {
        const { count } = await tx.externalAction.updateMany({ where: { id: r.externalActionId, status: { in: ['PREPARED', 'WAITING_APPROVAL', 'APPROVED', 'WAITING'] } }, data: { status: 'CANCELLED', statusReason: 'Withdrawn by a person', version: { increment: 1 } } });
        if (count !== 1) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'This reply is already being sent');
        await tx.approvalRequest.updateMany({ where: { externalActionId: r.externalActionId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date(), decisionNote: 'Withdrawn by a person' } });
        await recordEvent(tx, ctx, 'ExternalActionCancelled', r.externalActionId, { externalActionId: r.externalActionId, actionType: 'email.reply', reason: 'Withdrawn by a person' });
      }
    } else if (r.status !== 'DRAFT' && r.status !== 'REJECTED') {
      throw new BusinessRuleError('INVALID_STATE_TRANSITION', `This reply is ${r.status.toLowerCase()}`);
    }
    await tx.conversationReply.update({ where: { id: r.id }, data: { status: 'DISCARDED', statusReason: 'Discarded by a person' } });
    await writeAudit(tx, ctx, { action: 'conversation.reply_discarded', entityType: 'CONVERSATION_REPLY', entityId: r.id });
    return { ok: true };
  }, TX);
}

/** 👍 / 👎 with a reason on an AI reply (screen #5 §46). Stored for review; nothing changes automatically. */
export async function replyFeedback(db: PrismaClient, ctx: ServiceContext, id: string, replyId: string, input: { rating: 'UP' | 'DOWN'; reason?: string | null }) {
  const c = await load(db, ctx, id);
  const r = await db.conversationReply.findFirst({ where: { id: replyId, conversationId: c.id, author: 'AI' } });
  if (!r) throw new NotFoundError('AI reply not found');
  await db.conversationReply.update({ where: { id: r.id }, data: { feedback: { rating: input.rating, reason: input.reason ?? null, by: ctx.actor.id, at: new Date().toISOString() } } });
  return { ok: true };
}

/** Internal note (screen #5 §43): visible to the team and to the AI as context, never sent. */
export async function addNote(db: PrismaClient, ctx: ServiceContext, id: string, text: string) {
  const body = text.trim();
  if (!body) throw new ValidationError('Write a note first', [{ path: 'text', message: 'Required' }]);
  return db.$transaction(async (tx) => {
    const c = await load(tx, ctx, id);
    const m = await tx.conversationMessage.create({ data: { workspaceId: c.workspaceId, conversationId: c.id, direction: 'INTERNAL', author: 'HUMAN', authorUserId: ctx.actor.id, text: body.slice(0, 5000), occurredAt: new Date() } });
    await recordEvent(tx, ctx, 'ConversationNoteAdded', c.id, { conversationId: c.id, messageId: m.id });
    return { id: m.id };
  }, TX);
}

export async function resolveConversation(db: PrismaClient, ctx: ServiceContext, id: string, reason: string | null) {
  return db.$transaction(async (tx) => {
    const c = await load(tx, ctx, id);
    if (c.resolvedAt) return { ok: true };
    await cancelPendingReplies(tx, ctx, c.id, 'Conversation resolved', { aiOnly: true });
    await update(tx, c, { resolvedAt: new Date(), needsHuman: false, escalationReason: null, waitingOn: 'NOBODY' });
    await writeAudit(tx, ctx, { action: 'conversation.resolved', entityType: 'CONVERSATION', entityId: c.id, reason: reason ?? undefined });
    await recordEvent(tx, ctx, 'ConversationResolved', c.id, { conversationId: c.id, reason });
    return { ok: true };
  }, TX);
}

export async function reopenConversation(db: PrismaClient, ctx: ServiceContext, id: string) {
  return db.$transaction(async (tx) => {
    const c = await load(tx, ctx, id);
    if (c.stage === 'SUPPRESSED') throw new PolicyError('SUPPRESSED', 'They unsubscribed — this conversation stays closed');
    await update(tx, c, { resolvedAt: null, stage: c.stage === 'CLOSED' ? 'ENGAGED' : c.stage, snoozedUntil: null, waitingOn: 'US' });
    await writeAudit(tx, ctx, { action: 'conversation.reopened', entityType: 'CONVERSATION', entityId: c.id });
    await recordEvent(tx, ctx, 'ConversationReopened', c.id, { conversationId: c.id });
    return { ok: true };
  }, TX);
}

export async function snoozeConversation(db: PrismaClient, ctx: ServiceContext, id: string, until: Date) {
  if (until.getTime() <= Date.now()) throw new ValidationError('Pick a time in the future', [{ path: 'until', message: 'Must be in the future' }]);
  return db.$transaction(async (tx) => {
    const c = await load(tx, ctx, id);
    if (c.stage === 'SUPPRESSED' || c.resolvedAt) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Closed conversations can not be snoozed');
    await update(tx, c, { snoozedUntil: until });
    await writeAudit(tx, ctx, { action: 'conversation.snoozed', entityType: 'CONVERSATION', entityId: c.id, after: { until: until.toISOString() } });
    await recordEvent(tx, ctx, 'ConversationSnoozed', c.id, { conversationId: c.id, until: until.toISOString() });
    return { ok: true };
  }, TX);
}

export async function assignConversation(db: PrismaClient, ctx: ServiceContext, id: string, userId: string | null) {
  return db.$transaction(async (tx) => {
    const c = await load(tx, ctx, id);
    if (userId) {
      const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId } } });
      if (!member || member.status !== 'ACTIVE') throw new ValidationError('That person is not an active member of this workspace', [{ path: 'userId', message: 'Unknown member' }]);
    }
    await update(tx, c, { assignedToId: userId });
    await writeAudit(tx, ctx, { action: 'conversation.assigned', entityType: 'CONVERSATION', entityId: c.id, before: { assignedToId: c.assignedToId }, after: { assignedToId: userId } });
    await recordEvent(tx, ctx, 'ConversationAssigned', c.id, { conversationId: c.id, assignedToId: userId });
    return { ok: true };
  }, TX);
}

/** "Do not contact" from the thread: the address goes on the suppression list and nothing more is sent. */
export async function doNotContact(db: PrismaClient, ctx: ServiceContext, id: string, note: string | null) {
  return db.$transaction(async (tx) => {
    const c = await load(tx, ctx, id);
    await addSuppression(tx, ctx, { scope: 'EMAIL', value: c.email, reason: 'DO_NOT_CONTACT', note: note ?? 'Marked do-not-contact from the inbox', source: 'INBOX' });
    await cancelPendingReplies(tx, ctx, c.id, 'Marked do-not-contact', { aiOnly: false });
    await update(tx, c, { stage: 'SUPPRESSED', waitingOn: 'NOBODY', needsHuman: false, escalationReason: null });
    await writeAudit(tx, ctx, { action: 'conversation.do_not_contact', entityType: 'CONVERSATION', entityId: c.id, reason: note ?? undefined });
    return { ok: true };
  }, TX);
}

/** A person says a fact taken from the conversation is wrong: it is rejected and the previous statement (if any) returns. */
export async function rejectExtraction(db: PrismaClient, ctx: ServiceContext, id: string, extractionId: string) {
  return db.$transaction(async (tx) => {
    const c = await load(tx, ctx, id);
    const x = await tx.extractionCandidate.findFirst({ where: { id: extractionId, conversationId: c.id } });
    if (!x) throw new NotFoundError('Fact not found');
    if (x.status === 'REJECTED') return { ok: true };
    await tx.extractionCandidate.update({ where: { id: x.id }, data: { status: 'REJECTED', decidedById: ctx.actor.id } });
    const context = { ...((c.context ?? {}) as ConversationContextMap) };
    if (x.status === 'APPLIED') {
      const previous = await tx.extractionCandidate.findFirst({ where: { conversationId: c.id, field: x.field, status: 'SUPERSEDED' }, orderBy: { createdAt: 'desc' } });
      if (previous) {
        await tx.extractionCandidate.update({ where: { id: previous.id }, data: { status: 'APPLIED' } });
        context[x.field] = { value: previous.value, quote: previous.quote, messageId: previous.messageId, at: previous.createdAt.toISOString() };
      } else delete context[x.field];
      await update(tx, c, { context: context as Prisma.JsonValue });
    }
    await writeAudit(tx, ctx, { action: 'conversation.fact_rejected', entityType: 'CONVERSATION', entityId: c.id, after: { field: x.field, extractionId: x.id } });
    await recordEvent(tx, ctx, 'ConversationContextCorrected', c.id, { conversationId: c.id, extractionId: x.id, field: x.field });
    return { ok: true };
  }, TX);
}

export async function markConversationRead(db: PrismaClient, ctx: ServiceContext, id: string) {
  await db.conversation.updateMany({ where: { id, workspaceId: ctx.workspaceId }, data: { lastReadAt: new Date() } });
  return { ok: true };
}
