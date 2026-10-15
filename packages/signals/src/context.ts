import type { PrismaClient } from '@revenue-os/database';
import { recordEvidenceTx, type ServiceContext, type Tx } from '@revenue-os/domain';
import { RESEARCH_FRESH_DAYS, serviceThemes, SIGNAL_TYPES, type Level, type Relationship, type ServiceTheme, type SignalTypeKey, type SourceKind, type SourceTrust } from '@revenue-os/shared';
import { DAY } from './deps.js';

type Db = PrismaClient | Tx;

/** How much a stored observation is trusted (screen #9 §13): what they told us > the official website > a listing. */
export function trustOf(sourceType: string): SourceTrust {
  switch (sourceType) {
    case 'CONVERSATION':
    case 'COMMITMENT':
    case 'PIPELINE':
    case 'MEMORY':
      return 'FIRST_PARTY';
    case 'WEBSITE':
      return 'OFFICIAL_WEBSITE';
    case 'LEAD_SOURCE':
    case 'DISCOVERY':
      return 'LEAD_SOURCE';
    case 'HUMAN':
    case 'MANUAL':
    case 'CRM':
      return 'PERSON_ENTERED';
    default:
      return 'OTHER';
  }
}

/** Where a signal type normally comes from — the queue groups by it. */
export const sourceKindOf = (type: SignalTypeKey): SourceKind => {
  const s = SIGNAL_TYPES[type].source;
  return s === 'NONE' ? 'HUMAN' : s;
};

export interface OfferService {
  name: string;
  themes: ServiceTheme[];
}

/** Everything relevance needs about a company right now: relationship, ICP, what we sell, how fresh research is. */
export interface CompanySignalContext {
  company: { id: string; name: string; industry: string | null; city: string | null; status: string; websiteDomain: string | null };
  relationship: Relationship;
  /** The open (or lost) deal that defines the relationship. */
  opportunityId: string | null;
  conversationId: string | null;
  icp: Level | null;
  services: OfferService[];
  researchFresh: boolean;
  researchedAt: Date | null;
  marketIds: string[];
}

const textOf = (v: unknown): string => (typeof v === 'string' ? v : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('. ') : '');

/** Approved services in the Knowledge Base (the only things we can honestly offer) with the themes they cover. */
export async function approvedServices(db: Db, workspaceId: string): Promise<OfferService[]> {
  const items = await db.knowledgeItem.findMany({ where: { workspaceId, type: 'SERVICE', status: 'APPROVED', archivedAt: null, currentRevisionId: { not: null } }, select: { currentRevisionId: true, title: true }, take: 200 });
  if (!items.length) return [];
  const revs = await db.knowledgeRevision.findMany({ where: { id: { in: items.map((i) => i.currentRevisionId!) } }, select: { title: true, content: true } });
  return revs.map((r) => {
    const c = (r.content ?? {}) as Record<string, unknown>;
    const name = textOf(c.name).trim() || r.title;
    return { name, themes: serviceThemes([name, textOf(c.description), textOf(c.capabilities), textOf(c.problems)].join('. ')) };
  });
}

/** Offer inputs for one signal type: every approved theme, and the names of the services that fit this type. */
export function offerFor(type: SignalTypeKey, services: OfferService[]): { offerThemes: ServiceTheme[]; offerNames: string[] } {
  const typeThemes: readonly ServiceTheme[] = SIGNAL_TYPES[type].themes;
  const offerThemes = [...new Set(services.flatMap((s) => s.themes))];
  const offerNames = services.filter((s) => s.themes.some((t) => typeThemes.includes(t) || t === 'GENERAL')).map((s) => s.name);
  return { offerThemes, offerNames: typeThemes.length ? offerNames : [] };
}

/**
 * The relationship decides what a signal may lead to (screen #9 §26-27): customers and open deals are never cold
 * prospects; anyone we have spoken to recently is "in conversation"; long silence is dormant.
 */
