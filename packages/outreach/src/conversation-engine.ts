import { buildCompanyContext, conversationAgent, checkReply, inboxAgent, runAgentTask, type InboxReading, type ReplyContext, type ReplyDraft, type ThreadContext } from '@revenue-os/ai';
import type { Conversation, ConversationReply, ExternalAction, Prisma, PrismaClient, ReplyStatus } from '@revenue-os/database';
import type { ServiceContext, Tx } from '@revenue-os/domain';
import { recordEvent, type Revalidator } from '@revenue-os/events';
import { addSuppression, requestExternalAction } from '@revenue-os/policy';
import { INTENT_INFO, NON_HUMAN_INTENTS, readMessage, type Intent, type MessageReading } from '@revenue-os/shared';
import { categorize, nextStage, priorityOf, REPLY_INTENTS, waitingAfter } from './conversation-rules.js';
import type { OutreachDeps } from './engine.js';

const DAY_MS = 86_400_000;
const system = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'SYSTEM', id: null } });
const aiActor = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'AI_AGENT', id: null } });
const TX = { timeout: 30_000, maxWait: 10_000 } as const;

/** One reply = one key (docs/11 §21); the execution guard parses it back. */
export const replyKey = (conversationId: string, replyId: string) => `conversation:${conversationId}:reply:${replyId}`;
export function parseReplyKey(key: string): { conversationId: string; replyId: string } | null {
  const m = /^conversation:([0-9a-f-]{36}):reply:([0-9a-f-]{36})$/.exec(key);
  return m ? { conversationId: m[1]!, replyId: m[2]! } : null;
}

/** Structured context: field → the latest value with where it came from. */
export type ConversationContextMap = Record<string, { value: string; quote: string; messageId: string; at: string }>;
const contextOf = (c: Pick<Conversation, 'context'>) => (c.context ?? {}) as ConversationContextMap;

// ───────────────────────────── context for the agents ─────────────────────────────

async function threadContext(db: PrismaClient, conv: Conversation, messageId: string, now: Date): Promise<ThreadContext> {
  const [base, messages, campaign, mailbox] = await Promise.all([
    buildCompanyContext(db, conv.workspaceId, conv.companyId, now),
    db.conversationMessage.findMany({ where: { conversationId: conv.id }, orderBy: { occurredAt: 'asc' } }),
    conv.campaignId ? db.campaign.findUnique({ where: { id: conv.campaignId }, select: { offer: true, objective: true, senderName: true } }) : null,
    db.integration.findFirst({ where: { id: conv.mailboxIntegrationId, workspaceId: conv.workspaceId }, select: { name: true } }),
  ]);
  const message = messages.find((m) => m.id === messageId);
  if (!message) throw new Error(`Message ${messageId} is not in conversation ${conv.id}`);
  const upTo = messages.filter((m) => m.occurredAt <= message.occurredAt && m.id !== message.id);
  const known = Object.fromEntries(Object.entries(contextOf(conv)).map(([k, v]) => [k, v.value]));
  return {
    ...base,
    conversation: { id: conv.id, subject: conv.subject, stage: conv.stage, contactName: conv.contactName, offer: campaign?.offer?.trim() || null, objective: campaign?.objective ?? null, senderName: campaign?.senderName || mailbox?.name || '', known },
    thread: upTo.slice(-8).map((m) => ({ direction: m.direction, author: m.author, text: m.text, at: m.occurredAt.toISOString() })),
    message: { id: message.id, subject: message.subject, text: message.text, at: message.occurredAt.toISOString(), from: message.fromEmail ?? conv.email },
    now: now.toISOString(),
  };
}

async function firstNameOf(db: PrismaClient, conv: Conversation): Promise<string | null> {
  if (conv.enrollmentId) {
    const e = await db.campaignEnrollment.findUnique({ where: { id: conv.enrollmentId }, select: { firstName: true } });
    if (e?.firstName) return e.firstName;
  }
  if (conv.personId) {
    const p = await db.person.findFirst({ where: { id: conv.personId, workspaceId: conv.workspaceId }, select: { firstName: true } });
    if (p?.firstName) return p.firstName;
  }
  return conv.contactName?.split(/\s+/)[0] ?? null;
}

