import { Injectable } from '@nestjs/common';
import type { MemoryScope, Prisma } from '@revenue-os/database';
import { memoryKeyInfo, MEMORY_ORIGIN_INFO, NotFoundError, RELATIONSHIP_LABEL } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';

const DAY = 86_400_000;
const OPEN_COMMITMENT = ['OPEN', 'WAITING', 'DUE'] as const;

/**
 * AI Memory reads (screen #12): health with impact (not just percentages), what needs attention, memories with their
 * evidence ("why do we know this?"), candidates waiting for a person, conflicts, commitments and relationships — and
 * per company "what does the AI currently know?" with facts, memory, inference and notes kept apart.
 */
@Injectable()
export class MemoryQuery {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  private async companies(ids: string[]) {
    const rows = ids.length ? await this.db.company.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, displayName: true } }) : [];
    return new Map(rows.map((c) => [c.id, c.displayName]));
  }

  async overview(workspaceId: string, now = new Date()) {
    const db = this.db;
    const endOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59));
    const [byStatus, high, review, conflicts, dueCommitments, openOpps, recent] = await Promise.all([
      db.memory.groupBy({ by: ['status'], where: { workspaceId }, _count: { _all: true } }),
      db.memory.count({ where: { workspaceId, status: 'ACTIVE', confidence: 'HIGH' } }),
      db.memoryCandidate.count({ where: { workspaceId, status: 'NEEDS_REVIEW' } }),
      db.memoryConflict.findMany({ where: { workspaceId, status: 'OPEN' }, orderBy: { detectedAt: 'desc' }, take: 20 }),
      db.commitment.findMany({ where: { workspaceId, status: { in: [...OPEN_COMMITMENT] }, dueAt: { lte: endOfToday } }, orderBy: { dueAt: 'asc' }, take: 20 }),
      db.opportunity.findMany({ where: { workspaceId, status: 'OPEN' }, select: { id: true, companyId: true } }),
      db.memory.findMany({ where: { workspaceId }, orderBy: { updatedAt: 'desc' }, take: 12 }),
    ]);
    const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const active = count('ACTIVE');
    const stale = count('STALE');
    const conflicted = count('CONFLICTED');
    const total = active + stale + conflicted;
    // Impact: stale memories on companies with an open deal matter more than a dormant lead's (screen #12 §45).
    const staleOnDeals = openOpps.length ? await db.memory.count({ where: { workspaceId, status: 'STALE', companyId: { in: openOpps.map((o) => o.companyId) } } }) : 0;
    const names = await this.companies([...conflicts.map((c) => c.companyId), ...dueCommitments.map((c) => c.companyId), ...recent.map((r) => r.companyId)]);
    const attention: { kind: string; company: string | null; companyId: string | null; text: string; href: string }[] = [];
    for (const c of conflicts.slice(0, 5)) attention.push({ kind: 'CONFLICT', company: names.get(c.companyId) ?? null, companyId: c.companyId, text: `${memoryKeyInfo(c.key).label} information conflicts`, href: '/memory?tab=conflicts' });
    for (const c of dueCommitments.slice(0, 5)) attention.push({ kind: 'COMMITMENT', company: names.get(c.companyId) ?? null, companyId: c.companyId, text: `${c.direction === 'WE_PROMISED' ? 'Our promise' : 'Their promise'} ${c.dueAt && c.dueAt < now ? 'is overdue' : 'is due today'}: ${c.title}`, href: '/memory?tab=commitments' });
    if (review) attention.push({ kind: 'REVIEW', company: null, companyId: null, text: `${review} proposed ${review === 1 ? 'memory waits' : 'memories wait'} for a person (budget, authority or unsure)`, href: '/memory?tab=review' });
    if (staleOnDeals) attention.push({ kind: 'STALE', company: null, companyId: null, text: `${staleOnDeals} stale ${staleOnDeals === 1 ? 'memory affects' : 'memories affect'} active opportunities`, href: '/memory?tab=search&status=STALE' });
    const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
    return {
      health: { active, highConfidence: high, stale, conflicting: conflicted, review, total, freshPercent: pct(active), stalePercent: pct(stale), conflictPercent: pct(conflicted), staleOnDeals },
      attention,
      commitmentsDue: dueCommitments.length,
      recent: recent.map((m) => this.memoryRow(m, names)),
    };
  }

  private memoryRow(m: Prisma.MemoryGetPayload<object>, names: Map<string, string>) {
    return {
      id: m.id,
      companyId: m.companyId,
      company: names.get(m.companyId) ?? null,
      entityType: m.entityType,
      entityId: m.entityId,
      key: m.key,
      label: memoryKeyInfo(m.key).label,
      value: m.value,
      summary: m.summary,
      origin: m.origin,
      originLabel: MEMORY_ORIGIN_INFO[m.origin]?.label ?? m.origin,
      confidence: m.confidence,
      status: m.status,
      statusReason: m.statusReason,
      useInOutreach: m.useInOutreach,
      observedAt: m.observedAt,
      lastConfirmedAt: m.lastConfirmedAt,
      recheckAfter: m.recheckAfter,
      validUntil: m.validUntil,
      updatedAt: m.updatedAt,
    };
  }

  async search(workspaceId: string, q: { q?: string; companyId?: string; key?: string; status?: string; origin?: string; entityType?: MemoryScope }) {
    const where: Prisma.MemoryWhereInput = {
      workspaceId,
      ...(q.companyId ? { companyId: q.companyId } : {}),
      ...(q.key ? { key: q.key } : {}),
      ...(q.origin ? { origin: q.origin as Prisma.MemoryWhereInput['origin'] } : {}),
      ...(q.entityType ? { entityType: q.entityType } : {}),
      status: q.status ? (q.status as Prisma.MemoryWhereInput['status']) : { in: ['ACTIVE', 'STALE', 'CONFLICTED'] },
    };
    const needle = q.q?.trim();
    if (needle) {
      const companyIds = (await this.db.company.findMany({ where: { workspaceId, displayName: { contains: needle, mode: 'insensitive' } }, select: { id: true }, take: 50 })).map((c) => c.id);
      where.OR = [{ value: { contains: needle, mode: 'insensitive' } }, { summary: { contains: needle, mode: 'insensitive' } }, ...(companyIds.length ? [{ companyId: { in: companyIds } }] : [])];
    }
    const rows = await this.db.memory.findMany({ where, orderBy: { observedAt: 'desc' }, take: 100, include: { evidence: { orderBy: { observedAt: 'desc' }, take: 1 } } });
    const names = await this.companies(rows.map((r) => r.companyId));
    return rows.map((m) => ({ ...this.memoryRow(m, names), quote: m.evidence[0]?.quote ?? null, source: m.evidence[0] ? { type: m.evidence[0].sourceType, id: m.evidence[0].sourceId, at: m.evidence[0].observedAt } : null }));
  }

  /** "Why do we know this?" — evidence, history chain, conflicts and audit for one memory. */
  async memory(workspaceId: string, id: string) {
    const m = await this.db.memory.findFirst({ where: { id, workspaceId }, include: { evidence: { orderBy: { observedAt: 'desc' } } } });
    if (!m) throw new NotFoundError('Memory not found');
    const [history, conflicts, audit, names] = await Promise.all([
      this.db.memory.findMany({ where: { workspaceId, entityType: m.entityType, entityId: m.entityId, key: m.key }, orderBy: { observedAt: 'desc' }, take: 20 }),
      this.db.memoryConflict.findMany({ where: { workspaceId, OR: [{ memoryAId: id }, { memoryBId: id }] }, orderBy: { detectedAt: 'desc' } }),
      this.db.auditLog.findMany({ where: { workspaceId, entityType: 'MEMORY', entityId: id }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.companies([m.companyId]),
    ]);
    const messageIds = m.evidence.filter((e) => e.sourceType === 'MESSAGE' && e.sourceId).map((e) => e.sourceId!);
    const messages = messageIds.length ? await this.db.conversationMessage.findMany({ where: { id: { in: messageIds }, workspaceId }, select: { id: true, conversationId: true, fromEmail: true, occurredAt: true, subject: true } }) : [];
    const info = memoryKeyInfo(m.key);
    return {
      memory: this.memoryRow(m, names),
      why: { type: info.label, usedFor: info.usedFor, source: MEMORY_ORIGIN_INFO[m.origin]?.description ?? m.origin, retention: info.validDays ? `Stops mattering after ${info.validDays} days` : info.recheckDays ? `Re-checked every ${info.recheckDays} days` : 'Holds until contradicted', outreach: m.useInOutreach ? 'May personalise outreach' : 'Internal reasoning only' },
      evidence: m.evidence.map((e) => ({ ...e, message: messages.find((x) => x.id === e.sourceId) ?? null })),
      history: history.map((h) => this.memoryRow(h, names)),
      conflicts,
      audit: audit.map((a) => ({ at: a.createdAt, action: a.action, actorType: a.actorType, reason: a.reason })),
    };
  }

  async candidates(workspaceId: string) {
    const rows = await this.db.memoryCandidate.findMany({ where: { workspaceId, status: 'NEEDS_REVIEW' }, orderBy: { createdAt: 'desc' }, take: 100 });
    const names = await this.companies(rows.map((r) => r.companyId));
    return rows.map((c) => ({ ...c, label: memoryKeyInfo(c.key).label, company: names.get(c.companyId) ?? null }));
  }

  async conflicts(workspaceId: string) {
    const rows = await this.db.memoryConflict.findMany({ where: { workspaceId, status: 'OPEN' }, orderBy: { detectedAt: 'desc' }, take: 100 });
    const mems = await this.db.memory.findMany({ where: { id: { in: rows.flatMap((r) => [r.memoryAId, r.memoryBId]) } }, include: { evidence: { take: 1, orderBy: { observedAt: 'desc' } } } });
    const names = await this.companies(rows.map((r) => r.companyId));
    const side = (id: string) => {
      const m = mems.find((x) => x.id === id);
      return m ? { id: m.id, value: m.value, origin: m.origin, observedAt: m.observedAt, quote: m.evidence[0]?.quote ?? null } : null;
    };
    return rows.map((c) => ({ id: c.id, companyId: c.companyId, company: names.get(c.companyId) ?? null, key: c.key, label: memoryKeyInfo(c.key).label, a: side(c.memoryAId), b: side(c.memoryBId), detectedAt: c.detectedAt }));
  }

  async commitments(workspaceId: string, q: { status?: string; direction?: string; companyId?: string; conversationId?: string }, now = new Date()) {
    const rows = await this.db.commitment.findMany({
      where: {
        workspaceId,
        ...(q.status === 'ALL' ? {} : q.status ? { status: q.status as Prisma.CommitmentWhereInput['status'] } : { status: { in: [...OPEN_COMMITMENT] } }),
        ...(q.direction ? { direction: q.direction as Prisma.CommitmentWhereInput['direction'] } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(q.conversationId ? { conversationId: q.conversationId } : {}),
      },
      orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
    });
    const names = await this.companies(rows.map((r) => r.companyId));
    const owners = await this.db.user.findMany({ where: { id: { in: rows.map((r) => r.ownerUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
    return rows.map((c) => ({ ...c, company: names.get(c.companyId) ?? null, owner: owners.find((o) => o.id === c.ownerUserId)?.name ?? null, overdue: !!c.dueAt && c.dueAt < now && (OPEN_COMMITMENT as readonly string[]).includes(c.status), dueToday: !!c.dueAt && c.dueAt.toISOString().slice(0, 10) === now.toISOString().slice(0, 10) }));
  }

  async relationships(workspaceId: string, companyId?: string) {
    const rows = await this.db.relationship.findMany({ where: { workspaceId, ...(companyId ? { companyId } : {}), status: { not: 'INVALIDATED' } }, orderBy: { createdAt: 'desc' }, take: 100 });
    const people = await this.db.person.findMany({ where: { id: { in: rows.flatMap((r) => [r.fromType === 'PERSON' ? r.fromId : null, r.toId]).filter((x): x is string => !!x) } }, select: { id: true, fullName: true } });
    const names = await this.companies([...rows.map((r) => r.companyId), ...rows.filter((r) => r.fromType === 'COMPANY').map((r) => r.fromId)]);
    return rows.map((r) => ({
      ...r,
      company: names.get(r.companyId) ?? null,
      from: r.fromType === 'PERSON' ? (people.find((p) => p.id === r.fromId)?.fullName ?? 'Someone') : (names.get(r.fromId) ?? 'The company'),
      to: r.toId ? (people.find((p) => p.id === r.toId)?.fullName ?? r.toLabel) : r.toLabel,
      label: RELATIONSHIP_LABEL[r.type] ?? r.type,
    }));
  }

  /**
   * Company 360 "What does AI currently know?" (docs/13 §95-99): facts, memory by record, AI hypotheses, notes,
   * open commitments and conflicts — separated, each with its source — and a memory health line with impact.
   */
  async company(workspaceId: string, companyId: string, now = new Date()) {
    const company = await this.db.company.findFirst({ where: { id: companyId, workspaceId }, select: { id: true, displayName: true } });
    if (!company) throw new NotFoundError('Company not found');
    const [memories, candidates, conflicts, commitments, relationships, facts, hypotheses, opps, people] = await Promise.all([
      this.db.memory.findMany({ where: { workspaceId, companyId, status: { in: ['ACTIVE', 'STALE', 'CONFLICTED'] } }, orderBy: { observedAt: 'desc' }, take: 100, include: { evidence: { take: 1, orderBy: { observedAt: 'desc' } } } }),
      this.db.memoryCandidate.findMany({ where: { workspaceId, companyId, status: 'NEEDS_REVIEW' }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.conflicts(workspaceId).then((all) => all.filter((c) => c.companyId === companyId)),
      this.commitments(workspaceId, { companyId, status: 'ALL' }, now),
      this.relationships(workspaceId, companyId),
      this.db.fact.count({ where: { workspaceId, entityType: 'COMPANY', entityId: companyId, status: 'ACTIVE' } }),
      this.db.opportunityHypothesis.count({ where: { workspaceId, companyId, status: { in: ['ACTIVE', 'CANDIDATE', 'SUPPORTED'] } } }),
      this.db.opportunity.findMany({ where: { workspaceId, companyId }, select: { id: true, name: true, status: true } }),
      this.db.employment.findMany({ where: { workspaceId, companyId }, select: { personId: true, person: { select: { fullName: true } } } }),
    ]);
    const names = new Map([[companyId, company.displayName]]);
    const where = (m: (typeof memories)[number]) =>
      m.entityType === 'COMPANY' ? company.displayName : m.entityType === 'OPPORTUNITY' ? `Deal: ${opps.find((o) => o.id === m.entityId)?.name ?? 'deal'}` : m.entityType === 'PERSON' ? (people.find((p) => p.personId === m.entityId)?.person.fullName ?? 'Contact') : 'Conversation';
    const rows = memories.map((m) => ({ ...this.memoryRow(m, names), where: where(m), quote: m.evidence[0]?.quote ?? null }));
    const open = commitments.filter((c) => (OPEN_COMMITMENT as readonly string[]).includes(c.status));
    return {
      company,
      health: { stale: rows.filter((r) => r.status === 'STALE').length, conflicts: conflicts.length, openCommitments: open.length, overdue: open.filter((c) => c.overdue).length, review: candidates.length },
      layers: { facts, hypotheses },
      statements: rows.filter((r) => r.origin === 'DIRECT_STATEMENT' || r.origin === 'MEETING_NOTE' || r.origin === 'HUMAN_CORRECTION'),
      notes: rows.filter((r) => r.origin === 'HUMAN_NOTE'),
      inferences: rows.filter((r) => r.origin === 'AI_INFERENCE'),
      candidates: candidates.map((c) => ({ ...c, label: memoryKeyInfo(c.key).label })),
      conflicts,
      commitments: commitments.slice(0, 30),
      relationships,
      opportunities: opps,
      people: people.map((p) => ({ id: p.personId, name: p.person.fullName })),
      recentlyChanged: rows.filter((r) => now.getTime() - new Date(r.updatedAt).getTime() < 7 * DAY).length,
    };
  }
}
