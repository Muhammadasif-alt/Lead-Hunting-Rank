import { Injectable } from '@nestjs/common';
import type { Company, CompanyStatus, ContactPoint, Evidence, Prisma } from '@revenue-os/database';
import { assessContactability, freshnessOf, normalizeCompanyName, NotFoundError, roleRelevance, type PermissionKey } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';
import { OPEN_CANDIDATE } from './entity-resolution.service.js';
import { presentRun } from './research.service.js';

export interface CompanyListQuery {
  search?: string;
  status?: CompanyStatus | 'ALL';
  cursor?: string;
  limit: number;
}

type ContactPointWithVerification = ContactPoint & { verifications: { status: string; provider: string; verifiedAt: Date }[] };

/** Explicit response shapes — Prisma rows never go to the browser as-is (docs/14 §19). */
export function presentCompany(c: Company) {
  return {
    id: c.id,
    displayName: c.displayName,
    legalName: c.legalName,
    websiteDomain: c.websiteDomain,
    phone: c.phone,
    status: c.status,
    companyType: c.companyType,
    industry: c.industry,
    addressLine: c.addressLine,
    city: c.city,
    region: c.region,
    country: c.country,
    postalCode: c.postalCode,
    employeeRange: c.employeeRange,
    revenueRange: c.revenueRange,
    foundedYear: c.foundedYear,
    mergedIntoId: c.mergedIntoId,
    mergedAt: c.mergedAt,
    archivedAt: c.archivedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    version: c.version,
  };
}

function presentContactPoint(cp: ContactPointWithVerification) {
  const v = cp.verifications[0];
  return {
    id: cp.id,
    type: cp.type,
    value: cp.value,
    normalizedValue: cp.normalizedValue,
    label: cp.label,
    status: cp.status,
    confidence: cp.confidence,
    isPrimary: cp.isPrimary,
    firstSeenAt: cp.firstSeenAt,
    lastVerifiedAt: cp.lastVerifiedAt,
    verification: v ? { status: v.status, provider: v.provider, verifiedAt: v.verifiedAt } : null,
  };
}

function presentEvidence(e: Evidence, now: Date) {
  return {
    id: e.id,
    evidenceType: e.evidenceType,
    sourceType: e.sourceType,
    sourceName: e.sourceName,
    sourceUrl: e.sourceUrl,
    provider: e.provider,
    observedAt: e.observedAt,
    retrievedAt: e.retrievedAt,
    excerpt: e.contentExcerpt,
    confidence: e.confidence,
    freshness: freshnessOf(e.observedAt, now),
  };
}

const latestVerification = { verifications: { orderBy: { verifiedAt: 'desc' as const }, take: 1, select: { status: true, provider: true, verifiedAt: true } } };

/**
 * Page-oriented read models for Company 360 (docs/14 §40: one request per screen, not 1 + 50 + 100). Read only —
 * every write goes through the application services.
 */
@Injectable()
export class CompanyQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string, q: CompanyListQuery) {
    const db = this.prisma.client;
    const where: Prisma.CompanyWhereInput = { workspaceId, mergedIntoId: null };
    if (!q.status) where.status = { not: 'ARCHIVED' };
    else if (q.status !== 'ALL') where.status = q.status;
    const term = q.search?.trim();
    if (term) {
      const digits = term.replace(/\D/g, '');
      where.OR = [
        { normalizedName: { contains: normalizeCompanyName(term) } },
        { displayName: { contains: term, mode: 'insensitive' } },
        { websiteDomain: { contains: term.toLowerCase() } },
        { city: { contains: term, mode: 'insensitive' } },
        ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
      ];
    }