// ───────────────────────────── process one inbound message ─────────────────────────────

export type ProcessOutcome = 'NOT_FOUND' | 'ALREADY_PROCESSED' | 'CLASSIFIED' | 'DRAFTED' | 'REPLY_REQUESTED';

/**
 * The incoming reply pipeline (screen #5 §4, docs/17 §77-86): the cold sequence was already stopped when the message
 * arrived; now read it (rules for unsubscribes and away messages, the Inbox Agent for everything a person wrote),
 * update the structured context, then draft — and in AUTO mode ask the Policy Engine to send — or escalate.
 * Idempotent per message: a retried job reuses the stored reading and the finished agent tasks.
 */
export async function processConversationMessage(deps: OutreachDeps, job: { workspaceId: string; conversationId: string; messageId: string }): Promise<ProcessOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const msg = await db.conversationMessage.findFirst({ where: { id: job.messageId, conversationId: job.conversationId, workspaceId: job.workspaceId }, include: { classification: true, conversation: true } });
  if (!msg || msg.direction !== 'INBOUND') return 'NOT_FOUND';
  if (msg.classification) return 'ALREADY_PROCESSED';
  const conv = msg.conversation;

  let reading: MessageReading;
  let method = 'RULES';
  let agentTaskId: string | null = null;
  const rules = readMessage({ text: msg.text, subject: msg.subject, from: msg.fromEmail ?? undefined }, now);
  if (msg.kind === 'UNSUBSCRIBE') {
    // No AI discretion over an unsubscribe (docs/10 §37-47).
    reading = { ...rules, primaryIntent: 'UNSUBSCRIBE', secondaryIntents: [], needsHuman: false, reason: '', riskFlags: [], confidence: 'HIGH', summary: 'Asked not to be contacted again' };
  } else if (msg.kind === 'AUTO_REPLY') {
    reading = { ...rules, primaryIntent: NON_HUMAN_INTENTS.includes(rules.primaryIntent) ? rules.primaryIntent : 'OUT_OF_OFFICE', needsHuman: false, reason: '', riskFlags: [] };
  } else {
    const ctx = await threadContext(db, conv, msg.id, now);
    const result = await runAgentTask({ db, providers: deps.providers, now: deps.now }, inboxAgent, ctx, `message:${msg.id}`);
    const task = result.taskId ? await db.agentTask.findUnique({ where: { id: result.taskId } }) : null;
    agentTaskId = task?.id ?? null;
    if (task?.status === 'COMPLETED') {
      method = 'AI';
      reading = mergeWithRules(task.output as InboxReading, rules);
    } else {
      // No model, budget spent or the answer failed its checks: the rules' reading, but a person looks.
      method = 'RULES_FALLBACK';
      const why = task?.reasonSummary ?? result.detail ?? 'AI not available';
      reading = { ...rules, needsHuman: true, confidence: 'LOW', reason: `The AI could not read this message (${why.slice(0, 120)}) — a person should` };
    }
  }

  const applied = await db.$transaction((tx) => applyReading(tx, conv, msg.id, reading, method, agentTaskId, now), TX);
  if (!applied) return 'ALREADY_PROCESSED';
  const fresh = await db.conversation.findUniqueOrThrow({ where: { id: conv.id } });
  if (fresh.mode === 'HUMAN' || !REPLY_INTENTS.includes(reading.primaryIntent) || fresh.stage === 'SUPPRESSED' || fresh.stage === 'CLOSED') return 'CLASSIFIED';

  const reply = await draftConversationReply(deps, fresh.id, { messageId: msg.id, reading });
  if (reply?.status === 'DRAFT' && fresh.mode === 'AUTO' && canAutoSend(reading, reply)) {
    await submitReply(db, aiActor(conv.workspaceId), fresh.id, reply.id, { agent: true });
    return 'REPLY_REQUESTED';
  }
  return reply ? 'DRAFTED' : 'CLASSIFIED';
}

