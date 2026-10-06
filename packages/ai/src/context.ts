import type { PrismaClient } from '@revenue-os/database';
import { assessContactability, freshnessOf, roleRelevance, type Freshness } from '@revenue-os/shared';

export interface EvidenceRef {
  id: string;
  kind: string;
  source: string;
  url: string | null;
  observedAt: string;
  /** How much to trust it (docs/08 §113-115): the official website outranks a directory listing. */
  trust: 'OFFICIAL_WEBSITE' | 'LEAD_SOURCE' | 'PERSON_ENTERED' | 'OTHER';
  freshness: Freshness;
}

/**
 * What an agent sees about one company (docs/08 §73-80): the least sufficient package, every item with its source and
 * date, scoped to the workspace — never the whole database. Untrusted page text is kept apart and capped; prompts
 * fence it as data.
 */
export interface CompanyContext {
  workspaceId: string;
  company: { id: string; name: string; industry: string | null; city: string | null; region: string | null; country: string | null; website: string | null; phone: string | null };
  facts: { field: string; value: unknown; status: string; confidence: string; evidenceIds: string[] }[];
  website: { status: string; reason: string | null; checkedAt: string | null } | null;
  audit: { findings: { key: string; label: string; observed: boolean | null; detail: string; evidenceIds: string[] }[]; technologies: string[]; copyrightYear: number | null; pagesChecked: number } | null;
  hypotheses: { id: string; key: string; hypothesis: string; reason: string; confidence: string; source: string; status: string; evidenceIds: string[] }[];
  people: { personId: string; name: string; title: string | null; relevance: 'HIGH' | 'MEDIUM' | 'LOW'; confidence: string; emails: { contactPointId: string; value: string; status: string; verification: string | null }[]; evidenceIds: string[] }[];
  companyContacts: { contactPointId: string; type: string; value: string; status: string; verification: string | null }[];
  contactability: { level: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'; reasons: string[]; contactForm: boolean | null };
  research: { status: string; gaps: string[]; completedAt: string | null } | null;
  evidence: EvidenceRef[];
  untrusted: { evidenceId: string; url: string; text: string; flagged: boolean }[];
}

const MAX_EVIDENCE = 40;
const MAX_UNTRUSTED_CHARS = 1500;

function trustOf(sourceType: string, evidenceType: string): EvidenceRef['trust'] {
  if (sourceType === 'WEBSITE') return 'OFFICIAL_WEBSITE';
  if (sourceType === 'LEAD_SOURCE') return 'LEAD_SOURCE';
  if (evidenceType === 'OBSERVATION' || sourceType === 'HUMAN' || sourceType === 'MANUAL') return 'PERSON_ENTERED';
  return 'OTHER';
}

const FINDING_FIELD: Record<string, string> = {
  ssl: 'website.https',
  mobile: 'website.mobile_viewport',
  contact_form: 'website.contact_form',
  booking: 'website.online_booking',
  chat: 'website.live_chat',
  cta: 'website.call_to_action',
  freshness: 'website.copyright_year',
};

export async function buildCompanyContext(db: PrismaClient, workspaceId: string, companyId: string, now = new Date()): Promise<CompanyContext> {
  const company = await db.company.findFirstOrThrow({ where: { id: companyId, workspaceId } });
  const [facts, evidence, website, hypotheses, employments, companyPoints, run] = await Promise.all([
    db.fact.findMany({ where: { workspaceId, entityType: 'COMPANY', entityId: companyId, status: { in: ['ACTIVE', 'CONFLICTED'] } }, include: { evidence: { select: { evidenceId: true } } }, orderBy: { field: 'asc' } }),
    db.evidence.findMany({ where: { workspaceId, entityType: 'COMPANY', entityId: companyId }, orderBy: { observedAt: 'desc' }, take: MAX_EVIDENCE }),
    db.website.findFirst({ where: { workspaceId, companyId, isOfficial: true }, orderBy: { lastCheckedAt: { sort: 'desc', nulls: 'last' } }, include: { audits: { orderBy: { performedAt: 'desc' }, take: 1 }, snapshots: { orderBy: { fetchedAt: 'desc' }, take: 6 } } }),
    db.opportunityHypothesis.findMany({ where: { workspaceId, companyId, status: { in: ['ACTIVE', 'SUPPORTED', 'CANDIDATE'] } }, include: { evidence: { select: { evidenceId: true } } } }),
    db.employment.findMany({ where: { workspaceId, companyId, isCurrent: true }, include: { person: true } }),
    db.contactPoint.findMany({ where: { workspaceId, entityType: 'COMPANY', entityId: companyId, archivedAt: null }, include: { verifications: { orderBy: { verifiedAt: 'desc' }, take: 1 } } }),
    db.researchRun.findFirst({ where: { workspaceId, companyId }, orderBy: { createdAt: 'desc' } }),
  ]);
  const personIds = employments.map((e) => e.personId);
  const [personPoints, personEvidence] = await Promise.all([
    db.contactPoint.findMany({ where: { workspaceId, entityType: 'PERSON', entityId: { in: personIds }, archivedAt: null }, include: { verifications: { orderBy: { verifiedAt: 'desc' }, take: 1 } } }),
    db.evidence.findMany({ where: { workspaceId, entityType: 'PERSON', entityId: { in: personIds } }, orderBy: { observedAt: 'desc' }, take: 20 }),
  ]);

  const allEvidence = [...evidence, ...personEvidence];
  const refs: EvidenceRef[] = allEvidence.map((e) => ({
    id: e.id,
    kind: e.evidenceType,
    source: e.provider ?? e.sourceName ?? e.sourceType,
    url: e.sourceUrl,
    observedAt: e.observedAt.toISOString(),
    trust: trustOf(e.sourceType, e.evidenceType),
    freshness: freshnessOf(e.observedAt, now),
  }));
  const known = new Set(refs.map((r) => r.id));
  const keep = (ids: string[]) => ids.filter((id) => known.has(id));

  const audit = website?.audits[0] ?? null;
  const findings = (audit?.findings ?? []) as { key: string; label: string; observed: boolean | null; detail: string }[];
  const point = (p: (typeof companyPoints)[number]) => ({ contactPointId: p.id, type: p.type, value: p.value, status: p.status, verification: p.verifications[0]?.status ?? null });

  const people = employments.map((e) => ({
    personId: e.personId,
    name: e.person.fullName,
    title: e.title,
    relevance: roleRelevance(e.title),
    confidence: e.confidence,
    emails: personPoints.filter((p) => p.entityId === e.personId && p.type === 'EMAIL').map((p) => ({ contactPointId: p.id, value: p.value, status: p.status, verification: p.verifications[0]?.status ?? null })),
    evidenceIds: personEvidence.filter((ev) => ev.entityId === e.personId).map((ev) => ev.id),
  }));
  const companyContacts = companyPoints.map(point);
  const contactability = assessContactability({
    emails: [...companyContacts.filter((c) => c.type === 'EMAIL').map((c) => ({ status: c.status, verification: c.verification, person: null })), ...people.flatMap((p) => p.emails.map((m) => ({ status: m.status, verification: m.verification, person: { name: p.name, relevance: p.relevance } })))] as Parameters<typeof assessContactability>[0]['emails'],
    phones: companyContacts.filter((c) => c.type !== 'EMAIL' && c.type !== 'OTHER').length || (company.phone ? 1 : 0),
    contactForm: audit?.hasContactForm ?? null,
  });

  return {
    workspaceId,
    company: { id: company.id, name: company.displayName, industry: company.industry, city: company.city, region: company.region, country: company.country, website: company.websiteDomain, phone: company.phone },
    facts: facts.map((f) => ({ field: f.field, value: f.valueJson, status: f.status, confidence: f.confidence, evidenceIds: keep(f.evidence.map((x) => x.evidenceId)) })),
    website: website ? { status: website.status, reason: website.statusReason, checkedAt: website.lastCheckedAt?.toISOString() ?? null } : null,
    audit: audit
      ? {
          findings: findings.map((f) => ({ ...f, evidenceIds: keep(facts.find((x) => x.field === FINDING_FIELD[f.key])?.evidence.map((x) => x.evidenceId) ?? []) })),
          technologies: audit.technologySummary,
          copyrightYear: audit.copyrightYear,
          pagesChecked: new Set(website!.snapshots.map((s) => s.pageType)).size,
        }
      : null,
    hypotheses: hypotheses.map((h) => ({ id: h.id, key: h.key, hypothesis: h.hypothesis, reason: h.reasonSummary, confidence: h.confidence, source: h.source, status: h.status, evidenceIds: keep(h.evidence.map((x) => x.evidenceId)) })),
    people,
    companyContacts,
    contactability: { ...contactability, contactForm: audit?.hasContactForm ?? null },
    research: run ? { status: run.status, gaps: run.gaps, completedAt: run.completedAt?.toISOString() ?? null } : null,
    evidence: refs,
    // Latest snapshot per page, capped — untrusted data, fenced in prompts (docs/08 §69).
    untrusted: (website?.snapshots ?? [])
      .filter((s, i, all) => all.findIndex((x) => x.pageType === s.pageType) === i)
      .filter((s) => s.evidenceId && known.has(s.evidenceId))
      .map((s) => ({ evidenceId: s.evidenceId!, url: s.finalUrl, text: (s.textExcerpt ?? '').slice(0, MAX_UNTRUSTED_CHARS), flagged: (s.metadata as { untrustedInstructions?: boolean } | null)?.untrustedInstructions === true })),
  };
}
