import type { Prisma, PrismaClient } from '@revenue-os/database';
import { resolvePeriod, type AnalyticsFilters, type Period } from '@revenue-os/shared';

/**
 * A resolved analytics filter: the period, the previous period and the record restrictions. Market and industry narrow
 * the companies (market = companies observed by that market's discovery missions); a campaign narrows to its enrolled
 * companies (messages and conversations use the campaign directly); an owner narrows deals, meetings and revenue.
 */
export interface Scope {
  workspaceId: string;
  filters: AnalyticsFilters;
  period: Period;
  previous: Period;
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
  /** null = no company restriction. */
  companyIds: string[] | null;
  campaignId: string | null;
  ownerId: string | null;
  now: Date;
}

export async function companiesOfMarket(db: PrismaClient, workspaceId: string, marketId: string): Promise<string[]> {
  const rows = await db.discoveryObservation.findMany({ where: { workspaceId, mission: { marketId }, companyId: { not: null } }, select: { companyId: true }, distinct: ['companyId'] });
  return rows.map((r) => r.companyId!);
}

export async function resolveScope(db: PrismaClient, workspaceId: string, filters: AnalyticsFilters, now = new Date()): Promise<Scope> {
  const { current, previous } = resolvePeriod(filters.range, now, { from: filters.from, to: filters.to });
  let companyIds: string[] | null = null;
  const narrow = (ids: string[]) => {
    companyIds = companyIds === null ? ids : companyIds.filter((id) => ids.includes(id));
  };
  if (filters.marketId) narrow(await companiesOfMarket(db, workspaceId, filters.marketId));
  if (filters.industry?.trim()) {
    const rows = await db.company.findMany({ where: { workspaceId, industry: { contains: filters.industry.trim(), mode: 'insensitive' } }, select: { id: true } });
    narrow(rows.map((r) => r.id));
  }
  if (filters.campaignId) {
    const rows = await db.campaignEnrollment.findMany({ where: { workspaceId, campaignId: filters.campaignId }, select: { companyId: true } });
    narrow(rows.map((r) => r.companyId));
  }
  return {
    workspaceId,
    filters,
    period: current,
    previous,
    from: new Date(current.from),
    to: new Date(current.to),
    prevFrom: new Date(previous.from),
    prevTo: new Date(previous.to),
    companyIds,
    campaignId: filters.campaignId ?? null,
    ownerId: filters.ownerId ?? null,
    now,
  };
}

export const companyIn = (s: Scope) => (s.companyIds ? { companyId: { in: s.companyIds } } : {});

export const oppWhere = (s: Scope, extra: Prisma.OpportunityWhereInput = {}): Prisma.OpportunityWhereInput => ({ workspaceId: s.workspaceId, ...companyIn(s), ...(s.ownerId ? { ownerUserId: s.ownerId } : {}), ...extra });

export const meetingWhere = (s: Scope, extra: Prisma.MeetingWhereInput = {}): Prisma.MeetingWhereInput => ({ workspaceId: s.workspaceId, ...companyIn(s), ...(s.ownerId ? { ownerUserId: s.ownerId } : {}), ...extra });

export const convWhere = (s: Scope, extra: Prisma.ConversationWhereInput = {}): Prisma.ConversationWhereInput => ({ workspaceId: s.workspaceId, ...companyIn(s), ...(s.campaignId ? { campaignId: s.campaignId } : {}), ...extra });

export const messageWhere = (s: Scope, extra: Prisma.CampaignMessageWhereInput = {}): Prisma.CampaignMessageWhereInput => ({
  workspaceId: s.workspaceId,
  ...(s.campaignId ? { campaignId: s.campaignId } : {}),
  ...(s.companyIds ? { enrollment: { companyId: { in: s.companyIds } } } : {}),
  ...extra,
});

/** Revenue events in scope: by company, and by the owner's deals when an owner is selected. */
export async function revenueWhere(db: PrismaClient, s: Scope, extra: Prisma.RevenueEventWhereInput = {}): Promise<Prisma.RevenueEventWhereInput> {
  let opportunityId: { in: string[] } | undefined;
  if (s.ownerId) opportunityId = { in: (await db.opportunity.findMany({ where: oppWhere(s), select: { id: true } })).map((o) => o.id) };
  return { workspaceId: s.workspaceId, ...companyIn(s), ...(opportunityId ? { opportunityId } : {}), ...extra };
}

export const between = (from: Date, to: Date) => ({ gte: from, lt: to });