/**
 * AI proposes, rules decide: the deterministic risk words always count (union), an unsubscribe the rules saw wins, and
 * pricing, meetings, referrals and unclear messages always go to a person — whatever the model said.
 */
export function mergeWithRules(ai: InboxReading, rules: MessageReading): MessageReading {
  if (rules.primaryIntent === 'UNSUBSCRIBE') return { ...rules, needsHuman: false, riskFlags: [] };
  const riskFlags = [...new Set([...ai.riskFlags, ...rules.riskFlags])];
  const humanIntent = ['PRICING', 'MEETING_REQUEST', 'REFERRAL', 'WRONG_PERSON', 'UNKNOWN'].includes(ai.primaryIntent);
  const needsHuman = ai.needsHuman || humanIntent || riskFlags.length > 0 || ai.confidence === 'LOW';
  const reason = needsHuman ? ai.reason || rules.reason || (humanIntent ? `${INTENT_INFO[ai.primaryIntent].label} needs a person` : 'Needs a person') : '';
  return { ...ai, riskFlags, needsHuman, reason };
}

const HUMAN_RISKS = new Set(['LEGAL', 'REFUND', 'DISCOUNT', 'CUSTOM_PRICING', 'HUMAN_REQUESTED', 'ANGRY', 'COMMITMENT']);

/** AUTO mode still never sends something sensitive, uncertain or incomplete on its own. */
function canAutoSend(reading: MessageReading, reply: ConversationReply): boolean {
  return !reading.needsHuman && !reading.riskFlags.some((f) => HUMAN_RISKS.has(f)) && reply.unanswered.length === 0 && reply.confidence !== 'LOW';
}

