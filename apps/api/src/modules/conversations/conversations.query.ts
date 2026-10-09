import { Injectable } from '@nestjs/common';
import type { InboxCategory, Prisma } from '@revenue-os/database';
import { nextActionFor, withWaiting, type ConversationContextMap } from '@revenue-os/outreach';
import { INBOX_CATEGORIES, NotFoundError } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';

const OPEN_REPLY = ['DRAFT', 'REJECTED', 'PENDING_APPROVAL', 'WAITING', 'QUEUED', 'BLOCKED', 'FAILED'] as const;

/**
 * Read models for screen #5: the inbox (categories with counts, priority order — not unread time) and one thread with
 * its intelligence panel (intent, questions, stated facts, next action, why — never chain of thought).
 */
@Injectable()
export class ConversationsQuery {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, userId: string, q: { category?: InboxCategory; search?: string; mine?: boolean }) {
    const db = this.prisma.client;
    const now = new Date();
    const search = q.search?.trim();
    const where: Prisma.ConversationWhereInput = {
      workspaceId,
      ...(q.category ? { category: q.category } : { category: { not: 'CLOSED' } }),
      ...(q.mine ? { assignedToId: userId } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: 'insensitive' } },
              { subject: { contains: search, mode: 'insensitive' } },
              { contactName: { contains: search, mode: 'insensitive' } },
              { summary: { contains: search, mode: 'insensitive' } },
              { primaryIntent: { equals: search.toUpperCase().replace(/\s+/g, '_') } },
              { messages: { some: { text: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, grouped, waitingOnUs] = await Promise.all([
      db.conversation.findMany({ where, orderBy: [{ priority: 'desc' }, { lastMessageAt: 'desc' }], take: 200 }),
      db.conversation.groupBy({ by: ['category'], where: { workspaceId, ...(q.mine ? { assignedToId: userId } : {}) }, _count: true }),
      db.conversation.count({ where: { workspaceId, waitingOn: 'US', category: { notIn: ['CLOSED', 'NURTURE'] } } }),
    ]);
    const ids = rows.map((r) => r.id);
    const companyIds = [...new Set(rows.map((r) => r.companyId))];
    const [companies, lastMessages, pending, users] = await Promise.all([
      db.company.findMany({ where: { workspaceId, id: { in: companyIds } }, select: { id: true, displayName: true, industry: true, city: true } }),
      ids.length
        ? db.conversationMessage.findMany({ where: { conversationId: { in: ids }, direction: { not: 'INTERNAL' } }, orderBy: { occurredAt: 'desc' }, distinct: ['conversationId'], select: { conversationId: true, text: true, direction: true, author: true } })
        : [],
      db.conversationReply.groupBy({ by: ['conversationId', 'status'], where: { conversationId: { in: ids }, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } }, _count: true }),
      db.user.findMany({ where: { id: { in: rows.map((r) => r.assignedToId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
    ]);
    const items = rows
      .map((c) => {
        const last = lastMessages.find((m) => m.conversationId === c.id);
        const company = companies.find((x) => x.id === c.companyId);
        return {
          id: c.id,
          company: company ? { id: company.id, name: company.displayName, industry: company.industry, city: company.city } : null,
          contactName: c.contactName,
          email: c.email,
          subject: c.subject,
          category: c.category,
          stage: c.stage,
          mode: c.mode,
          waitingOn: c.waitingOn,
          priority: c.category === 'CLOSED' ? 0 : withWaiting(c.priority, c.waitingOn, c.lastInboundAt, now),
          priorityReasons: c.priorityReasons,
          needsHuman: c.needsHuman,
          escalationReason: c.escalationReason,
          primaryIntent: c.primaryIntent,
          sentiment: c.sentiment,
          summary: c.summary,
          snippet: last ? { text: last.text.replace(/\s+/g, ' ').slice(0, 160), direction: last.direction, author: last.author } : null,
          lastMessageAt: c.lastMessageAt,
          lastInboundAt: c.lastInboundAt,
          unread: !!c.lastInboundAt && (!c.lastReadAt || c.lastInboundAt > c.lastReadAt),
          snoozedUntil: c.snoozedUntil,
          assignedTo: users.find((u) => u.id === c.assignedToId) ?? null,
          draftReady: pending.some((p) => p.conversationId === c.id && p.status === 'DRAFT'),
          pendingApproval: pending.some((p) => p.conversationId === c.id && p.status === 'PENDING_APPROVAL'),
        };
      })
      .sort((a, b) => b.priority - a.priority || +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt));
    const counts = Object.fromEntries(INBOX_CATEGORIES.map((k) => [k, grouped.find((g) => g.category === k)?._count ?? 0])) as Record<InboxCategory, number>;
    return { counts, waitingOnUs, items };
  }

  async detail(workspaceId: string, id: string) {
    const db = this.prisma.client;
    const c = await db.conversation.findFirst({ where: { id, workspaceId } });
    if (!c) throw new NotFoundError('Conversation not found');
    const [company, person, campaign, enrollment, mailbox, messages, replies, extractions, events, workspace, members, assessment] = await Promise.all([
      db.company.findFirst({ where: { id: c.companyId, workspaceId }, select: { id: true, displayName: true, industry: true, city: true, region: true, websiteDomain: true, phone: true } }),
      c.personId ? db.person.findFirst({ where: { id: c.personId, workspaceId }, select: { id: true, fullName: true, employments: { where: { isCurrent: true }, select: { title: true }, take: 1 } } }) : null,
      c.campaignId ? db.campaign.findFirst({ where: { id: c.campaignId, workspaceId }, select: { id: true, name: true, offer: true, status: true } }) : null,
      c.enrollmentId ? db.campaignEnrollment.findFirst({ where: { id: c.enrollmentId, workspaceId }, select: { id: true, status: true, statusReason: true, repliedAt: true } }) : null,
      db.integration.findFirst({ where: { id: c.mailboxIntegrationId, workspaceId }, select: { id: true, name: true, provider: true, status: true, accountRef: true } }),
      db.conversationMessage.findMany({ where: { conversationId: c.id }, orderBy: { occurredAt: 'asc' }, include: { classification: true } }),
      db.conversationReply.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      db.extractionCandidate.findMany({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      db.domainEvent.findMany({ where: { workspaceId, aggregateType: 'CONVERSATION', aggregateId: c.id }, orderBy: { occurredAt: 'asc' }, take: 200, select: { id: true, eventType: true, payload: true, actorType: true, actorId: true, occurredAt: true } }),
      db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { autonomyLevel: true, outboundState: true } }),
      db.workspaceMember.findMany({ where: { workspaceId, status: 'ACTIVE' }, select: { user: { select: { id: true, name: true } } } }),
      db.companyAssessment.findFirst({ where: { workspaceId, companyId: c.companyId, dimension: 'PRIORITY', supersededAt: null }, select: { level: true, reasons: true } }),
    ]);
    const actionIds = replies.map((r) => r.externalActionId).filter((x): x is string => !!x);
    const actions = actionIds.length ? await db.externalAction.findMany({ where: { id: { in: actionIds } }, select: { id: true, status: true, statusReason: true, approvalRequestId: true, resumeAt: true } }) : [];
    const userIds = [...new Set([...messages.map((m) => m.authorUserId), ...replies.map((r) => r.authorUserId), c.takenOverById, ...events.map((e) => e.actorId)].filter((x): x is string => !!x))];
    const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const nameOf = (uid: string | null) => (uid ? (users.find((u) => u.id === uid)?.name ?? null) : null);

    const openReplies = replies.filter((r) => (OPEN_REPLY as readonly string[]).includes(r.status));
    const latestInbound = [...messages].reverse().find((m) => m.direction === 'INBOUND' && m.kind !== 'AUTO_REPLY');
    const now = new Date();
    return {
      conversation: {
        id: c.id,
        subject: c.subject,
        email: c.email,
        contactName: c.contactName,
        stage: c.stage,
        mode: c.mode,
        category: c.category,
        waitingOn: c.waitingOn,
        priority: withWaiting(c.priority, c.waitingOn, c.lastInboundAt, now),
        priorityReasons: c.priorityReasons,
        needsHuman: c.needsHuman,
        escalationReason: c.escalationReason,
        primaryIntent: c.primaryIntent,
        sentiment: c.sentiment,
        summary: c.summary,
        snoozedUntil: c.snoozedUntil,
        resolvedAt: c.resolvedAt,
        takenOver: c.takenOverAt ? { by: nameOf(c.takenOverById), at: c.takenOverAt } : null,
        assignedToId: c.assignedToId,
        lastInboundAt: c.lastInboundAt,
        lastOutboundAt: c.lastOutboundAt,
        createdAt: c.createdAt,
        version: c.version,
        nextAction: nextActionFor(
          {
            ...c,
            pendingApproval: openReplies.some((r) => r.status === 'PENDING_APPROVAL'),
            draftReady: openReplies.some((r) => r.status === 'DRAFT'),
            replyQueued: openReplies.some((r) => r.status === 'QUEUED' || r.status === 'WAITING'),
          },
          now,
        ),
      },
      company: company ? { id: company.id, name: company.displayName, industry: company.industry, city: company.city, region: company.region, website: company.websiteDomain, phone: company.phone, priority: assessment ?? null } : null,
      person: person ? { id: person.id, name: person.fullName, title: person.employments[0]?.title ?? null } : null,
      campaign,
      enrollment,
      mailbox: mailbox ? { id: mailbox.id, name: mailbox.name, provider: mailbox.provider, status: mailbox.status, address: mailbox.accountRef.includes('@') ? mailbox.accountRef : null, testMailbox: mailbox.provider === 'fake_email' } : null,
      policy: { autonomyLevel: workspace.autonomyLevel, outboundState: workspace.outboundState, aiRepliesNeedApproval: !['L3', 'L4'].includes(workspace.autonomyLevel) },
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        author: m.author,
        authorName: nameOf(m.authorUserId),
        fromEmail: m.fromEmail,
        subject: m.subject,
        text: m.text,
        kind: m.kind,
        fromCampaign: !!m.campaignMessageId,
        occurredAt: m.occurredAt,
        classification: m.classification
          ? {
              primaryIntent: m.classification.primaryIntent,
              secondaryIntents: m.classification.secondaryIntents,
              sentiment: m.classification.sentiment,
              questions: m.classification.questions,
              objections: m.classification.objections as { type: string; text: string }[],
              riskFlags: m.classification.riskFlags,
              needsHuman: m.classification.needsHuman,
              confidence: m.classification.confidence,
              summary: m.classification.summary,
              method: m.classification.method,
            }
          : null,
      })),
      replies: replies.map((r) => {
        const a = actions.find((x) => x.id === r.externalActionId);
        return {
          id: r.id,
          author: r.author,
          authorName: nameOf(r.authorUserId),
          subject: r.subject,
          body: r.body,
          status: r.status,
          statusReason: r.statusReason,
          answered: r.answered as { question: string; answer: string; source: string }[],
          unanswered: r.unanswered,
          claims: r.claims,
          validation: r.validation as { validator: string; ok: boolean; detail: string }[],
          confidence: r.confidence,
          inReplyToMessageId: r.inReplyToMessageId,
          stale: r.status === 'DRAFT' && !!latestInbound && r.inReplyToMessageId !== latestInbound.id,
          approvalId: a?.status === 'WAITING_APPROVAL' ? a.approvalRequestId : null,
          resumeAt: a?.resumeAt ?? null,
          feedback: r.feedback,
          sentAt: r.sentAt,
          createdAt: r.createdAt,
        };
      }),
      context: Object.entries((c.context ?? {}) as ConversationContextMap).map(([field, v]) => ({ field, ...v, id: extractions.find((x) => x.field === field && x.status === 'APPLIED')?.id ?? null })),
      factHistory: extractions.map((x) => ({ id: x.id, field: x.field, value: x.value, quote: x.quote, status: x.status, confidence: x.confidence, messageId: x.messageId, createdAt: x.createdAt })),
      timeline: events.map((e) => ({ id: e.id, type: e.eventType, payload: e.payload, actorType: e.actorType, actorName: nameOf(e.actorId), at: e.occurredAt })),
      members: members.map((m) => m.user),
    };
  }
}
