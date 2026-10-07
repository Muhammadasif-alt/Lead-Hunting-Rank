import type { Prisma, PrismaClient } from '@revenue-os/database';
import { roleRelevance } from '@revenue-os/shared';

type Db = PrismaClient | Prisma.TransactionClient;

/** Who a campaign is for (screen #6 §3). Every filter is optional; contactability rules always apply. */
export interface AudienceFilter {
  /** Companies found by Lead Hunter missions of this market. */
  marketId?: string | null;
  /** Industry contains any of these (case-insensitive). */
  industries?: string[];
  /** Has an open opportunity hypothesis with one of these keys (e.g. NO_ONLINE_BOOKING). */
  opportunityKeys?: string[];
  /** Latest AI priority assessment is one of these. */
  priorities?: ('HIGH' | 'MEDIUM' | 'LOW')[];
}

export interface Candidate {
  companyId: string;
  companyName: string;
  personId: string;
  name: string;
  firstName: string | null;
  title: string | null;
  contactPointId: string;
  email: string;
  relevance: 'HIGH' | 'MEDIUM' | 'LOW';
  priority: string | null;
  opportunityKeys: string[];
}

export interface AudienceResult {
  matched: number;
  eligible: Candidate[];
  excluded: { noVerifiedEmail: number; suppressed: number; inOtherCampaign: number; recentlyContacted: number; alreadyEnrolled: number };
}

/** A prospect isn't contacted again within this many days by any campaign (screen #6 §46 global frequency cap). */
export const RECONTACT_DAYS = 30;
const LIVE = ['ENROLLED', 'ACTIVE', 'PAUSED'] as const;
const MAX_COMPANIES = 2000;

export function parseAudience(json: unknown): AudienceFilter {
  const a = (json ?? {}) as Record<string, unknown>;
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : undefined);
  return {
    marketId: typeof a.marketId === 'string' ? a.marketId : null,
    industries: strings(a.industries),
    opportunityKeys: strings(a.opportunityKeys),
    priorities: strings(a.priorities)?.filter((p): p is 'HIGH' | 'MEDIUM' | 'LOW' => ['HIGH', 'MEDIUM', 'LOW'].includes(p)),
  };
}

const firstNameOf = (p: { firstName: string | null; fullName: string }) => p.firstName?.trim() || p.fullName.trim().split(/\s+/)[0] || null;

/**
 * Who can be contacted now (screen #6 §3-4, docs/09 §28-33 eligibility): companies matching the filter that are active,
 * with a person whose email passed verification, not on the do-not-contact list, not in another live campaign, and
 * not contacted recently. One person per company — the best role fit.
 */