/** Stores the reading, applies stated facts, moves the stage and recomputes category and priority — one transaction. */
async function applyReading(tx: Tx, conv: Conversation, messageId: string, r: MessageReading, method: string, agentTaskId: string | null, now: Date): Promise<boolean> {
  const ctx = system(conv.workspaceId);
  const { count } = await tx.messageClassification.createMany({
    data: [
      {
        workspaceId: conv.workspaceId,
        conversationId: conv.id,
        messageId,
        primaryIntent: r.primaryIntent,
        secondaryIntents: r.secondaryIntents,
        sentiment: r.sentiment,
        questions: r.questions,
        objections: r.objections as Prisma.InputJsonValue,
        riskFlags: r.riskFlags,
        needsHuman: r.needsHuman,
        confidence: r.confidence,
        summary: r.summary.slice(0, 300),
        method,
        agentTaskId,
      },
    ],
    skipDuplicates: true,
  });
  if (count === 0) return false;
  const current = await tx.conversation.findUniqueOrThrow({ where: { id: conv.id } });

  // Stated facts with provenance: the latest statement supersedes, history stays (screen #5 §30-31).
  const context = { ...contextOf(current) };
  for (const f of r.extracted) {
    await tx.extractionCandidate.updateMany({ where: { conversationId: conv.id, field: f.field, status: 'APPLIED' }, data: { status: 'SUPERSEDED' } });
    await tx.extractionCandidate.create({ data: { workspaceId: conv.workspaceId, conversationId: conv.id, messageId, field: f.field, value: f.value.slice(0, 200), quote: f.quote.slice(0, 400), confidence: r.confidence } });
    context[f.field] = { value: f.value.slice(0, 200), quote: f.quote.slice(0, 400), messageId, at: now.toISOString() };
  }

  const intent = r.primaryIntent;
  const human = !NON_HUMAN_INTENTS.includes(intent);
  const stage = nextStage(current.stage, intent);
  const waitingOn = waitingAfter(intent, current.waitingOn);
  let snoozedUntil = current.snoozedUntil;
  if (intent === 'NOT_NOW') snoozedUntil = context.CONTACT_LATER ? new Date(`${context.CONTACT_LATER.value}T09:00:00.000Z`) : new Date(now.getTime() + 90 * DAY_MS);
  const needsHuman = human ? r.needsHuman : current.needsHuman;
  const escalationReason = human ? (r.needsHuman ? r.reason || 'Needs a person' : null) : current.escalationReason;
  const resolvedAt = stage === 'CLOSED' ? (current.resolvedAt ?? now) : human ? null : current.resolvedAt;
  const state = { stage, mode: current.mode, waitingOn, needsHuman, primaryIntent: human ? intent : current.primaryIntent, snoozedUntil, resolvedAt };
  const { priority, reasons } = priorityOf({ primaryIntent: state.primaryIntent, needsHuman, riskFlags: r.riskFlags, waitingOn, stage });

  await tx.conversation.update({
    where: { id: conv.id },
    data: {
      ...state,
      category: categorize(state, now),
      escalationReason,
      priority,
      priorityReasons: reasons,
      ...(human ? { sentiment: r.sentiment, summary: r.summary.slice(0, 300) } : {}),
      context: context as Prisma.InputJsonValue,
      version: { increment: 1 },
    },
  });

  // Side effects the rules own.
  if (intent === 'UNSUBSCRIBE') {
    await addSuppression(tx, ctx, { scope: 'EMAIL', value: conv.email, reason: 'UNSUBSCRIBED', note: 'Asked to unsubscribe in a conversation', source: 'REPLY' });
    await cancelPendingReplies(tx, ctx, conv.id, 'They unsubscribed', { aiOnly: false });
  }
  if (intent === 'OUT_OF_OFFICE' && r.returnDate && conv.enrollmentId) {
    // Away: the cold sequence (if still running) waits until the day after they are back (screen #5 §8).
    const resume = new Date(`${r.returnDate}T09:00:00.000Z`).getTime() + DAY_MS;
    await tx.campaignEnrollment.updateMany({ where: { id: conv.enrollmentId, status: 'ACTIVE', nextStepDueAt: { lt: new Date(resume) } }, data: { nextStepDueAt: new Date(resume), statusReason: `Out of office until ${r.returnDate}` } });
  }
  if (human) {
    // A newer message makes unsent AI drafts and pending AI replies obsolete.
    await tx.conversationReply.updateMany({ where: { conversationId: conv.id, status: 'DRAFT', author: 'AI', inReplyToMessageId: { not: messageId } }, data: { status: 'SUPERSEDED', statusReason: 'A newer message arrived' } });
    await cancelPendingReplies(tx, ctx, conv.id, 'A newer message arrived — the reply was out of date', { aiOnly: true, exceptMessageId: messageId });
  }

  await recordEvent(tx, ctx, 'ConversationMessageClassified', conv.id, { conversationId: conv.id, messageId, primaryIntent: intent, method, needsHuman: r.needsHuman });
  if (human && r.needsHuman && !current.needsHuman) await recordEvent(tx, ctx, 'ConversationEscalated', conv.id, { conversationId: conv.id, reason: (r.reason || 'Needs a person').slice(0, 300) });
  return true;
}

// ───────────────────────────── drafting ─────────────────────────────

/**
 * The Conversation Agent drafts an answer to the latest inbound message (or the one given). A draft that fails its
 * checks is kept as REJECTED with the reason and the conversation goes to a person — nothing ungrounded is sent.
 * `requestId` makes a fresh draft when a person asks again.
 */
