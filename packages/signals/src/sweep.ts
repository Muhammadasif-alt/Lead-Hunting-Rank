import type { Prisma } from '@revenue-os/database';
import { requestResearchTx, writeAudit, type Tx } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { MONITOR_BATCH, OPEN_SIGNAL_STATUSES, SIGNAL_TYPES, WATCHLIST_CADENCE_DAYS, type SignalTypeKey } from '@revenue-os/shared';
import { lostDealRevisitTx } from './detectors.js';
import { DAY, nowOf, systemCtx, TX, type SignalDeps } from './deps.js';

const BATCH = 500;
const MAX_LOST_DEAL_AGE_DAYS = 30;
export const WINDOW_MISSED_REASON = 'Action window passed without action';

type Priority = 'HIGH' | 'NORMAL' | 'LOW';
const PRIORITY_RANK: Record<Priority, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };

/** Who belongs on a kept-in-sync watchlist right now. */
export async function dynamicMembers(db: Tx | SignalDeps['db'], workspaceId: string, kind: string, marketId: string | null): Promise<string[]> {
  switch (kind) {
    case 'OPEN_DEALS':
      return (await db.opportunity.findMany({ where: { workspaceId, status: 'OPEN' }, select: { companyId: true }, distinct: ['companyId'], take: 5000 })).map((o) => o.companyId);
    case 'LOST_DEALS': {
      const open = new Set((await db.opportunity.findMany({ where: { workspaceId, status: 'OPEN' }, select: { companyId: true }, distinct: ['companyId'] })).map((o) => o.companyId));
      const lost = await db.opportunity.findMany({ where: { workspaceId, status: 'LOST' }, select: { companyId: true }, distinct: ['companyId'], take: 5000 });
      return lost.map((o) => o.companyId).filter((id) => !open.has(id));
    }
    case 'CUSTOMERS':
      return (await db.company.findMany({ where: { workspaceId, status: 'CUSTOMER', mergedIntoId: null }, select: { id: true }, take: 5000 })).map((c) => c.id);
    case 'MARKET':
      if (!marketId) return [];
      return (await db.discoveryObservation.findMany({ where: { workspaceId, mission: { marketId }, companyId: { not: null } }, select: { companyId: true }, distinct: ['companyId'], take: 5000 })).map((o) => o.companyId!);
    default:
      return [];
  }
}

/** Brings a dynamic watchlist in line with reality: adds new members; deal/customer lists also drop those who left. */
export async function syncWatchlistTx(tx: Tx, workspaceId: string, list: { id: string; kind: string; marketId: string | null }): Promise<{ added: number; removed: number }> {
  if (list.kind === 'MANUAL') return { added: 0, removed: 0 };
  const ctx = systemCtx(workspaceId);
  const want = await dynamicMembers(tx, workspaceId, list.kind, list.marketId);
  const reason = list.kind === 'MARKET' ? 'Found in the saved market' : 'Kept in sync';
  const { count: added } = want.length ? await tx.signalWatchlistMember.createMany({ data: want.map((companyId) => ({ workspaceId, watchlistId: list.id, companyId, reason })), skipDuplicates: true }) : { count: 0 };
  // A market list only grows (a business found once stays watched); deal and customer lists follow the pipeline.
  const { count: removed } = list.kind === 'MARKET' ? { count: 0 } : await tx.signalWatchlistMember.deleteMany({ where: { watchlistId: list.id, companyId: { notIn: want } } });
  if (added) await recordEvent(tx, ctx, 'WatchlistChanged', list.id, { watchlistId: list.id, change: 'MEMBERS_ADDED', count: added });
  if (removed) await recordEvent(tx, ctx, 'WatchlistChanged', list.id, { watchlistId: list.id, change: 'MEMBERS_REMOVED', count: removed });
  return { added, removed };
}

/**
 * Periodic signal upkeep (screen #9 §14, §31, §35): expire signals past their usefulness, flag action windows that
 * passed, open lost-deal revisits, keep dynamic watchlists in sync and queue monitoring research (trigger MONITOR) for
 * watched companies that are due — at most MONITOR_BATCH per sweep. Never contacts anyone.
 */
