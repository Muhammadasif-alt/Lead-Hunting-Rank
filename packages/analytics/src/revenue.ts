import type { Prisma, PrismaClient } from '@revenue-os/database';

type RevenueEvent = Prisma.RevenueEventGetPayload<object>;
import { writeAudit, type ServiceContext } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { BusinessRuleError, NotFoundError, ValidationError, type RevenueEventRow } from '@revenue-os/shared';
import { DAY, TX } from './deps.js';

export const MANUAL_REVENUE_TYPES = ['PAYMENT', 'EXPANSION', 'REFUND'] as const;
export type ManualRevenueType = (typeof MANUAL_REVENUE_TYPES)[number];

export interface RecordRevenueInput {
  opportunityId: string;
  type: ManualRevenueType;
  amountMinor: number;
  currency?: string | null;
  occurredAt?: Date | null;
  note?: string | null;
}

/** Net recorded revenue of a deal: WON + PAYMENT + EXPANSION − REFUND (minor units). */
export function netRevenue(events: Pick<RevenueEvent, 'type' | 'amountMinor'>[]): number {
  return events.reduce((sum, e) => sum + (e.type === 'REFUND' ? -e.amountMinor : e.amountMinor), 0);
}

/**
 * A person records a payment, an expansion or a refund on a WON deal (docs/06 §133-146). Refunds are new negative
 * events, never edits, and can not exceed what was recorded for the deal. Audit + RevenueRecorded in the same tx.
 */
export async function recordRevenue(db: PrismaClient, ctx: ServiceContext, input: RecordRevenueInput): Promise<RevenueEventRow> {
  if (!MANUAL_REVENUE_TYPES.includes(input.type)) throw new ValidationError('Unknown revenue type', [{ path: 'type', message: 'PAYMENT, EXPANSION or REFUND' }]);
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) throw new ValidationError('Enter an amount above 0', [{ path: 'amountMinor', message: 'Must be more than 0' }]);
  const now = new Date();
  if (input.occurredAt && input.occurredAt.getTime() > now.getTime() + DAY) throw new ValidationError('The date can not be in the future', [{ path: 'occurredAt', message: 'Future date' }]);
  const ev = await db.$transaction(async (tx) => {
    const o = await tx.opportunity.findFirst({ where: { id: input.opportunityId, workspaceId: ctx.workspaceId } });
    if (!o) throw new NotFoundError('Opportunity not found');
    if (o.status !== 'WON') throw new BusinessRuleError('INVALID_STATE_TRANSITION', `Revenue can only be recorded on a won deal — this one is ${o.status.toLowerCase()}`);
    const currency = (input.currency ?? o.currency).toUpperCase();
    if (currency !== o.currency) throw new ValidationError(`This deal is in ${o.currency}`, [{ path: 'currency', message: `Use ${o.currency}` }]);
    if (input.type === 'REFUND') {
      const net = netRevenue(await tx.revenueEvent.findMany({ where: { workspaceId: ctx.workspaceId, opportunityId: o.id }, select: { type: true, amountMinor: true } }));
      if (input.amountMinor > net) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `A refund can not exceed the revenue recorded for this deal (${(net / 100).toFixed(2)} ${o.currency})`);
    }
    const created = await tx.revenueEvent.create({ data: { workspaceId: ctx.workspaceId, opportunityId: o.id, companyId: o.companyId, type: input.type, amountMinor: input.amountMinor, currency, occurredAt: input.occurredAt ?? now, note: input.note?.trim().slice(0, 500) || null, createdByType: ctx.actor.type, createdById: ctx.actor.id } });
    await writeAudit(tx, ctx, { action: 'revenue.recorded', entityType: 'REVENUE_EVENT', entityId: created.id, after: { opportunityId: o.id, type: created.type, amountMinor: created.amountMinor, currency }, reason: created.note ?? undefined });
    await recordEvent(tx, ctx, 'RevenueRecorded', created.id, { revenueEventId: created.id, opportunityId: o.id, companyId: o.companyId, type: created.type, amountMinor: created.amountMinor, currency });
    return created;
  }, TX);
  return (await toRows(db, ctx.workspaceId, [ev]))[0]!;
}

async function toRows(db: PrismaClient, workspaceId: string, events: RevenueEvent[]): Promise<RevenueEventRow[]> {
  if (!events.length) return [];
  const [opps, companies, users] = await Promise.all([
    db.opportunity.findMany({ where: { workspaceId, id: { in: [...new Set(events.map((e) => e.opportunityId))] } }, select: { id: true, name: true } }),
    db.company.findMany({ where: { workspaceId, id: { in: [...new Set(events.map((e) => e.companyId))] } }, select: { id: true, displayName: true } }),
    db.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.createdById).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))] } }, select: { id: true, name: true } }),
  ]);
  const opp = new Map(opps.map((o) => [o.id, o.name]));
  const co = new Map(companies.map((c) => [c.id, c.displayName]));
  const user = new Map(users.map((u) => [u.id, u.name]));
  return events.map((e) => ({
    id: e.id,
    opportunityId: e.opportunityId,
    opportunity: opp.get(e.opportunityId) ?? 'Unknown deal',
    companyId: e.companyId,
    company: co.get(e.companyId) ?? 'Unknown company',
    type: e.type,
    amountMinor: e.amountMinor,
    currency: e.currency,
    occurredAt: e.occurredAt.toISOString(),
    note: e.note,
    createdBy: e.createdByType === 'HUMAN' ? (user.get(e.createdById ?? '') ?? 'A person') : e.createdByType === 'SYSTEM' ? 'System (deal won)' : e.createdByType,
  }));
}

/** Revenue events, newest first (max 200), optionally for one deal or a time window. */
export async function listRevenue(db: PrismaClient, workspaceId: string, q: { opportunityId?: string; from?: Date; to?: Date } = {}): Promise<RevenueEventRow[]> {
  const events = await db.revenueEvent.findMany({
    where: { workspaceId, ...(q.opportunityId ? { opportunityId: q.opportunityId } : {}), ...(q.from || q.to ? { occurredAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}) },
    orderBy: { occurredAt: 'desc' },
    take: 200,
  });
  return toRows(db, workspaceId, events);
}