export async function draftConversationReply(deps: OutreachDeps, conversationId: string, opts: { messageId?: string; reading?: MessageReading; requestId?: string } = {}): Promise<ConversationReply | null> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  const msg = opts.messageId
    ? await db.conversationMessage.findFirst({ where: { id: opts.messageId, conversationId }, include: { classification: true } })
    : await db.conversationMessage.findFirst({ where: { conversationId, direction: 'INBOUND', author: 'PROSPECT', NOT: { kind: 'AUTO_REPLY' } }, orderBy: { occurredAt: 'desc' }, include: { classification: true } });
  if (!msg) return null;
  const c = msg.classification;
  const reading = opts.reading ?? (c ? { primaryIntent: c.primaryIntent as Intent, secondaryIntents: c.secondaryIntents as Intent[], questions: c.questions, objections: c.objections as MessageReading['objections'], riskFlags: c.riskFlags as MessageReading['riskFlags'] } : readMessage({ text: msg.text, subject: msg.subject }, now));

  const ctx: ReplyContext = {
    ...(await threadContext(db, conv, msg.id, now)),
    reading: { primaryIntent: reading.primaryIntent, secondaryIntents: reading.secondaryIntents, questions: reading.questions, objections: reading.objections, riskFlags: reading.riskFlags },
    recipient: { firstName: await firstNameOf(db, conv) },
  };
  const key = opts.requestId ? `reply:${msg.id}:${opts.requestId}` : `reply:${msg.id}`;
  const result = await runAgentTask({ db, providers: deps.providers, now: deps.now }, conversationAgent, ctx, key);
  const task = result.taskId ? await db.agentTask.findUnique({ where: { id: result.taskId } }) : null;

  return db.$transaction(async (tx) => {
    const sctx = aiActor(conv.workspaceId);
    // The same task never makes two drafts (a retried job finds the one it already stored).
    if (task) {
      const existing = await tx.conversationReply.findFirst({ where: { conversationId, agentTaskId: task.id } });
      if (existing) return existing;
    }
    if (task?.status === 'COMPLETED') {
      const out = task.output as ReplyDraft;
      await tx.conversationReply.updateMany({ where: { conversationId, status: 'DRAFT', author: 'AI' }, data: { status: 'SUPERSEDED', statusReason: 'A newer draft was made' } });
      const reply = await tx.conversationReply.create({
        data: {
          workspaceId: conv.workspaceId,
          conversationId,
          inReplyToMessageId: msg.id,
          author: 'AI',
          agentTaskId: task.id,
          subject: out.subject,
          body: out.body,
          answered: out.answered as Prisma.InputJsonValue,
          unanswered: out.unanswered,
          claims: out.claims as Prisma.InputJsonValue,
          validation: checkReply(out, ctx) as unknown as Prisma.InputJsonValue,
          confidence: out.confidence,
          status: 'DRAFT',
          statusReason: out.needsHuman ? out.reason || 'Needs a person' : null,
        },
      });
      if (out.needsHuman || out.unanswered.length) await escalateTx(tx, sctx, conv.id, out.unanswered.length ? `The AI could not answer: ${out.unanswered.join(' / ').slice(0, 200)}` : out.reason || 'The reply needs a person');
      await recordEvent(tx, sctx, 'ConversationReplyDrafted', conv.id, { conversationId: conv.id, replyId: reply.id, author: 'AI', status: 'DRAFT' });
      return reply;
    }
    const reason = task?.status === 'BLOCKED' ? `The AI is not available: ${task.reasonSummary ?? ''}`.trim() : `The AI draft failed its checks: ${task?.reasonSummary ?? result.detail ?? 'unknown'}`;
    let reply: ConversationReply | null = null;
    if (task && task.status !== 'BLOCKED') {
      reply = await tx.conversationReply.create({
        data: { workspaceId: conv.workspaceId, conversationId, inReplyToMessageId: msg.id, author: 'AI', agentTaskId: task.id, subject: conv.subject, body: '', status: 'REJECTED', statusReason: reason.slice(0, 500) },
      });
      await recordEvent(tx, sctx, 'ConversationReplyDrafted', conv.id, { conversationId: conv.id, replyId: reply.id, author: 'AI', status: 'REJECTED' });
    }
    await escalateTx(tx, sctx, conv.id, `${reason.slice(0, 200)} — reply yourself`);
    return reply;
  }, TX);
}