export async function signalSweep(deps: SignalDeps, opts: { workspaceId?: string } = {}) {
  const { db } = deps;
  const now = nowOf(deps);
  const ws = opts.workspaceId ? { workspaceId: opts.workspaceId } : {};
  const result = { expired: 0, windowsMissed: 0, revisits: 0, membersAdded: 0, membersRemoved: 0, monitored: 0 };

  // 1) Too old to drive a "why now".
  const expired = await db.signal.findMany({ where: { ...ws, status: { in: OPEN_SIGNAL_STATUSES }, expiresAt: { lt: now } }, take: BATCH, select: { id: true, workspaceId: true, type: true, status: true } });
  if (expired.length) {
    await db.$transaction(async (tx) => {
      for (const s of expired) {
        const ctx = systemCtx(s.workspaceId);
        await tx.signal.update({ where: { id: s.id }, data: { status: 'EXPIRED', statusReason: `Older than its ${SIGNAL_TYPES[s.type as SignalTypeKey]?.lifetimeDays ?? '?'}-day usefulness`, version: { increment: 1 } } });
        await writeAudit(tx, ctx, { action: 'signal.expired', entityType: 'SIGNAL', entityId: s.id, before: { status: s.status }, after: { status: 'EXPIRED' } });
        await recordEvent(tx, ctx, 'SignalExpired', s.id, { signalId: s.id, type: s.type });
        await recordEvent(tx, ctx, 'SignalStatusChanged', s.id, { signalId: s.id, from: s.status, to: 'EXPIRED', reason: 'Expired' });
      }
    }, TX);
    result.expired = expired.length;
  }

  // 2) Time-boxed signals whose window passed with nobody acting (status kept; flagged once).
  const missed = await db.signal.findMany({ where: { ...ws, status: { in: OPEN_SIGNAL_STATUSES }, windowEndsAt: { lt: now }, OR: [{ statusReason: null }, { NOT: { statusReason: { startsWith: WINDOW_MISSED_REASON } } }] }, take: BATCH, select: { id: true, workspaceId: true, companyId: true, type: true } });
  if (missed.length) {
    await db.$transaction(async (tx) => {
      for (const s of missed) {
        await tx.signal.update({ where: { id: s.id }, data: { statusReason: WINDOW_MISSED_REASON } });
        await recordEvent(tx, systemCtx(s.workspaceId), 'SignalWindowMissed', s.id, { signalId: s.id, companyId: s.companyId, type: s.type });
      }
    }, TX);
    result.windowsMissed = missed.length;
  }

  // 3) Lost deals whose revisit date has come.
  const losses = await db.opportunityLoss.findMany({ where: { ...ws, revisitAt: { lte: now, gte: new Date(now.getTime() - MAX_LOST_DEAL_AGE_DAYS * DAY) }, reopenedAt: null, opportunity: { status: 'LOST' } }, select: { workspaceId: true, opportunityId: true }, take: BATCH });
  for (const l of losses) {
    const r = await db.$transaction((tx) => lostDealRevisitTx(tx, systemCtx(l.workspaceId), { opportunityId: l.opportunityId }, now), TX);
    if (r) result.revisits++;
  }

  // 4) Dynamic watchlists follow the pipeline, customers and saved markets.
  const lists = await db.signalWatchlist.findMany({ where: { ...ws, archivedAt: null }, select: { id: true, workspaceId: true, kind: true, marketId: true } });
  for (const list of lists.filter((l) => l.kind !== 'MANUAL')) {
    const r = await db.$transaction((tx) => syncWatchlistTx(tx, list.workspaceId, list), TX);
    result.membersAdded += r.added;
    result.membersRemoved += r.removed;
  }

  // 5) Monitoring: watched companies whose check is due → a MONITOR research run (website re-read → change detection).
  const due = await db.signalWatchlistMember.findMany({
    where: { ...ws, watchlist: { archivedAt: null }, OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: now } }], company: { mergedIntoId: null, status: { notIn: ['ARCHIVED', 'DISQUALIFIED'] } } },
    include: { watchlist: { select: { priority: true } }, company: { select: { websiteDomain: true } } },
    take: 2000,
  });
  due.sort((a, b) => PRIORITY_RANK[a.watchlist.priority as Priority] - PRIORITY_RANK[b.watchlist.priority as Priority] || (a.nextCheckAt?.getTime() ?? 0) - (b.nextCheckAt?.getTime() ?? 0));
  const readers = new Map<string, boolean>();
  const hasReader = async (workspaceId: string) => {
    if (!readers.has(workspaceId)) readers.set(workspaceId, (await db.integration.count({ where: { workspaceId, capabilities: { has: 'WEBSITE_FETCH' }, status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] } } })) > 0);
    return readers.get(workspaceId)!;
  };
  const seen = new Set<string>();
  for (const m of due) {
    const key = `${m.workspaceId}:${m.companyId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const canRead = !!m.company.websiteDomain && (await hasReader(m.workspaceId));
    if (canRead && result.monitored >= MONITOR_BATCH) continue; // the rest wait for the next sweep
    // The tightest cadence among the company's watchlists decides the next check.
    const memberships = due.filter((x) => x.workspaceId === m.workspaceId && x.companyId === m.companyId);
    const cadence = Math.min(...memberships.map((x) => WATCHLIST_CADENCE_DAYS[x.watchlist.priority as Priority]));
    await db.$transaction(async (tx) => {
      if (canRead) await requestResearchTx(tx, systemCtx(m.workspaceId), m.companyId, 'MONITOR');
      const data: Prisma.SignalWatchlistMemberUpdateManyMutationInput = { lastCheckedAt: canRead ? now : undefined, nextCheckAt: new Date(now.getTime() + cadence * DAY) };
      await tx.signalWatchlistMember.updateMany({ where: { workspaceId: m.workspaceId, companyId: m.companyId, watchlist: { archivedAt: null } }, data });
    }, TX);
    if (canRead) result.monitored++;
  }

  if (lists.length) await db.signalWatchlist.updateMany({ where: { id: { in: lists.map((l) => l.id) } }, data: { lastSweepAt: now } });
  return result;
}
