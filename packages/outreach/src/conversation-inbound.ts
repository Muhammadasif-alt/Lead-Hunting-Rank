import type { CampaignEnrollment, Conversation, MailboxMessage, MailboxMessageKind, PrismaClient } from '@revenue-os/database';
import type { ServiceContext, Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { addSuppression } from '@revenue-os/policy';
import type { EmailMessage } from '@revenue-os/providers';
import { normalizeEmail } from '@revenue-os/shared';
import { LIVE_ENROLLMENT } from './campaigns.js';
import { categorize } from './conversation-rules.js';
import { recordReplyTx } from './engine.js';

/** Who sent an inbound email when no campaign prospect matched: an existing conversation, or a contact we hold. */
export interface KnownSender {
  conversationId: string | null;
  companyId: string;
  personId: string | null;
}

/**
 * Identify sender → resolve company (screen #5 §4): the same thread, then an open conversation with that address on
 * this mailbox, then a contact point we hold (a person's email through their current job, or a company email).
 * Unknown senders stay unmatched — the inbox never invents a company.
 */
export async function resolveKnownSender(db: PrismaClient, workspaceId: string, integrationId: string, m: EmailMessage): Promise<KnownSender | null> {
  if (m.threadId) {
    const byThread = await db.conversation.findUnique({ where: { mailboxIntegrationId_threadRef: { mailboxIntegrationId: integrationId, threadRef: m.threadId } } });
    if (byThread && byThread.workspaceId === workspaceId) return { conversationId: byThread.id, companyId: byThread.companyId, personId: byThread.personId };
  }
  const from = normalizeEmail(m.from);
  if (!from) return null;
  const open = await db.conversation.findFirst({ where: { workspaceId, mailboxIntegrationId: integrationId, email: from }, orderBy: { lastMessageAt: 'desc' } });
  if (open) return { conversationId: null, companyId: open.companyId, personId: open.personId };
  const point = await db.contactPoint.findFirst({ where: { workspaceId, type: 'EMAIL', normalizedValue: from, archivedAt: null }, orderBy: { updatedAt: 'desc' } });
  if (!point) return null;
  if (point.entityType === 'COMPANY') return { conversationId: null, companyId: point.entityId, personId: null };
  if (point.entityType === 'PERSON') {
    const job = await db.employment.findFirst({ where: { workspaceId, personId: point.entityId, isCurrent: true }, orderBy: { updatedAt: 'desc' } });
    if (job) return { conversationId: null, companyId: job.companyId, personId: point.entityId };
  }
  return null;
}

interface AttachInput {
  integration: { id: string; workspaceId: string; accountRef?: string | null };
  message: EmailMessage;
  row: MailboxMessage;
  kind: Exclude<MailboxMessageKind, 'UNMATCHED' | 'BOUNCE'>;
  text: string;
  enrollment: CampaignEnrollment | null;
  known: KnownSender | null;
}

/**
 * Puts an inbound email into its conversation, inside mailbox sync's transaction (docs/17 §77-86: InboundEvent →
 * dedupe → Message → Conversation resolution). Immediate protection comes first: a genuine reply stops every live cold
 * sequence to that address, an unsubscribe suppresses it — before any AI work is queued. Away messages only join a
 * conversation that already exists.
 */
export async function attachInboundTx(tx: Tx, ctx: ServiceContext, input: AttachInput): Promise<{ conversationId: string; messageId: string; created: boolean } | null> {
  const { integration, message: m, row, kind, enrollment: e } = input;
  const from = normalizeEmail(m.from) ?? m.from.toLowerCase();
  const at = new Date(m.occurredAt);

  // Immediate protection, whichever campaign or mailbox the cold emails came from.
  if (kind === 'REPLY') {
    const live = await tx.campaignEnrollment.findMany({ where: { workspaceId: ctx.workspaceId, email: from, status: { in: [...LIVE_ENROLLMENT, 'COMPLETED'] }, ...(e ? { id: { not: e.id } } : {}) } });
    for (const other of live) await recordReplyTx(tx, ctx, other, row.id, at);
  }
  if (kind === 'UNSUBSCRIBE' && !e) await addSuppression(tx, ctx, { scope: 'EMAIL', value: from, reason: 'UNSUBSCRIBED', note: 'Asked to unsubscribe by reply', source: 'REPLY' });

  let conv: Conversation | null = null;
  if (m.threadId) conv = await tx.conversation.findUnique({ where: { mailboxIntegrationId_threadRef: { mailboxIntegrationId: integration.id, threadRef: m.threadId } } });
  if (!conv && input.known?.conversationId) conv = await tx.conversation.findFirst({ where: { id: input.known.conversationId, workspaceId: ctx.workspaceId } });
  if (!conv && e) conv = await tx.conversation.findFirst({ where: { workspaceId: ctx.workspaceId, enrollmentId: e.id }, orderBy: { createdAt: 'desc' } });
  if (conv && conv.workspaceId !== ctx.workspaceId) return null;

  let created = false;
  if (!conv) {
    if (kind === 'AUTO_REPLY') return null; // not a person talking to us — no new conversation
    const companyId = e?.companyId ?? input.known?.companyId;
    if (!companyId) return null;
    const campaign = e ? await tx.campaign.findUnique({ where: { id: e.campaignId }, select: { id: true } }) : null;
    const snap = (e?.eligibilitySnapshot ?? {}) as { name?: string };
    const mode = await defaultMode(tx, ctx.workspaceId);
    conv = await tx.conversation.create({
      data: {
        workspaceId: ctx.workspaceId,
        companyId,
        personId: e?.personId ?? input.known?.personId ?? null,
        email: from,
        contactName: snap.name ?? e?.firstName ?? null,
        mailboxIntegrationId: integration.id,
        threadRef: m.threadId || null,
        subject: m.subject.replace(/^\s*(re|fw|fwd)\s*:\s*/i, '').slice(0, 300) || '(no subject)',
        campaignId: campaign?.id ?? null,
        enrollmentId: e?.id ?? null,
        mode,
        lastMessageAt: at,
      },
    });
    created = true;
    // The cold emails that led here, so the thread reads from the start (screen #5 §44).
    if (e) {
      const sent = await tx.campaignMessage.findMany({ where: { enrollmentId: e.id, status: 'SENT' }, orderBy: { position: 'asc' } });
      if (sent.length) {
        await tx.conversationMessage.createMany({
          data: sent.map((s) => ({
            workspaceId: ctx.workspaceId,
            conversationId: conv!.id,
            direction: 'OUTBOUND' as const,
            author: 'AI' as const,
            fromEmail: integration.accountRef?.includes('@') ? integration.accountRef : null,
            toEmails: [e.email],
            subject: s.subject,
            text: s.body,
            campaignMessageId: s.id,
            occurredAt: s.sentAt ?? s.createdAt,
          })),
          skipDuplicates: true,
        });
      }
    }
    await recordEvent(tx, ctx, 'ConversationStarted', conv.id, { conversationId: conv.id, companyId, campaignId: conv.campaignId, enrollmentId: conv.enrollmentId });
  }

  const msg = await tx.conversationMessage.create({
    data: {
      workspaceId: ctx.workspaceId,
      conversationId: conv.id,
      direction: 'INBOUND',
      author: 'PROSPECT',
      fromEmail: m.from.slice(0, 320),
      toEmails: m.to.slice(0, 20),
      subject: m.subject.slice(0, 500),
      text: input.text.slice(0, 20_000) || m.text.slice(0, 20_000),
      kind,
      mailboxMessageId: row.id,
      internetMessageId: m.internetMessageId ?? null,
      occurredAt: at,
    },
  });

  // Whose turn it is, right away; the intent (and the AI) refine it when the message is processed.
  const human = kind !== 'AUTO_REPLY';
  const unsubscribed = kind === 'UNSUBSCRIBE';
  const state = {
    stage: unsubscribed ? ('SUPPRESSED' as const) : conv.stage,
    mode: conv.mode,
    waitingOn: unsubscribed ? ('NOBODY' as const) : human ? ('US' as const) : conv.waitingOn,
    needsHuman: unsubscribed ? false : conv.needsHuman,
    primaryIntent: unsubscribed ? 'UNSUBSCRIBE' : conv.primaryIntent,
    snoozedUntil: human ? null : conv.snoozedUntil,
    resolvedAt: human && !unsubscribed ? null : conv.resolvedAt,
  };
  await tx.conversation.update({
    where: { id: conv.id },
    data: {
      ...state,
      category: categorize(state, at),
      ...(human ? { lastInboundAt: at } : {}),
      lastMessageAt: at > conv.lastMessageAt ? at : conv.lastMessageAt,
      version: { increment: 1 },
    },
  });
  await recordEvent(tx, ctx, 'ConversationMessageReceived', conv.id, { conversationId: conv.id, messageId: msg.id, kind });
  return { conversationId: conv.id, messageId: msg.id, created };
}

/**
 * New conversations follow the workspace autonomy: AUTO from L3 (routine conversations are L3 work), otherwise ASSIST —
 * the AI drafts and a person sends. A person can switch any conversation at any time.
 */
async function defaultMode(tx: Tx, workspaceId: string): Promise<'AUTO' | 'ASSIST'> {
  const ws = await tx.workspace.findUnique({ where: { id: workspaceId }, select: { autonomyLevel: true } });
  return ws && ['L3', 'L4'].includes(ws.autonomyLevel) ? 'AUTO' : 'ASSIST';
}