async function escalateTx(tx: Tx, ctx: ServiceContext, conversationId: string, reason: string) {
  const c = await tx.conversation.findUniqueOrThrow({ where: { id: conversationId } });
  if (c.stage === 'SUPPRESSED' || c.stage === 'CLOSED') return;
  const state = { ...c, needsHuman: true };
  const { priority, reasons } = priorityOf({ primaryIntent: c.primaryIntent, needsHuman: true, riskFlags: [], waitingOn: c.waitingOn, stage: c.stage });
  await tx.conversation.update({ where: { id: c.id }, data: { needsHuman: true, escalationReason: reason.slice(0, 300), category: categorize(state), priority: Math.max(priority, c.priority), priorityReasons: c.needsHuman ? c.priorityReasons : [...new Set([...c.priorityReasons, ...reasons])], version: { increment: 1 } } });
  if (!c.needsHuman) await recordEvent(tx, ctx, 'ConversationEscalated', c.id, { conversationId: c.id, reason: reason.slice(0, 300) });
}

// ───────────────────────────── sending ─────────────────────────────

function replyStatusFor(status: ExternalAction['status']): ReplyStatus {
  switch (status) {
    case 'WAITING_APPROVAL':
      return 'PENDING_APPROVAL';
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
    default:
      return 'QUEUED';
  }
}

/**
 * Asks to send one reply (email.reply). The AI asks as the Conversation Agent; a person as themselves — the Policy
 * Engine decides either way (ACT / ASK / WAIT / BLOCK) and the worker revalidates right before the provider call.
 */
export async function submitReply(db: PrismaClient, ctx: ServiceContext, conversationId: string, replyId: string, opts: { agent: boolean; signature?: string }) {
  const conv = await db.conversation.findFirstOrThrow({ where: { id: conversationId, workspaceId: ctx.workspaceId } });
  const reply = await db.conversationReply.findFirstOrThrow({ where: { id: replyId, conversationId } });
  const mailbox = await db.integration.findFirstOrThrow({ where: { id: conv.mailboxIntegrationId, workspaceId: conv.workspaceId } });
  const campaign = conv.campaignId ? await db.campaign.findUnique({ where: { id: conv.campaignId }, select: { senderName: true } }) : null;
  const lastInbound = await db.conversationMessage.findFirst({ where: { conversationId, direction: 'INBOUND', internetMessageId: { not: null } }, orderBy: { occurredAt: 'desc' }, select: { internetMessageId: true } });
  const senderName = campaign?.senderName || mailbox.name;
  const signature = opts.signature?.trim() || senderName;
  const from = mailbox.accountRef.includes('@') ? mailbox.accountRef : 'outreach@test-mailbox.example';
  const payload: Record<string, unknown> = { from, fromName: senderName || undefined, to: [conv.email], subject: reply.subject, text: `${reply.body.trim()}\n\n${signature}` };
  if (conv.threadRef) payload.threadRef = conv.threadRef;
  if (lastInbound?.internetMessageId) payload.inReplyTo = lastInbound.internetMessageId;
  for (const k of Object.keys(payload)) if (payload[k] === undefined) delete payload[k];

  const { action } = await requestExternalAction(db, ctx, {
    actionType: 'email.reply',
    provider: mailbox.provider,
    providerAccountId: mailbox.id,
    entityType: conv.personId ? 'PERSON' : 'COMPANY',
    entityId: conv.personId ?? conv.companyId,
    idempotencyKey: replyKey(conv.id, reply.id),
    payload,
    ...(opts.agent ? { requestedByAgent: 'CONVERSATION' } : {}),
  });
  await db.conversationReply.updateMany({ where: { id: reply.id, externalActionId: null }, data: { externalActionId: action.id, status: replyStatusFor(action.status), statusReason: action.statusReason } });
  await settleConversationReply(db, action.id);
  return db.conversationReply.findUniqueOrThrow({ where: { id: reply.id } });
}

const PENDING_REPLY: ReplyStatus[] = ['PENDING_APPROVAL', 'WAITING', 'QUEUED'];
const PENDING_ACTION = ['PREPARED', 'WAITING_APPROVAL', 'APPROVED', 'QUEUED', 'WAITING'] as const;