    const rows = await db.company.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, q.limit);
    const ids = page.map((c) => c.id);

    const [people, evidence, candidates, statusCounts] = await Promise.all([
      db.employment.groupBy({ by: ['companyId'], where: { workspaceId, companyId: { in: ids }, isCurrent: true }, _count: true }),
      db.evidence.groupBy({ by: ['entityId'], where: { workspaceId, entityType: 'COMPANY', entityId: { in: ids } }, _max: { observedAt: true }, _count: true }),
      db.entityMatchCandidate.findMany({
        where: { workspaceId, entityType: 'COMPANY', status: { in: OPEN_CANDIDATE }, OR: [{ leftId: { in: ids } }, { rightId: { in: ids } }] },
        select: { leftId: true, rightId: true },
      }),
      db.company.groupBy({ by: ['status'], where: { workspaceId, mergedIntoId: null }, _count: true }),
    ]);
    const now = new Date();

    return {
      items: page.map((c) => {
        const ev = evidence.find((e) => e.entityId === c.id);
        const lastObservedAt = ev?._max.observedAt ?? null;
        return {
          ...presentCompany(c),
          peopleCount: people.find((p) => p.companyId === c.id)?._count ?? 0,
          evidenceCount: ev?._count ?? 0,
          lastObservedAt,
          freshness: lastObservedAt ? freshnessOf(lastObservedAt, now) : null,
          openDuplicates: candidates.filter((d) => d.leftId === c.id || d.rightId === c.id).length,
        };
      }),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
      hasMore: rows.length > q.limit,
      statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s._count])) as Partial<Record<CompanyStatus, number>>,
    };
  }

  openDuplicateCount(workspaceId: string, companyId: string) {
    return this.prisma.client.entityMatchCandidate.count({
      where: { workspaceId, entityType: 'COMPANY', status: { in: OPEN_CANDIDATE }, OR: [{ leftId: companyId }, { rightId: companyId }] },
    });
  }

  /** Company 360 V1 — who are they, where did the data come from, who works there, how to reach them, what we know, how fresh. */
  async overview(workspaceId: string, id: string, permissions: ReadonlySet<PermissionKey>) {
    const db = this.prisma.client;
    const company = await db.company.findFirst({ where: { id, workspaceId }, include: { aliases: { orderBy: { createdAt: 'asc' } } } });
    if (!company) throw new NotFoundError(`company ${id} not found`);

    const [mergedInto, mergedFrom, employments, companyPoints, facts, evidence, mappings, candidates, creator, runs, website, technologies, social, hypotheses] = await Promise.all([
      company.mergedIntoId ? db.company.findUnique({ where: { id: company.mergedIntoId }, select: { id: true, displayName: true } }) : null,
      db.company.findMany({ where: { workspaceId, mergedIntoId: id }, select: { id: true, displayName: true, mergedAt: true }, orderBy: { mergedAt: 'desc' } }),
      db.employment.findMany({ where: { workspaceId, companyId: id }, include: { person: true }, orderBy: [{ isCurrent: 'desc' }, { createdAt: 'asc' }] }),
      db.contactPoint.findMany({ where: { workspaceId, entityType: 'COMPANY', entityId: id, archivedAt: null }, include: latestVerification, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] }),
      db.fact.findMany({
        where: { workspaceId, entityType: 'COMPANY', entityId: id, status: { in: ['ACTIVE', 'CONFLICTED'] } },
        include: { evidence: { include: { evidence: true } } },
        orderBy: [{ field: 'asc' }, { lastConfirmedAt: 'desc' }],
      }),
      db.evidence.findMany({ where: { workspaceId, entityType: 'COMPANY', entityId: id }, include: { _count: { select: { facts: true } } }, orderBy: { observedAt: 'desc' }, take: 200 }),
      db.externalEntityMapping.findMany({ where: { workspaceId, entityType: 'COMPANY', entityId: id }, orderBy: { firstSeenAt: 'asc' } }),
      db.entityMatchCandidate.findMany({
        where: { workspaceId, entityType: 'COMPANY', status: { in: OPEN_CANDIDATE }, OR: [{ leftId: id }, { rightId: id }] },
        orderBy: { score: 'desc' },
      }),
      company.createdBy ? db.user.findUnique({ where: { id: company.createdBy }, select: { id: true, name: true } }) : null,
      db.researchRun.findMany({ where: { workspaceId, companyId: id }, orderBy: { createdAt: 'desc' }, take: 5 }),
      db.website.findFirst({
        where: { workspaceId, companyId: id, isOfficial: true },
        orderBy: [{ lastCheckedAt: { sort: 'desc', nulls: 'last' } }],
        include: { audits: { orderBy: { performedAt: 'desc' }, take: 1 }, snapshots: { orderBy: { fetchedAt: 'desc' }, take: 12 } },
      }),
      db.companyTechnology.findMany({ where: { workspaceId, companyId: id }, include: { technology: true }, orderBy: [{ goneAt: { sort: 'desc', nulls: 'first' } }, { firstDetectedAt: 'asc' }] }),
      db.socialProfile.findMany({ where: { workspaceId, companyId: id }, orderBy: [{ status: 'asc' }, { platform: 'asc' }] }),
      db.opportunityHypothesis.findMany({
        where: { workspaceId, companyId: id },
        include: { evidence: { include: { evidence: true } } },
        orderBy: [{ status: 'asc' }, { confidence: 'desc' }, { generatedAt: 'desc' }],
      }),
    ]);

    const personIds = employments.map((e) => e.personId);
    const [personPoints, others] = await Promise.all([
      db.contactPoint.findMany({
        where: { workspaceId, entityType: 'PERSON', entityId: { in: personIds }, archivedAt: null },
        include: latestVerification,
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      }),
      db.company.findMany({
        where: { id: { in: candidates.map((c) => (c.leftId === id ? c.rightId : c.leftId)) } },
        include: { _count: { select: { employments: true } } },
      }),
    ]);

    const now = new Date();
    const factRows = facts.map((f) => {
      const ev = f.evidence.map((fe) => presentEvidence(fe.evidence, now)).sort((a, b) => +b.observedAt - +a.observedAt);
      return {
        id: f.id,
        field: f.field,
        factType: f.factType,
        value: f.valueJson,
        status: f.status,
        confidence: f.confidence,
        firstObservedAt: f.firstObservedAt,
        lastConfirmedAt: f.lastConfirmedAt,
        freshness: freshnessOf(f.lastConfirmedAt, now),
        evidence: ev,
      };
    });

    const sources = new Map<string, { source: string; sourceType: string; count: number; lastObservedAt: Date }>();
    for (const e of evidence) {
      const label = e.provider ?? e.sourceName ?? e.sourceType;
      const s = sources.get(label) ?? { source: label, sourceType: e.sourceType, count: 0, lastObservedAt: e.observedAt };
      s.count++;
      if (e.observedAt > s.lastObservedAt) s.lastObservedAt = e.observedAt;
      sources.set(label, s);
    }
    const lastObservedAt = evidence[0]?.observedAt ?? null;
    const allPoints = [...companyPoints, ...personPoints];
    const audit = website?.audits[0] ?? null;
    const latestRun = runs[0] ?? null;

    // Decision makers: people the sources name with a role, ranked by role fit (not verified authority).
    const rank = ['HIGH', 'MEDIUM', 'LOW'];
    const decisionMakers = employments
      .filter((e) => e.isCurrent)
      .map((e) => {
        const email = personPoints.find((cp) => cp.entityId === e.personId && cp.type === 'EMAIL' && cp.status !== 'INVALID') ?? null;
        return {
          personId: e.personId,
          name: e.person.fullName,
          title: e.title,
          relevance: roleRelevance(e.title),
          confidence: e.confidence,
          email: email ? { value: email.value, status: email.status, verification: email.verifications[0]?.status ?? null } : null,
        };
      })
      .sort((a, b) => rank.indexOf(a.relevance) - rank.indexOf(b.relevance));
    const phonePoints = allPoints.filter((p) => p.type !== 'EMAIL' && p.type !== 'OTHER').length;
    const contactability = assessContactability({
      emails: allPoints
        .filter((p) => p.type === 'EMAIL')
        .map((p) => {
          const dm = p.entityType === 'PERSON' ? decisionMakers.find((d) => d.personId === p.entityId) : undefined;
          return { status: p.status, verification: p.verifications[0]?.status ?? null, person: dm ? { name: dm.name, relevance: dm.relevance } : null };
        }),
      // The main phone on the record counts when no phone contact point repeats it.
      phones: phonePoints || (company.phone ? 1 : 0),
      contactForm: audit?.hasContactForm ?? null,
    });
    const latestPerPage = new Map<string, NonNullable<typeof website>['snapshots'][number]>();
    for (const sn of website?.snapshots ?? []) if (!latestPerPage.has(sn.pageType)) latestPerPage.set(sn.pageType, sn);
    const active = !company.mergedIntoId && company.status !== 'ARCHIVED';
    const can = (p: PermissionKey) => permissions.has(p);

    return {
      company: { ...presentCompany(company), createdBy: creator },
      mergedInto,
      mergedFrom,
      aliases: company.aliases.map((a) => ({ id: a.id, type: a.aliasType, value: a.value, normalizedValue: a.normalizedValue, source: a.source })),
      externalIds: mappings.map((m) => ({ id: m.id, provider: m.provider, externalId: m.externalId, externalUrl: m.externalUrl, firstSeenAt: m.firstSeenAt, lastSeenAt: m.lastSeenAt })),
      contactPoints: companyPoints.map(presentContactPoint),
      people: employments.map((e) => ({
        employmentId: e.id,
        title: e.title,
        department: e.department,
        seniority: e.seniority,
        isCurrent: e.isCurrent,
        startedAt: e.startedAt,
        endedAt: e.endedAt,
        confidence: e.confidence,
        verifiedAt: e.verifiedAt,
        person: {
          id: e.person.id,
          fullName: e.person.fullName,
          firstName: e.person.firstName,
          lastName: e.person.lastName,
          linkedinUrl: e.person.linkedinUrl,
          timezone: e.person.timezone,
          language: e.person.language,
          version: e.person.version,
        },
        contactPoints: personPoints.filter((cp) => cp.entityId === e.personId).map(presentContactPoint),
      })),
      facts: factRows,
      evidence: evidence.map((e) => ({ ...presentEvidence(e, now), factCount: e._count.facts })),
      sources: [...sources.values()].sort((a, b) => b.count - a.count),
      research: {
        latestRun: latestRun ? presentRun(latestRun) : null,
        active: !!latestRun && ['QUEUED', 'RUNNING', 'WAITING'].includes(latestRun.status),
        history: runs.map((r) => ({ id: r.id, status: r.status, trigger: r.trigger, summary: r.summary, createdAt: r.createdAt, completedAt: r.completedAt })),
      },
      website: website
        ? {
            id: website.id,
            domain: website.domain,
            url: website.url,
            finalUrl: website.finalUrl,
            status: website.status,
            statusReason: website.statusReason,
            lastCheckedAt: website.lastCheckedAt,
            audit: audit
              ? {
                  id: audit.id,
                  status: audit.status,
                  auditVersion: audit.auditVersion,
                  performedAt: audit.performedAt,
                  hasSsl: audit.hasSsl,
                  mobileReady: audit.mobileReady,
                  hasContactForm: audit.hasContactForm,
                  hasBooking: audit.hasBooking,
                  hasChat: audit.hasChat,
                  hasClearCta: audit.hasClearCta,
                  copyrightYear: audit.copyrightYear,
                  technologySummary: audit.technologySummary,
                  findings: audit.findings,
                  confidence: audit.overallConfidence,
                }
              : null,
            snapshots: [...latestPerPage.values()].map((sn) => ({
              id: sn.id,
              pageType: sn.pageType,
              url: sn.finalUrl,
              title: sn.title,
              httpStatus: sn.httpStatus,
              fetchedAt: sn.fetchedAt,
              contentHash: sn.contentHash,
              byteSize: sn.byteSize,
              truncated: sn.truncated,
              evidenceId: sn.evidenceId,
              untrustedInstructions: (sn.metadata as { untrustedInstructions?: boolean } | null)?.untrustedInstructions === true,
            })),
          }
        : null,
      technologies: technologies.map((t) => ({
        key: t.technology.key,
        name: t.technology.name,
        category: t.technology.category,
        firstDetectedAt: t.firstDetectedAt,
        lastDetectedAt: t.lastDetectedAt,
        goneAt: t.goneAt,
        evidenceId: t.evidenceId,
      })),
      socialProfiles: social.map((sp) => ({ id: sp.id, platform: sp.platform, url: sp.profileUrl, handle: sp.handle, status: sp.status, matchConfidence: sp.matchConfidence, lastCheckedAt: sp.lastCheckedAt })),
      // Kept apart from facts: a hypothesis says "may", cites its evidence and can be invalidated (docs/17 §52-57).
      hypotheses: hypotheses.map((h) => ({
        id: h.id,
        key: h.key,
        hypothesis: h.hypothesis,
        reasonSummary: h.reasonSummary,
        status: h.status,
        confidence: h.confidence,
        source: h.source,
        generatedAt: h.generatedAt,
        lastSupportedAt: h.lastSupportedAt,
        expiresAt: h.expiresAt,
        evidence: h.evidence.map((he) => presentEvidence(he.evidence, now)).sort((a, b) => +b.observedAt - +a.observedAt),
      })),
      contactability: { ...contactability, decisionMakers },
      duplicates: candidates.map((c) => {
        const other = others.find((o) => o.id === (c.leftId === id ? c.rightId : c.leftId));
        return {
          candidateId: c.id,
          version: c.version,
          status: c.status,
          score: c.score,
          confidence: c.confidence,
          matching: c.matchingSignals,
          conflicting: c.conflictingSignals,
          other: other ? { ...presentCompany(other), peopleCount: other._count.employments } : null,
        };
      }),
      quality: {
        evidenceCount: evidence.length,
        factCount: factRows.length,
        conflictedFacts: factRows.filter((f) => f.status === 'CONFLICTED').length,
        staleFacts: factRows.filter((f) => f.freshness === 'STALE').length,
        lastObservedAt,
        freshness: lastObservedAt ? freshnessOf(lastObservedAt, now) : null,
        emails: allPoints.filter((p) => p.type === 'EMAIL').length,
        phones: allPoints.filter((p) => p.type !== 'EMAIL' && p.type !== 'OTHER').length,
        verifiedContacts: allPoints.filter((p) => p.status === 'VERIFIED').length,
        currentPeople: employments.filter((e) => e.isCurrent).length,
      },
      // The UI shows only what the server says is allowed now (docs/09 §67); the API still enforces every command.
      allowedActions: {
        edit: active && can('company.update'),
        archive: active && can('company.update'),
        restore: !company.mergedIntoId && company.status === 'ARCHIVED' && can('company.update'),
        managePeople: active && can('company.update'),
        manageContacts: active && can('company.update'),
        recordEvidence: active && can('evidence.manage'),
        resolveDuplicates: active && can('company.merge'),
        findDuplicates: active && can('company.update'),
        research: active && can('company.research'),
      },
    };
  }

  /** Business timeline from the audit trail of the company and everything attached to it (screen #4 §25). */
  async activity(workspaceId: string, id: string, q: { cursor?: string; limit: number }) {
    const db = this.prisma.client;
    const company = await db.company.findFirst({ where: { id, workspaceId }, select: { id: true } });
    if (!company) throw new NotFoundError(`company ${id} not found`);

    const [mergedFrom, employments, points, evidence, facts, candidates] = await Promise.all([
      db.company.findMany({ where: { workspaceId, mergedIntoId: id }, select: { id: true } }),
      db.employment.findMany({ where: { workspaceId, companyId: id }, select: { id: true, personId: true } }),
      db.contactPoint.findMany({ where: { workspaceId, entityType: 'COMPANY', entityId: id }, select: { id: true } }),
      db.evidence.findMany({ where: { workspaceId, entityType: 'COMPANY', entityId: id }, select: { id: true } }),
      db.fact.findMany({ where: { workspaceId, entityType: 'COMPANY', entityId: id }, select: { id: true } }),
      db.entityMatchCandidate.findMany({ where: { workspaceId, entityType: 'COMPANY', OR: [{ leftId: id }, { rightId: id }] }, select: { id: true } }),
    ]);
    const ids = [
      id,
      ...mergedFrom.map((c) => c.id),
      ...employments.flatMap((e) => [e.id, e.personId]),
      ...points.map((p) => p.id),
      ...evidence.map((e) => e.id),
      ...facts.map((f) => f.id),
      ...candidates.map((c) => c.id),
    ];

    const rows = await db.auditLog.findMany({
      where: { workspaceId, entityId: { in: ids } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      select: { id: true, action: true, entityType: true, entityId: true, actorType: true, actorId: true, reason: true, createdAt: true },
    });
    const page = rows.slice(0, q.limit);
    const userIds = [...new Set(page.filter((r) => r.actorType === 'HUMAN' && r.actorId).map((r) => r.actorId!))];
    const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];

    return {
      items: page.map((r) => ({
        id: r.id,
        at: r.createdAt,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        reason: r.reason,
        actor: { type: r.actorType, id: r.actorId, name: users.find((u) => u.id === r.actorId)?.name ?? null },
      })),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
      hasMore: rows.length > q.limit,
    };
  }

  /** Duplicate review queue (open = needs a decision, resolved = history of decisions). */
  async duplicates(workspaceId: string, q: { view: 'open' | 'resolved'; cursor?: string; limit: number }) {
    const db = this.prisma.client;
    const where: Prisma.EntityMatchCandidateWhereInput = {
      workspaceId,
      entityType: 'COMPANY',
      status: q.view === 'open' ? { in: OPEN_CANDIDATE } : { in: ['MERGED', 'REJECTED', 'AUTO_RESOLVED'] },
    };
    const [rows, openCount] = await Promise.all([
      db.entityMatchCandidate.findMany({
        where,
        orderBy: q.view === 'open' ? [{ score: 'desc' }, { id: 'asc' }] : [{ resolvedAt: 'desc' }, { id: 'asc' }],
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      db.entityMatchCandidate.count({ where: { workspaceId, entityType: 'COMPANY', status: { in: OPEN_CANDIDATE } } }),
    ]);
    const page = rows.slice(0, q.limit);
    const companyIds = [...new Set(page.flatMap((c) => [c.leftId, c.rightId]))];
    const [companies, people, evidence] = await Promise.all([
      db.company.findMany({ where: { id: { in: companyIds }, workspaceId } }),
      db.employment.groupBy({ by: ['companyId'], where: { workspaceId, companyId: { in: companyIds }, isCurrent: true }, _count: true }),
      db.evidence.groupBy({ by: ['entityId'], where: { workspaceId, entityType: 'COMPANY', entityId: { in: companyIds } }, _count: true }),
    ]);
    const side = (cid: string) => {
      const c = companies.find((x) => x.id === cid);
      return c
        ? { ...presentCompany(c), peopleCount: people.find((p) => p.companyId === cid)?._count ?? 0, evidenceCount: evidence.find((e) => e.entityId === cid)?._count ?? 0 }
        : null;
    };
    return {
      items: page.map((c) => ({
        id: c.id,
        version: c.version,
        status: c.status,
        score: c.score,
        confidence: c.confidence,
        matching: c.matchingSignals,
        conflicting: c.conflictingSignals,
        detectedAt: c.detectedAt,
        resolvedAt: c.resolvedAt,
        resolution: c.resolution,
        left: side(c.leftId),
        right: side(c.rightId),
      })),
      nextCursor: rows.length > q.limit ? page[page.length - 1]!.id : null,
      hasMore: rows.length > q.limit,
      openCount,
    };
  }
}
