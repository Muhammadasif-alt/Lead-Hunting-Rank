import type { CampaignEnrollment, MailboxMessageKind, PrismaClient } from '@revenue-os/database';
import { writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { addSuppression } from '@revenue-os/policy';
import type { EmailMessage, ProviderGateway } from '@revenue-os/providers';
import { normalizeEmail, parseReturnDate } from '@revenue-os/shared';
import { cancelPendingMessages, LIVE_ENROLLMENT } from './campaigns.js';
import { attachInboundTx, resolveKnownSender } from './conversation-inbound.js';
import { recordReplyTx } from './engine.js';

const system = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'SYSTEM', id: null } });

/** The part a person actually wrote: quoted history ("> …", "On … wrote:") is cut off. */
export function ownText(text: string): string {
  const lines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*>/.test(line) || /^On .{4,200} wrote:\s*$/i.test(line.trim()) || /^-{2,}\s*Original Message/i.test(line.trim())) break;
    lines.push(line);
  }
  return lines.join('\n').trim();
}

const BOUNCE_FROM = /^(mailer-daemon|postmaster)@/i;
const BOUNCE_SUBJECT = /\b(undeliverable|undelivered|delivery (status notification|has failed|failure)|mail delivery (failed|subsystem)|returned mail|failure notice)\b/i;
const AUTO_SUBJECT = /\b(automatic reply|auto[- ]?reply|autoreply|out of (the )?office|away from (the )?office|on (vacation|holiday|leave))\b/i;
const UNSUBSCRIBE = /\b(unsubscribe|remove me|take me off|stop (emailing|sending|contacting|messaging)|do not (email|contact|message)|don'?t (email|contact|message) me|opt[- ]?out)\b/i;

/**
 * Deterministic classification of an inbound email for the cold sequence (docs/10 §37-47: an unsubscribe is handled
 * with no AI discretion). Anything else a person wrote is a genuine reply; Phase 12 classifies intent on top.
 */
export function classifyInbound(m: Pick<EmailMessage, 'from' | 'subject' | 'text'>): Exclude<MailboxMessageKind, 'UNMATCHED'> {
  if (BOUNCE_FROM.test(m.from) || BOUNCE_SUBJECT.test(m.subject)) return 'BOUNCE';
  if (AUTO_SUBJECT.test(m.subject)) return 'AUTO_REPLY';
  if (UNSUBSCRIBE.test(ownText(m.text).slice(0, 500)) || /^\s*unsubscribe\s*$/i.test(m.subject)) return 'UNSUBSCRIBE';
  return 'REPLY';
}

type EnrollmentRow = CampaignEnrollment;

/** Which prospect an inbound email belongs to: same thread first, then the sender's address (bounces: the address quoted). */
async function matchEnrollment(db: PrismaClient, workspaceId: string, integrationId: string, m: EmailMessage, kind: string): Promise<EnrollmentRow | null> {
  const scope = { workspaceId, campaign: { mailboxIntegrationId: integrationId } };
  if (m.threadId) {
    const byThread = await db.campaignEnrollment.findFirst({ where: { ...scope, OR: [{ threadRef: m.threadId }, { messages: { some: { threadRef: m.threadId } } }] }, orderBy: { lastSentAt: { sort: 'desc', nulls: 'last' } } });
    if (byThread) return byThread;
  }
  if (kind === 'BOUNCE') {
    const quoted = [...new Set((m.text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? []).map((x) => normalizeEmail(x)).filter((x): x is string => !!x))];
    if (!quoted.length) return null;
    return db.campaignEnrollment.findFirst({ where: { ...scope, email: { in: quoted }, lastSentAt: { not: null } }, orderBy: { lastSentAt: 'desc' } });
  }
  const from = normalizeEmail(m.from);
  if (!from) return null;
  return db.campaignEnrollment.findFirst({ where: { ...scope, email: from, lastSentAt: { not: null } }, orderBy: { lastSentAt: 'desc' } });
}

/**
 * Applies one inbound email. Deduplicated per mailbox — seeing the same message twice does nothing the second time.
 * Stop rules first, then the message joins its conversation (Phase 12) — all in one transaction, so no follow-up can
 * slip out between a reply arriving and the AI reading it.
 */
export async function applyInbound(
  db: PrismaClient,
  integration: { id: string; workspaceId: string; accountRef?: string | null },
  m: EmailMessage,
): Promise<{ kind: MailboxMessageKind; enrollmentId: string | null; conversationId: string | null } | null> {
  if (m.direction !== 'INBOUND') return null;
  const ctx = system(integration.workspaceId);
  const kind0 = classifyInbound(m);
  const e = await matchEnrollment(db, integration.workspaceId, integration.id, m, kind0);
  // Not a campaign prospect: maybe someone we already talk to, or a contact we hold.
  const known = !e && kind0 !== 'BOUNCE' ? await resolveKnownSender(db, integration.workspaceId, integration.id, m) : null;
  const kind: MailboxMessageKind = e || known || kind0 === 'BOUNCE' ? kind0 : 'UNMATCHED';

  return db.$transaction(async (tx) => {
    const { count } = await tx.mailboxMessage.createMany({
      data: [
        {
          workspaceId: integration.workspaceId,
          integrationId: integration.id,
          providerMessageId: m.messageId,
          threadRef: m.threadId || null,
          fromEmail: m.from.slice(0, 320),
          toEmails: m.to.slice(0, 20),
          subject: m.subject.slice(0, 500),
          snippet: ownText(m.text).slice(0, 2000),
          occurredAt: new Date(m.occurredAt),
          kind,
          campaignId: e?.campaignId ?? null,
          enrollmentId: e?.id ?? null,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) return null; // already processed
    const row = await tx.mailboxMessage.findUniqueOrThrow({ where: { integrationId_providerMessageId: { integrationId: integration.id, providerMessageId: m.messageId } } });

    if (e) {
      if (kind === 'REPLY') await recordReplyTx(tx, ctx, e, row.id, new Date(m.occurredAt));
      else if (kind === 'UNSUBSCRIBE') await suppressTx(tx, ctx, e, 'UNSUBSCRIBED', 'REPLY', 'Asked to unsubscribe by reply');
      else if (kind === 'BOUNCE') {
        if (e.contactPointId) await tx.contactPoint.updateMany({ where: { id: e.contactPointId, workspaceId: e.workspaceId }, data: { status: 'INVALID', version: { increment: 1 } } });
        await suppressTx(tx, ctx, e, 'BOUNCE_POLICY', 'BOUNCE', 'The email bounced');
      } else if (kind === 'AUTO_REPLY' && e.status === 'ACTIVE') {
        // Away until a stated date: the next step waits until the day after they are back (screen #5 §8). No date → unchanged.
        const back = parseReturnDate(`${m.subject}\n${m.text}`, new Date(m.occurredAt));
        const resume = back ? new Date(new Date(`${back}T09:00:00.000Z`).getTime() + 86_400_000) : null;
        if (resume) await tx.campaignEnrollment.updateMany({ where: { id: e.id, status: 'ACTIVE', nextStepDueAt: { lt: resume } }, data: { nextStepDueAt: resume, statusReason: `Out of office until ${back}` } });
      }
    }
    await recordEvent(tx, ctx, 'MailboxMessageReceived', row.id, { mailboxMessageId: row.id, integrationId: integration.id, kind, enrollmentId: e?.id ?? null });
    const attached =
      kind === 'REPLY' || kind === 'UNSUBSCRIBE' || kind === 'AUTO_REPLY'
        ? await attachInboundTx(tx, ctx, { integration, message: m, row, kind, text: ownText(m.text), enrollment: e, known })
        : null;
    return { kind, enrollmentId: e?.id ?? null, conversationId: attached?.conversationId ?? null };
  });
}

/**
 * Unsubscribe or bounce: the address goes on the do-not-contact list (which cancels every pending message to it,
 * in any campaign) and this prospect's sequence ends for good.
 */
async function suppressTx(tx: Tx, ctx: ServiceContext, e: EnrollmentRow, reason: 'UNSUBSCRIBED' | 'BOUNCE_POLICY', source: string, note: string) {
  await addSuppression(tx, ctx, { scope: 'EMAIL', value: e.email, reason, note, source });
  await cancelPendingMessages(tx, ctx, [e.id], note);
  const status = reason === 'UNSUBSCRIBED' ? 'SUPPRESSED' : 'BLOCKED';
  const { count } = await tx.campaignEnrollment.updateMany({
    where: { id: e.id, status: { in: [...LIVE_ENROLLMENT, 'COMPLETED', 'REPLIED'] } },
    data: { status, statusReason: note, nextStepDueAt: null, version: { increment: 1 } },
  });
  if (count === 1) {
    const base = { enrollmentId: e.id, campaignId: e.campaignId, reason: note };
    await recordEvent(tx, ctx, status === 'SUPPRESSED' ? 'EnrollmentSuppressed' : 'EnrollmentBlocked', e.id, base);
  }
}

/**
 * One-click unsubscribe (RFC 8058 List-Unsubscribe-Post, docs/10 §37-47): no login, no AI, no questions. Idempotent —
 * clicking twice is fine. Returns false for an unknown token (which reveals nothing).
 */
export async function unsubscribeByToken(db: PrismaClient, token: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return false;
  const e = await db.campaignEnrollment.findUnique({ where: { unsubscribeToken: token } });
  if (!e) return false;
  await db.$transaction(async (tx) => {
    const ctx = system(e.workspaceId);
    await suppressTx(tx, ctx, e, 'UNSUBSCRIBED', 'UNSUBSCRIBE_LINK', 'Unsubscribed with the link');
    await writeAudit(tx, ctx, { action: 'campaign.unsubscribed', entityType: 'CAMPAIGN_ENROLLMENT', entityId: e.id, after: { source: 'link' } });
  });
  return true;
}

/** A person marks a prospect as replied (they answered by phone, or in a mailbox we don't read). */
export async function markReplied(db: PrismaClient, ctx: ServiceContext, enrollmentId: string) {
  const e = await db.campaignEnrollment.findFirst({ where: { id: enrollmentId, workspaceId: ctx.workspaceId } });
  if (!e) return false;
  return db.$transaction((tx) => recordReplyTx(tx, ctx, e, null));
}

/** A person records an unsubscribe they received some other way. */
export async function markUnsubscribed(db: PrismaClient, ctx: ServiceContext, enrollmentId: string) {
  const e = await db.campaignEnrollment.findFirst({ where: { id: enrollmentId, workspaceId: ctx.workspaceId } });
  if (!e) return false;
  await db.$transaction((tx) => suppressTx(tx, ctx, e, 'UNSUBSCRIBED', 'MANUAL', 'Marked unsubscribed by a person'));
  return true;
}

/**
 * Mailbox sync (job mailbox.sync, docs/11 §61): new inbound mail since the stored cursor → applyInbound. Polling and a
 * future webhook may both see a message; the unique (mailbox, provider message id) makes that harmless.
 */
export async function syncMailbox(db: PrismaClient, providers: ProviderGateway, integration: { id: string; workspaceId: string; accountRef?: string | null }, maxPages = 5) {
  let cursor = (await db.mailboxCursor.findUnique({ where: { integrationId: integration.id } }))?.cursor ?? null;
  let seen = 0;
  const kinds: Record<string, number> = {};
  for (let page = 0; page < maxPages; page++) {
    const { value } = await providers.call({ workspaceId: integration.workspaceId, capability: 'EMAIL_READ', operation: 'list_changes', integrationId: integration.id }, (email, options) => email.listChanges(cursor, options));
    for (const m of value.messages) {
      const r = await applyInbound(db, integration, m);
      if (r) {
        seen++;
        kinds[r.kind] = (kinds[r.kind] ?? 0) + 1;
      }
    }
    const moved = value.cursor !== cursor;
    cursor = value.cursor;
    await db.mailboxCursor.upsert({ where: { integrationId: integration.id }, create: { integrationId: integration.id, workspaceId: integration.workspaceId, cursor }, update: { cursor } });
    if (!moved || value.messages.length === 0) break;
  }
  return { seen, kinds };
}

/** Every mailbox a live (or recently ended) campaign sends from, and every mailbox with an open conversation. */
export async function syncAllMailboxes(db: PrismaClient, providers: ProviderGateway) {
  const campaigns = await db.campaign.findMany({ where: { status: { in: ['ACTIVE', 'PAUSED', 'COMPLETED', 'BLOCKED'] }, mailboxIntegrationId: { not: null } }, select: { mailboxIntegrationId: true }, distinct: ['mailboxIntegrationId'] });
  const talking = await db.conversation.findMany({ where: { category: { not: 'CLOSED' } }, select: { mailboxIntegrationId: true }, distinct: ['mailboxIntegrationId'] });
  const ids = [...new Set([...campaigns.map((c) => c.mailboxIntegrationId!), ...talking.map((c) => c.mailboxIntegrationId)])];
  const mailboxes = await db.integration.findMany({
    where: { id: { in: ids }, capabilities: { has: 'EMAIL_READ' }, status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] } },
    select: { id: true, workspaceId: true, accountRef: true },
  });
  const results: { integrationId: string; seen?: number; error?: string }[] = [];
  for (const mb of mailboxes) {
    try {
      results.push({ integrationId: mb.id, ...(await syncMailbox(db, providers, mb)) });
    } catch (err) {
      results.push({ integrationId: mb.id, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
    }
  }
  return results;
}