/** Cancels replies that haven't gone out yet (the action, its approval, the reply) — takeover, unsubscribe, newer message. */
export async function cancelPendingReplies(tx: Tx, ctx: ServiceContext, conversationId: string, reason: string, opts: { aiOnly: boolean; exceptMessageId?: string }): Promise<number> {
  const pending = await tx.conversationReply.findMany({
    where: { conversationId, status: { in: PENDING_REPLY }, ...(opts.aiOnly ? { author: 'AI' as const } : {}), ...(opts.exceptMessageId ? { NOT: { inReplyToMessageId: opts.exceptMessageId } } : {}) },
  });
  let cancelled = 0;
  for (const r of pending) {
    if (r.externalActionId) {
      const { count } = await tx.externalAction.updateMany({ where: { id: r.externalActionId, status: { in: [...PENDING_ACTION] } }, data: { status: 'CANCELLED', statusReason: reason, version: { increment: 1 } } });
      if (count === 1) {
        await tx.approvalRequest.updateMany({ where: { externalActionId: r.externalActionId, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: new Date(), decisionNote: reason } });
        await recordEvent(tx, ctx, 'ExternalActionCancelled', r.externalActionId, { externalActionId: r.externalActionId, actionType: 'email.reply', reason });
      }
    }
    await tx.conversationReply.update({ where: { id: r.id }, data: { status: 'CANCELLED', statusReason: reason } });
    cancelled++;
  }
  return cancelled;
}

/**
 * Reply bookkeeping when its action changes state (runs with campaign.action.settled; non-reply actions are ignored).
 * Sent → it joins the thread and it's the prospect's turn. Blocked or failed → a person takes it from here.
 */
export async function settleConversationReply(db: PrismaClient, externalActionId: string, now = new Date()): Promise<string> {
  const reply = await db.conversationReply.findUnique({ where: { externalActionId } });
  if (!reply) return 'NOT_REPLY';
  const action = await db.externalAction.findUniqueOrThrow({ where: { id: externalActionId } });
  const next = replyStatusFor(action.status);
  if (reply.status === 'SENT' || (reply.status === next && reply.statusReason === action.statusReason)) return 'UNCHANGED';
  const ctx = system(reply.workspaceId);

  return db.$transaction(async (tx) => {
    if (next !== 'SENT') {
      // Our own cancellations (takeover, newer message, discard) already set a clearer reason on the reply.
      if (reply.status === 'CANCELLED' && next === 'CANCELLED') return 'UNCHANGED';
      await tx.conversationReply.update({ where: { id: reply.id }, data: { status: next, statusReason: action.statusReason } });
      if (next === 'BLOCKED' || next === 'FAILED' || (next === 'CANCELLED' && /reject|expired/i.test(action.statusReason ?? ''))) {
        await escalateTx(tx, ctx, reply.conversationId, `The reply was not sent (${(action.statusReason ?? next.toLowerCase()).slice(0, 160)})`);
      }
      return next;
    }
    const sentAt = action.executedAt ?? now;
    const meta = (action.responseMeta ?? {}) as { internetMessageId?: string; threadId?: string };
    const payload = action.payload as { from?: string; to?: string[]; text?: string };
    await tx.conversationReply.update({ where: { id: reply.id }, data: { status: 'SENT', statusReason: null, sentAt } });
    await tx.conversationMessage.createMany({
      data: [
        {
          workspaceId: reply.workspaceId,
          conversationId: reply.conversationId,
          direction: 'OUTBOUND',
          author: reply.author,
          authorUserId: reply.authorUserId,
          fromEmail: payload.from ?? null,
          toEmails: payload.to ?? [],
          subject: reply.subject,
          text: reply.body,
          replyId: reply.id,
          internetMessageId: meta.internetMessageId ?? null,
          occurredAt: sentAt,
        },
      ],
      skipDuplicates: true,
    });
    const c = await tx.conversation.findUniqueOrThrow({ where: { id: reply.conversationId } });
    // Answered: it's their turn now and any escalation is handled.
    const state = { stage: c.stage, mode: c.mode, waitingOn: 'PROSPECT' as const, needsHuman: false, primaryIntent: c.primaryIntent, snoozedUntil: c.snoozedUntil, resolvedAt: c.resolvedAt };
    const { priority, reasons } = priorityOf({ primaryIntent: c.primaryIntent, needsHuman: false, riskFlags: [], waitingOn: 'PROSPECT', stage: c.stage });
    await tx.conversation.update({
      where: { id: c.id },
      data: { ...state, category: categorize(state, now), escalationReason: null, priority, priorityReasons: reasons, lastOutboundAt: sentAt, lastMessageAt: sentAt > c.lastMessageAt ? sentAt : c.lastMessageAt, threadRef: c.threadRef ?? meta.threadId ?? null, version: { increment: 1 } },
    });
    await recordEvent(tx, ctx, 'ConversationReplySent', c.id, { conversationId: c.id, replyId: reply.id, externalActionId, author: reply.author });
    return 'SENT';
  }, TX);
}