export async function companySignalContext(db: Db, workspaceId: string, companyId: string, now: Date): Promise<CompanySignalContext> {
  const company = await db.company.findFirstOrThrow({ where: { id: companyId, workspaceId }, select: { id: true, displayName: true, industry: true, city: true, status: true, websiteDomain: true } });
  const open = await db.opportunity.findFirst({ where: { workspaceId, companyId, status: 'OPEN' }, orderBy: { lastActivityAt: 'desc' }, select: { id: true } });
  const conv = await db.conversation.findFirst({ where: { workspaceId, companyId }, orderBy: { lastMessageAt: 'desc' }, select: { id: true, lastMessageAt: true } });
  const lost = await db.opportunity.findFirst({ where: { workspaceId, companyId, status: 'LOST' }, orderBy: { updatedAt: 'desc' }, select: { id: true } });
  const icpRow = await db.companyAssessment.findFirst({ where: { workspaceId, companyId, dimension: 'ICP_FIT', supersededAt: null }, orderBy: { assessedAt: 'desc' }, select: { level: true } });
  const run = await db.researchRun.findFirst({ where: { workspaceId, companyId, status: { in: ['COMPLETED', 'PARTIAL'] } }, orderBy: { completedAt: 'desc' }, select: { completedAt: true } });
  const markets = await db.discoveryObservation.findMany({ where: { workspaceId, companyId }, select: { mission: { select: { marketId: true } } }, distinct: ['missionId'], take: 50 });
  const services = await approvedServices(db, workspaceId);

  let relationship: Relationship = 'COLD';
  let opportunityId: string | null = null;
  let conversationId: string | null = null;
  const convAge = conv ? (now.getTime() - conv.lastMessageAt.getTime()) / DAY : null;
  if (company.status === 'CUSTOMER') relationship = 'CUSTOMER';
  else if (company.status === 'FORMER_CUSTOMER') relationship = 'FORMER_CUSTOMER';
  else if (open) relationship = 'OPEN_DEAL';
  else if (conv && convAge! <= 120) relationship = 'IN_CONVERSATION';
  else if (lost) relationship = 'LOST_DEAL';
  else if (conv) relationship = 'DORMANT';
  if (open) opportunityId = open.id;
  else if (lost && relationship === 'LOST_DEAL') opportunityId = lost.id;
  if (conv && relationship !== 'COLD') conversationId = conv.id;

  const icp = icpRow && icpRow.level !== 'UNKNOWN' ? (icpRow.level as Level) : null;
  const researchedAt = run?.completedAt ?? null;
  return {
    company: { id: company.id, name: company.displayName, industry: company.industry, city: company.city, status: company.status, websiteDomain: company.websiteDomain },
    relationship,
    opportunityId,
    conversationId,
    icp,
    services,
    researchFresh: !!researchedAt && now.getTime() - researchedAt.getTime() <= RESEARCH_FRESH_DAYS * DAY,
    researchedAt,
    marketIds: [...new Set(markets.map((m) => m.mission.marketId))],
  };
}

/**
 * Evidence for a first-party or internal observation, recorded once per source record: the internal reference
 * (`revenue-os://<kind>/<id>`) makes a retried detection job reuse the same row instead of adding another.
 */
export async function ensureEvidenceTx(
  tx: Tx,
  ctx: ServiceContext,
  input: { companyId: string; ref: string; evidenceType: string; sourceType: string; sourceName: string; excerpt: string; observedAt: Date; confidence?: 'HIGH' | 'MEDIUM' | 'LOW' },
): Promise<string> {
  const sourceUrl = `revenue-os://${input.ref}`;
  const existing = await tx.evidence.findFirst({ where: { workspaceId: ctx.workspaceId, entityType: 'COMPANY', entityId: input.companyId, sourceUrl }, select: { id: true } });
  if (existing) return existing.id;
  const now = new Date();
  const ev = await recordEvidenceTx(tx, ctx, {
    entityType: 'COMPANY',
    entityId: input.companyId,
    evidenceType: input.evidenceType,
    sourceType: input.sourceType,
    sourceName: input.sourceName,
    sourceUrl,
    observedAt: input.observedAt > now ? now : input.observedAt,
    contentExcerpt: input.excerpt.slice(0, 600),
    confidence: input.confidence ?? 'HIGH',
  });
  return ev.id;
}

/** One comparison a detector made (screen #9 §36 funnel). Idempotent per company + subject + time. */
export async function recordObservationTx(
  tx: Tx,
  ctx: ServiceContext,
  input: { companyId: string; sourceKind: SourceKind; subject: string; changeLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH'; detail: string | null; observedAt: Date; signalId?: string | null },
): Promise<void> {
  const subject = input.subject.slice(0, 200);
  const existing = await tx.signalObservation.findFirst({ where: { workspaceId: ctx.workspaceId, companyId: input.companyId, sourceKind: input.sourceKind, subject, observedAt: input.observedAt }, select: { id: true, signalId: true } });
  if (existing) {
    if (input.signalId && !existing.signalId) await tx.signalObservation.update({ where: { id: existing.id }, data: { signalId: input.signalId } });
    return;
  }
  await tx.signalObservation.create({ data: { workspaceId: ctx.workspaceId, companyId: input.companyId, sourceKind: input.sourceKind, subject, changeLevel: input.changeLevel, detail: input.detail?.slice(0, 500) ?? null, signalId: input.signalId ?? null, observedAt: input.observedAt } });
}
