import { Injectable } from '@nestjs/common';
import type { KnowledgeStatus, KnowledgeType, Prisma } from '@revenue-os/database';
import { keywordScore, KNOWLEDGE_TYPE_INFO, KNOWLEDGE_TYPES, knowledgeControlsOf, NotFoundError, QUESTION_TOPIC_LABEL, type QuestionTopic } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';

const DAY = 86_400_000;
const LIVE: KnowledgeStatus[] = ['APPROVED', 'STALE', 'CONFLICT'];
const CORE: KnowledgeType[] = ['SERVICE', 'PRICING', 'FAQ', 'POLICY', 'INTEGRATION'];

type Level = 'GOOD' | 'MEDIUM' | 'WEAK';

/**
 * Knowledge Base reads (screen #13): Business Brain health as explainable dimensions (never one magic number),
 * the library per type, an item with every version, usage and audit, the review queue, gaps by priority, documents.
 */
@Injectable()
export class KnowledgeQuery {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  async overview(workspaceId: string, now = new Date()) {
    const db = this.db;
    const since = new Date(now.getTime() - 30 * DAY);
    const [byType, drafts, conflicts, gaps, ws, usage, replies, gapTopics, disabled, profile, stale] = await Promise.all([
      db.knowledgeItem.groupBy({ by: ['type', 'status'], where: { workspaceId, archivedAt: null }, _count: { _all: true } }),
      db.knowledgeRevision.count({ where: { workspaceId, status: { in: ['DRAFT', 'IN_REVIEW'] } } }),
      db.knowledgeConflict.count({ where: { workspaceId, status: 'OPEN' } }),
      db.knowledgeGap.findMany({ where: { workspaceId, status: { in: ['OPEN', 'DRAFTED', 'IN_REVIEW'] } }, orderBy: [{ priority: 'desc' }, { lastSeenAt: 'desc' }], take: 50 }),
      db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { knowledgeControls: true } }),
      db.knowledgeUsage.groupBy({ by: ['itemId'], where: { workspaceId, at: { gte: since }, usedByType: 'REPLY' }, _count: { _all: true }, orderBy: { _count: { itemId: 'desc' } }, take: 6 }),
      db.conversationReply.findMany({ where: { workspaceId, author: 'AI', createdAt: { gte: since }, status: { notIn: ['REJECTED'] } }, select: { answered: true, unanswered: true } }),
      db.knowledgeGap.groupBy({ by: ['topic'], where: { workspaceId, status: { in: ['OPEN', 'DRAFTED', 'IN_REVIEW'] } }, _sum: { occurrences: true }, orderBy: { _sum: { occurrences: 'desc' } }, take: 5 }),
      db.knowledgeItem.findMany({ where: { workspaceId, aiDisabled: true, archivedAt: null }, select: { id: true, code: true, title: true, aiDisabledReason: true } }),
      db.knowledgeItem.findFirst({ where: { workspaceId, type: 'PROFILE', archivedAt: null }, select: { id: true, status: true, currentRevisionId: true } }),
      db.knowledgeItem.findMany({ where: { workspaceId, archivedAt: null, OR: [{ status: 'STALE' }, { needsReview: true }] }, select: { id: true, code: true, title: true, type: true, needsReviewReason: true }, take: 10 }),
    ]);
    const count = (pred: (r: (typeof byType)[number]) => boolean) => byType.filter(pred).reduce((n, r) => n + r._count._all, 0);
    const live = count((r) => LIVE.includes(r.status));
    const perType = KNOWLEDGE_TYPES.map((type) => ({ type, label: KNOWLEDGE_TYPE_INFO[type].plural, approved: count((r) => r.type === type && LIVE.includes(r.status)), total: count((r) => r.type === type) }));

    // AI answer readiness from real answers (last 30 days): questions answered from knowledge vs handed to a person.
    let answeredFromKb = 0;
    let questions = 0;
    for (const r of replies) {
      const a = (r.answered ?? []) as { source?: string }[];
      answeredFromKb += a.filter((x) => x.source === 'KNOWLEDGE').length;
      questions += a.length + r.unanswered.length;
    }
    const readiness = questions >= 1 ? { percent: Math.round((answeredFromKb / questions) * 100), questions, answered: answeredFromKb } : null;

    const coreCovered = CORE.filter((t) => perType.find((p) => p.type === t)!.approved > 0).length;
    const level = (ok: boolean, mid: boolean): Level => (ok ? 'GOOD' : mid ? 'MEDIUM' : 'WEAK');
    const pricing = perType.find((p) => p.type === 'PRICING')!;
    const integrations = perType.find((p) => p.type === 'INTEGRATION')!;
    const health = {
      coverage: { level: level(coreCovered >= 4, coreCovered >= 2), detail: `${coreCovered} of ${CORE.length} core areas have approved knowledge` },
      freshness: { level: level(stale.length === 0, stale.length <= Math.max(1, Math.floor(live / 10))), detail: stale.length ? `${stale.length} need revalidation` : 'Everything within its review date' },
      conflicts: { count: conflicts },
      gaps: { count: gaps.length },
      pricingReadiness: { level: level(pricing.approved > 0 && !stale.some((s) => s.type === 'PRICING'), pricing.total > 0), detail: pricing.approved ? `${pricing.approved} approved price${pricing.approved === 1 ? '' : 's'}` : 'No approved pricing — every price question goes to a person' },
      integrationCoverage: { level: level(integrations.approved >= 3, integrations.approved >= 1), detail: `${integrations.approved} documented` },
    };
    const status = conflicts > 0 || (coreCovered < 2 && live > 0) ? 'NEEDS_ATTENTION' : live === 0 ? 'EMPTY' : stale.length || gaps.length ? 'FAIR' : 'HEALTHY';

    const attention: { kind: string; text: string; href: string }[] = [];
    if (!profile?.currentRevisionId) attention.push({ kind: 'PROFILE', text: 'Business profile not approved yet — the AI does not know who you are', href: '/knowledge?tab=profile' });
    if (conflicts) attention.push({ kind: 'CONFLICT', text: `${conflicts} knowledge conflict${conflicts === 1 ? '' : 's'} — the AI does not answer from either side`, href: '/knowledge?tab=review' });
    for (const s of stale.slice(0, 3)) attention.push({ kind: 'STALE', text: `${s.title} ${s.needsReviewReason ? `— ${s.needsReviewReason}` : 'needs revalidation'}`, href: `/knowledge/${s.id}` });
    const asked = new Set(gaps.flatMap((g) => g.companyIds)).size;
    if (gaps.length) attention.push({ kind: 'GAP', text: `${asked || gaps.length} prospect${(asked || gaps.length) === 1 ? '' : 's'} asked ${gaps.length === 1 ? 'a question' : `${gaps.length} questions`} the AI cannot answer`, href: '/knowledge?tab=gaps' });
    if (drafts) attention.push({ kind: 'REVIEW', text: `${drafts} draft${drafts === 1 ? '' : 's'} waiting for review`, href: '/knowledge?tab=review' });
    for (const d of disabled) attention.push({ kind: 'DISABLED', text: `${d.title} is disabled for the AI — ${d.aiDisabledReason ?? ''}`, href: `/knowledge/${d.id}` });

    const usedItems = usage.length ? await db.knowledgeItem.findMany({ where: { id: { in: usage.map((u) => u.itemId) } }, select: { id: true, code: true, title: true } }) : [];
    return {
      status,
      counts: { approved: live, drafts, stale: stale.length, conflicts, gaps: gaps.length, disabled: disabled.length },
      readiness,
      health,
      perType,
      controls: knowledgeControlsOf(ws.knowledgeControls),
      attention,
      mostUsed: usage.map((u) => ({ ...usedItems.find((i) => i.id === u.itemId)!, answers: u._count._all })).filter((x) => x.id),
      lowConfidenceTopics: gapTopics.map((g) => ({ topic: g.topic, label: QUESTION_TOPIC_LABEL[g.topic as QuestionTopic] ?? g.topic, asked: g._sum.occurrences ?? 0 })),
      profileId: profile?.id ?? null,
    };
  }

  async list(workspaceId: string, q: { type?: KnowledgeType; status?: string; q?: string; serviceId?: string }) {
    const where: Prisma.KnowledgeItemWhereInput = { workspaceId, ...(q.type ? { type: q.type } : {}), ...(q.serviceId ? { serviceItemId: q.serviceId } : {}) };
    if (q.status === 'ARCHIVED') where.status = 'ARCHIVED';
    else {
      where.archivedAt = null;
      if (q.status) where.status = q.status as KnowledgeStatus;
    }
    const items = await this.db.knowledgeItem.findMany({ where, orderBy: [{ type: 'asc' }, { title: 'asc' }], take: 300 });
    const [current, drafts, conflicts] = await Promise.all([
      this.db.knowledgeRevision.findMany({ where: { id: { in: items.map((i) => i.currentRevisionId).filter((x): x is string => !!x) } }, select: { id: true, version: true, content: true, approvedAt: true } }),
      this.db.knowledgeRevision.findMany({ where: { itemId: { in: items.map((i) => i.id) }, status: { in: ['DRAFT', 'IN_REVIEW'] } }, select: { itemId: true, status: true, version: true, origin: true, content: true, effectiveFrom: true } }),
      this.db.knowledgeConflict.findMany({ where: { workspaceId, status: 'OPEN' }, select: { itemId: true, otherItemId: true } }),
    ]);
    const scheduled = await this.db.knowledgeRevision.findMany({ where: { itemId: { in: items.map((i) => i.id) }, status: 'APPROVED', publishedAt: null }, select: { itemId: true, version: true, effectiveFrom: true } });
    const needle = q.q?.trim().toLowerCase();
    return items
      .map((i) => {
        const cur = current.find((r) => r.id === i.currentRevisionId);
        const draft = drafts.find((d) => d.itemId === i.id);
        return {
          id: i.id,
          code: i.code,
          type: i.type,
          title: i.title,
          status: i.status,
          version: cur?.version ?? null,
          content: (cur?.content ?? draft?.content ?? {}) as Record<string, unknown>,
          draft: draft ? { status: draft.status, version: draft.version, origin: draft.origin, effectiveFrom: draft.effectiveFrom } : null,
          scheduled: scheduled.filter((s) => s.itemId === i.id).map((s) => ({ version: s.version, effectiveFrom: s.effectiveFrom })),
          aiDisabled: i.aiDisabled,
          needsReview: i.needsReview,
          nextReviewAt: i.nextReviewAt,
          lastReviewedAt: i.lastReviewedAt,
          usageCount: i.usageCount,
          conflicts: conflicts.filter((c) => c.itemId === i.id || c.otherItemId === i.id).length,
          serviceItemId: i.serviceItemId,
        };
      })
      .filter((i) => !needle || i.title.toLowerCase().includes(needle) || i.code.toLowerCase().includes(needle) || JSON.stringify(i.content).toLowerCase().includes(needle));
  }

  async detail(workspaceId: string, id: string) {
    const db = this.db;
    const item = await db.knowledgeItem.findFirst({ where: { id, workspaceId } });
    if (!item) throw new NotFoundError('Knowledge item not found');
    const [revisions, conflicts, usage, feedback, audit, children, service] = await Promise.all([
      db.knowledgeRevision.findMany({ where: { itemId: id }, orderBy: { version: 'desc' } }),
      db.knowledgeConflict.findMany({ where: { workspaceId, OR: [{ itemId: id }, { otherItemId: id }] }, orderBy: { detectedAt: 'desc' }, take: 20 }),
      db.knowledgeUsage.findMany({ where: { workspaceId, itemId: id }, orderBy: { at: 'desc' }, take: 20 }),
      db.knowledgeFeedback.groupBy({ by: ['kind'], where: { workspaceId, itemId: id }, _count: { _all: true } }),
      db.auditLog.findMany({ where: { workspaceId, entityType: 'KNOWLEDGE_ITEM', entityId: id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      db.knowledgeItem.findMany({ where: { workspaceId, serviceItemId: id, archivedAt: null }, select: { id: true, code: true, type: true, title: true, status: true } }),
      item.serviceItemId ? db.knowledgeItem.findFirst({ where: { id: item.serviceItemId, workspaceId }, select: { id: true, code: true, title: true } }) : null,
    ]);
    const otherIds = [...new Set(conflicts.flatMap((c) => [c.itemId, c.otherItemId]).filter((x): x is string => !!x && x !== id))];
    const userIds = [...new Set([...revisions.flatMap((r) => [r.approvedById, r.createdByType === 'HUMAN' ? r.createdById : null]), ...audit.map((a) => (a.actorType === 'HUMAN' ? a.actorId : null))].filter((x): x is string => !!x))];
    const sourceIds = [...new Set(revisions.flatMap((r) => r.sourceIds))];
    const convIds = [...new Set(usage.map((u) => u.conversationId).filter((x): x is string => !!x))];
    const gapIds = [...new Set(revisions.map((r) => r.gapId).filter((x): x is string => !!x))];
    const [others, users, sources, convs, gaps] = await Promise.all([
      otherIds.length ? db.knowledgeItem.findMany({ where: { id: { in: otherIds } }, select: { id: true, code: true, title: true } }) : [],
      userIds.length ? db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
      sourceIds.length ? db.knowledgeSource.findMany({ where: { id: { in: sourceIds }, workspaceId }, select: { id: true, fileName: true, uploadedAt: true } }) : [],
      convIds.length ? db.conversation.findMany({ where: { id: { in: convIds } }, select: { id: true, subject: true, companyId: true } }) : [],
      gapIds.length ? db.knowledgeGap.findMany({ where: { id: { in: gapIds } }, select: { id: true, question: true, occurrences: true, status: true } }) : [],
    ]);
    const name = (uid: string | null) => (uid ? (users.find((u) => u.id === uid)?.name ?? 'Someone') : null);
    const companies = convs.length ? await db.company.findMany({ where: { id: { in: convs.map((c) => c.companyId) } }, select: { id: true, displayName: true } }) : [];
    return {
      item: { ...item, typeInfo: KNOWLEDGE_TYPE_INFO[item.type] },
      current: revisions.find((r) => r.id === item.currentRevisionId) ?? null,
      draft: revisions.find((r) => r.status === 'DRAFT' || r.status === 'IN_REVIEW') ?? null,
      scheduled: revisions.filter((r) => r.status === 'APPROVED' && !r.publishedAt),
      revisions: revisions.map((r) => ({ id: r.id, version: r.version, status: r.status, origin: r.origin, title: r.title, changeNote: r.changeNote, effectiveFrom: r.effectiveFrom, approvedAt: r.approvedAt, approvedBy: name(r.approvedById), publishedAt: r.publishedAt, supersededAt: r.supersededAt, createdAt: r.createdAt, createdBy: r.createdByType === 'HUMAN' ? name(r.createdById) : r.createdByType === 'SYSTEM' ? 'System' : 'AI', rejectedReason: r.rejectedReason, content: r.content, current: r.id === item.currentRevisionId })),
      conflicts: conflicts.map((c) => ({ ...c, other: others.find((o) => o.id === (c.itemId === id ? c.otherItemId : c.itemId)) ?? null })),
      usage: usage.map((u) => {
        const conv = convs.find((c) => c.id === u.conversationId);
        return { at: u.at, version: u.version, question: u.question, conversationId: u.conversationId, company: conv ? (companies.find((c) => c.id === conv.companyId)?.displayName ?? null) : null };
      }),
      feedback: Object.fromEntries(feedback.map((f) => [f.kind, f._count._all])),
      audit: audit.map((a) => ({ at: a.createdAt, action: a.action, by: a.actorType === 'HUMAN' ? name(a.actorId) : a.actorType === 'SYSTEM' ? 'System' : 'AI', reason: a.reason })),
      children,
      service,
      sources,
      gaps,
    };
  }

  /** Review queue (screen #13 §76): drafts waiting, open conflicts, stale and reported items — highest impact first. */
  async review(workspaceId: string) {
    const db = this.db;
    const [drafts, conflicts, stale] = await Promise.all([
      db.knowledgeRevision.findMany({ where: { workspaceId, status: { in: ['DRAFT', 'IN_REVIEW'] } }, orderBy: [{ status: 'desc' }, { createdAt: 'desc' }], take: 100, include: { item: { select: { id: true, code: true, type: true, title: true, currentRevisionId: true } } } }),
      db.knowledgeConflict.findMany({ where: { workspaceId, status: 'OPEN' }, orderBy: { detectedAt: 'desc' }, take: 50 }),
      db.knowledgeItem.findMany({ where: { workspaceId, archivedAt: null, OR: [{ status: 'STALE' }, { needsReview: true }] }, orderBy: { usageCount: 'desc' }, take: 50, select: { id: true, code: true, type: true, title: true, status: true, needsReviewReason: true, nextReviewAt: true, usageCount: true } }),
    ]);
    const ids = [...new Set(conflicts.flatMap((c) => [c.itemId, c.otherItemId]).filter((x): x is string => !!x))];
    const items = ids.length ? await db.knowledgeItem.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, title: true, type: true } }) : [];
    const sourceIds = [...new Set(drafts.flatMap((d) => d.sourceIds))];
    const sources = sourceIds.length ? await db.knowledgeSource.findMany({ where: { id: { in: sourceIds } }, select: { id: true, fileName: true } }) : [];
    const impact = (type: string) => (KNOWLEDGE_TYPE_INFO[type as KnowledgeType]?.commercial ? 'HIGH' : type === 'INTEGRATION' || type === 'SERVICE' ? 'MEDIUM' : 'LOW');
    return {
      drafts: drafts.map((d) => ({ revisionId: d.id, itemId: d.itemId, code: d.item.code, type: d.item.type, title: d.title, version: d.version, status: d.status, origin: d.origin, isUpdate: !!d.item.currentRevisionId, effectiveFrom: d.effectiveFrom, createdAt: d.createdAt, source: sources.find((s) => d.sourceIds.includes(s.id))?.fileName ?? null, priority: impact(d.item.type) })),
      conflicts: conflicts.map((c) => ({ ...c, item: items.find((i) => i.id === c.itemId) ?? null, other: items.find((i) => i.id === c.otherItemId) ?? null, priority: 'HIGH' })),
      stale: stale.map((s) => ({ ...s, priority: impact(s.type) })),
    };
  }

  /** Gaps by priority (screen #13 §48, §74): frequency, but also how much open pipeline is waiting on the answer. */
  async gaps(workspaceId: string, status?: string) {
    const gaps = await this.db.knowledgeGap.findMany({ where: { workspaceId, ...(status ? { status } : { status: { in: ['OPEN', 'DRAFTED', 'IN_REVIEW'] } }) }, orderBy: [{ lastSeenAt: 'desc' }], take: 200 });
    const convIds = [...new Set(gaps.flatMap((g) => g.conversationIds))];
    const convs = convIds.length ? await this.db.conversation.findMany({ where: { id: { in: convIds }, workspaceId }, select: { id: true, opportunityId: true, companyId: true } }) : [];
    const oppIds = [...new Set(convs.map((c) => c.opportunityId).filter((x): x is string => !!x))];
    const opps = oppIds.length ? await this.db.opportunity.findMany({ where: { id: { in: oppIds }, status: 'OPEN' }, select: { id: true, amountMinor: true, currency: true, stage: { select: { semantic: true } } } }) : [];
    const companies = await this.db.company.findMany({ where: { id: { in: [...new Set(gaps.flatMap((g) => g.companyIds))] } }, select: { id: true, displayName: true } });
    const drafts = await this.db.knowledgeItem.findMany({ where: { id: { in: gaps.map((g) => g.draftItemId).filter((x): x is string => !!x) } }, select: { id: true, code: true, status: true } });
    return gaps
      .map((g) => {
        const gOpps = opps.filter((o) => convs.some((c) => g.conversationIds.includes(c.id) && c.opportunityId === o.id));
        const pipelineMinor = gOpps.reduce((n, o) => n + (o.amountMinor ?? 0), 0);
        const lateStage = gOpps.some((o) => ['PROPOSAL', 'NEGOTIATION'].includes(o.stage.semantic));
        const score = g.occurrences * 10 + g.conversationIds.length * 5 + gOpps.length * 20 + Math.min(50, Math.floor(pipelineMinor / 100_000)) + (lateStage ? 25 : 0);
        const reasons = [`Asked ${g.occurrences} time${g.occurrences === 1 ? '' : 's'}`, ...(gOpps.length ? [`${gOpps.length} open deal${gOpps.length === 1 ? '' : 's'}${pipelineMinor ? ` (${(pipelineMinor / 100).toLocaleString('en-US', { style: 'currency', currency: gOpps[0]!.currency, maximumFractionDigits: 0 })})` : ''}`] : []), ...(lateStage ? ['A proposal-stage deal is waiting'] : [])];
        return {
          id: g.id,
          question: g.question,
          topic: g.topic,
          topicLabel: QUESTION_TOPIC_LABEL[g.topic as QuestionTopic] ?? g.topic,
          occurrences: g.occurrences,
          conversations: g.conversationIds.length,
          companies: companies.filter((c) => g.companyIds.includes(c.id)).map((c) => c.displayName).slice(0, 5),
          openDeals: gOpps.length,
          pipelineMinor,
          status: g.status,
          priority: score >= 60 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW',
          score,
          reasons,
          draft: drafts.find((d) => d.id === g.draftItemId) ?? null,
          firstSeenAt: g.firstSeenAt,
          lastSeenAt: g.lastSeenAt,
          resolvedAt: g.resolvedAt,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  async documents(workspaceId: string) {
    const sources = await this.db.knowledgeSource.findMany({ where: { workspaceId }, orderBy: { uploadedAt: 'desc' }, take: 100 });
    const users = await this.db.user.findMany({ where: { id: { in: sources.map((s) => s.uploadedById).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    return sources.map((s) => ({ id: s.id, fileName: s.fileName, contentType: s.contentType, sizeBytes: s.sizeBytes, status: s.status, statusReason: s.statusReason, candidates: s.candidates, conflicts: s.conflicts, uploadedAt: s.uploadedAt, processedAt: s.processedAt, uploadedBy: users.find((u) => u.id === s.uploadedById)?.name ?? null }));
  }

  /** Knowledge search (screen #13 §64-65): approved and draft items by words, with their status and authority. */
  async search(workspaceId: string, q: string) {
    if (!q.trim()) return [];
    const items = await this.db.knowledgeItem.findMany({ where: { workspaceId, archivedAt: null }, take: 1000 });
    const revs = await this.db.knowledgeRevision.findMany({ where: { id: { in: items.map((i) => i.currentRevisionId).filter((x): x is string => !!x) } }, select: { id: true, text: true, version: true, approvedAt: true } });
    return items
      .map((i) => {
        const r = revs.find((x) => x.id === i.currentRevisionId);
        return { id: i.id, code: i.code, type: i.type, title: i.title, status: i.status, aiDisabled: i.aiDisabled, version: r?.version ?? null, approvedAt: r?.approvedAt ?? null, score: keywordScore(q, `${i.title} ${r?.text ?? ''}`), snippet: (r?.text ?? '').slice(0, 240) };
      })
      .filter((x) => x.score >= 0.34)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
      .slice(0, 20);
  }
}