// ───────────────────────────── execution guard ─────────────────────────────

/**
 * Conversation checks right before a reply is sent (docs/17 §77-86, docs/10 Critical Safety Tests "Human takeover
 * blocks AI reply"): an AI reply is cancelled once a person took over or a newer message made it obsolete; nothing goes
 * to a conversation that ended in an unsubscribe. Then the Policy Engine decides as for any action.
 */
export function withConversationGuard(inner: Revalidator): Revalidator {
  return async (view, db) => {
    const ref = parseReplyKey(view.idempotencyKey);
    if (ref) {
      const [conv, reply] = await Promise.all([
        db.conversation.findFirst({ where: { id: ref.conversationId, workspaceId: view.workspaceId }, select: { mode: true, stage: true } }),
        db.conversationReply.findFirst({ where: { id: ref.replyId, conversationId: ref.conversationId }, select: { author: true, createdAt: true, inReplyToMessageId: true, status: true } }),
      ]);
      if (!conv || !reply) return { ok: false, status: 'CANCELLED', reason: 'Conversation or reply no longer exists' };
      if (reply.status === 'CANCELLED' || reply.status === 'DISCARDED') return { ok: false, status: 'CANCELLED', reason: 'The reply was withdrawn' };
      if (conv.stage === 'SUPPRESSED') return { ok: false, status: 'BLOCKED', reason: 'They unsubscribed' };
      if (reply.author === 'AI') {
        if (conv.mode === 'HUMAN') return { ok: false, status: 'CANCELLED', reason: 'A person took over this conversation' };
        const newer = await db.conversationMessage.findFirst({ where: { conversationId: ref.conversationId, direction: 'INBOUND', author: 'PROSPECT', occurredAt: { gt: reply.createdAt }, NOT: { kind: 'AUTO_REPLY' } }, select: { id: true } });
        if (newer) return { ok: false, status: 'CANCELLED', reason: 'A newer message arrived — the reply was out of date' };
      }
    }
    return inner(view, db);
  };
}

// ───────────────────────────── sweep ─────────────────────────────

/** Snoozed / "not now" conversations whose time has come go back to a person, with the reason (screen #5 §9). */
export async function wakeSnoozedConversations(db: PrismaClient, now = new Date(), limit = 200): Promise<{ woken: number }> {
  const due = await db.conversation.findMany({ where: { snoozedUntil: { lte: now }, category: 'NURTURE' }, take: limit });
  let woken = 0;
  for (const c of due) {
    await db.$transaction(async (tx) => {
      const stage = c.stage === 'NURTURE' ? ('ENGAGED' as const) : c.stage;
      const state = { stage, mode: c.mode, waitingOn: 'US' as const, needsHuman: true, primaryIntent: c.primaryIntent, snoozedUntil: null, resolvedAt: c.resolvedAt };
      const { count } = await tx.conversation.updateMany({
        where: { id: c.id, version: c.version },
        data: { ...state, category: categorize(state, now), escalationReason: 'Time to get back in touch — refresh what you know first', version: { increment: 1 } },
      });
      if (count === 1) {
        woken++;
        await recordEvent(tx, system(c.workspaceId), 'ConversationEscalated', c.id, { conversationId: c.id, reason: 'Snooze ended' });
      }
    });
  }
  return { woken };
}