export async function findAudience(db: Db, workspaceId: string, filter: AudienceFilter, opts: { campaignId?: string; limit?: number; now?: Date } = {}): Promise<AudienceResult> {
  const now = opts.now ?? new Date();
  const where: Prisma.CompanyWhereInput = { workspaceId, mergedIntoId: null, status: { not: 'ARCHIVED' } };
  const and: Prisma.CompanyWhereInput[] = [];
  if (filter.marketId) {
    const obs = await db.discoveryObservation.findMany({ where: { workspaceId, mission: { marketId: filter.marketId }, companyId: { not: null } }, select: { companyId: true }, distinct: ['companyId'] });
    and.push({ id: { in: obs.map((o) => o.companyId!) } });
  }
  if (filter.industries?.length) and.push({ OR: filter.industries.map((i) => ({ industry: { contains: i, mode: 'insensitive' as const } })) });
  if (filter.opportunityKeys?.length) and.push({ hypotheses: { some: { key: { in: filter.opportunityKeys }, status: { in: ['ACTIVE', 'SUPPORTED', 'CANDIDATE'] } } } });
  if (filter.priorities?.length) and.push({ assessments: { some: { dimension: 'PRIORITY', supersededAt: null, level: { in: filter.priorities } } } });
  if (and.length) where.AND = and;

  const companies = await db.company.findMany({
    where,
    select: {
      id: true,
      displayName: true,
      hypotheses: { where: { status: { in: ['ACTIVE', 'SUPPORTED', 'CANDIDATE'] } }, select: { key: true } },
      assessments: { where: { dimension: 'PRIORITY', supersededAt: null }, select: { level: true }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
    take: MAX_COMPANIES,
  });
  const ids = companies.map((c) => c.id);
  const excluded = { noVerifiedEmail: 0, suppressed: 0, inOtherCampaign: 0, recentlyContacted: 0, alreadyEnrolled: 0 };
  if (!ids.length) return { matched: 0, eligible: [], excluded };

  // Sequential on purpose: `db` may be a transaction, which runs one query at a time.
  const jobs = await db.employment.findMany({ where: { workspaceId, companyId: { in: ids }, isCurrent: true }, include: { person: { select: { id: true, fullName: true, firstName: true, status: true } } } });
  const enrolledHere = opts.campaignId ? await db.campaignEnrollment.findMany({ where: { campaignId: opts.campaignId }, select: { companyId: true } }) : [];
  const suppressions = await db.suppression.findMany({ where: { workspaceId, status: 'ACTIVE' }, select: { scope: true, value: true }, take: 20_000 });
  const personIds = jobs.map((j) => j.personId);
  const points = await db.contactPoint.findMany({
    where: { workspaceId, entityType: 'PERSON', entityId: { in: personIds }, type: 'EMAIL', archivedAt: null, status: { not: 'INVALID' } },
    include: { verifications: { orderBy: { verifiedAt: 'desc' }, take: 1, select: { status: true } } },
  });
  // Verified = the latest verification says VALID (or a person marked it verified). Risky/catch-all/unknown are not
  // contacted automatically.
  const verified = points.filter((p) => p.verifications[0]?.status === 'VALID' || (p.status === 'VERIFIED' && !p.verifications[0]));
  const emails = [...new Set(verified.map((p) => p.normalizedValue))];
  const busy = await db.campaignEnrollment.findMany({ where: { workspaceId, email: { in: emails }, status: { in: [...LIVE] }, campaign: { status: { in: ['ACTIVE', 'PAUSED', 'READY'] } }, ...(opts.campaignId ? { campaignId: { not: opts.campaignId } } : {}) }, select: { email: true, companyId: true } });
  const recent = await db.campaignEnrollment.findMany({ where: { workspaceId, email: { in: emails }, lastSentAt: { gte: new Date(now.getTime() - RECONTACT_DAYS * 86_400_000) } }, select: { email: true } });
  const sup = new Set(suppressions.map((s) => `${s.scope}:${s.value}`));
  const isSuppressed = (companyId: string, personId: string, email: string) =>
    sup.has(`COMPANY:${companyId}`) || sup.has(`PERSON:${personId}`) || sup.has(`EMAIL:${email}`) || sup.has(`DOMAIN:${email.slice(email.lastIndexOf('@') + 1)}`);
  const busyCompanies = new Set(busy.map((b) => b.companyId));
  const busyEmails = new Set(busy.map((b) => b.email));
  const recentEmails = new Set(recent.map((r) => r.email));
  const here = new Set(enrolledHere.map((e) => e.companyId));
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;

  const eligible: Candidate[] = [];
  for (const c of companies) {
    if (here.has(c.id)) {
      excluded.alreadyEnrolled++;
      continue;
    }
    const options = jobs
      .filter((j) => j.companyId === c.id && j.person.status !== 'ARCHIVED')
      .flatMap((j) => verified.filter((p) => p.entityId === j.personId).map((p) => ({ j, p, relevance: roleRelevance(j.title) })))
      .sort((a, b) => rank[a.relevance] - rank[b.relevance] || Number(b.p.isPrimary) - Number(a.p.isPrimary));
    if (!options.length) {
      excluded.noVerifiedEmail++;
      continue;
    }
    if (sup.has(`COMPANY:${c.id}`) || options.every((o) => isSuppressed(c.id, o.j.personId, o.p.normalizedValue))) {
      excluded.suppressed++;
      continue;
    }
    const usable = options.filter((o) => !isSuppressed(c.id, o.j.personId, o.p.normalizedValue));
    if (busyCompanies.has(c.id) || usable.every((o) => busyEmails.has(o.p.normalizedValue))) {
      excluded.inOtherCampaign++;
      continue;
    }
    const pick = usable.find((o) => !recentEmails.has(o.p.normalizedValue));
    if (!pick) {
      excluded.recentlyContacted++;
      continue;
    }
    eligible.push({
      companyId: c.id,
      companyName: c.displayName,
      personId: pick.j.personId,
      name: pick.j.person.fullName,
      firstName: firstNameOf(pick.j.person),
      title: pick.j.title,
      contactPointId: pick.p.id,
      email: pick.p.normalizedValue,
      relevance: pick.relevance,
      priority: c.assessments[0]?.level ?? null,
      opportunityKeys: [...new Set(c.hypotheses.map((h) => h.key))],
    });
  }
  // Highest priority first, then best role fit.
  const prio = (p: string | null) => (p === 'HIGH' ? 0 : p === 'MEDIUM' ? 1 : p === 'LOW' ? 2 : 3);
  eligible.sort((a, b) => prio(a.priority) - prio(b.priority) || rank[a.relevance] - rank[b.relevance]);
  return { matched: companies.length, eligible: opts.limit ? eligible.slice(0, opts.limit) : eligible, excluded };
}
