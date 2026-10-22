import type { Prisma, PrismaClient } from '@revenue-os/database';

type AnalyticsView = Prisma.AnalyticsViewGetPayload<object>;
import { actorUserId, isUniqueViolation, writeAudit, type ServiceContext } from '@revenue-os/domain';
import { recordEvent } from '@revenue-os/events';
import { ConflictError, ForbiddenError, METRICS, NotFoundError, ValidationError, type AnalyticsFilters, type AnalyticsViewRow, type MetricDefinition } from '@revenue-os/shared';
import { TX } from './deps.js';

const toRow = (v: AnalyticsView, userId: string | null): AnalyticsViewRow => ({ id: v.id, name: v.name, tab: v.tab, filters: v.filters as unknown as AnalyticsFilters, shared: v.shared, mine: v.userId === userId, createdAt: v.createdAt.toISOString() });

/** Metric definitions with version and how each is counted (screen #10 §52). */
export const definitions = (): MetricDefinition[] => Object.values(METRICS);

/** My views plus the views others shared (screen #10 §53). */
export async function listViews(db: PrismaClient, workspaceId: string, userId: string): Promise<AnalyticsViewRow[]> {
  const rows = await db.analyticsView.findMany({ where: { workspaceId, OR: [{ userId }, { shared: true }] }, orderBy: [{ name: 'asc' }] });
  return rows.map((v) => toRow(v, userId));
}

function requireUser(ctx: ServiceContext): string {
  const id = actorUserId(ctx);
  if (!id) throw new ForbiddenError('Saved views belong to a person');
  return id;
}

async function ownView(db: PrismaClient, ctx: ServiceContext, id: string, userId: string) {
  const v = await db.analyticsView.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!v || (v.userId !== userId && !v.shared)) throw new NotFoundError('View not found');
  if (v.userId !== userId) throw new ForbiddenError('Only the person who saved this view can change it');
  return v;
}

export async function saveView(db: PrismaClient, ctx: ServiceContext, input: { name: string; tab: string; filters: AnalyticsFilters; shared?: boolean }): Promise<AnalyticsViewRow> {
  const userId = requireUser(ctx);
  const name = input.name.trim();
  if (!name) throw new ValidationError('Name the view', [{ path: 'name', message: 'Required' }]);
  try {
    return await db.$transaction(async (tx) => {
      const v = await tx.analyticsView.create({ data: { workspaceId: ctx.workspaceId, userId, name: name.slice(0, 120), tab: input.tab, filters: input.filters as unknown as Prisma.InputJsonValue, shared: input.shared ?? false } });
      await writeAudit(tx, ctx, { action: 'analytics_view.created', entityType: 'ANALYTICS_VIEW', entityId: v.id, after: { name: v.name, tab: v.tab, shared: v.shared } });
      await recordEvent(tx, ctx, 'AnalyticsViewSaved', v.id, { viewId: v.id, change: 'CREATED' });
      return toRow(v, userId);
    }, TX);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('ALREADY_EXISTS', `You already have a view called "${name}"`);
    throw err;
  }
}

export async function updateView(db: PrismaClient, ctx: ServiceContext, id: string, input: { name?: string; tab?: string; filters?: AnalyticsFilters; shared?: boolean }): Promise<AnalyticsViewRow> {
  const userId = requireUser(ctx);
  const v = await ownView(db, ctx, id, userId);
  const name = input.name?.trim();
  if (input.name !== undefined && !name) throw new ValidationError('Name the view', [{ path: 'name', message: 'Required' }]);
  try {
    return await db.$transaction(async (tx) => {
      const u = await tx.analyticsView.update({ where: { id: v.id }, data: { ...(name ? { name: name.slice(0, 120) } : {}), ...(input.tab ? { tab: input.tab } : {}), ...(input.filters ? { filters: input.filters as unknown as Prisma.InputJsonValue } : {}), ...(input.shared !== undefined ? { shared: input.shared } : {}) } });
      await writeAudit(tx, ctx, { action: 'analytics_view.updated', entityType: 'ANALYTICS_VIEW', entityId: v.id, before: { name: v.name, tab: v.tab, shared: v.shared }, after: { name: u.name, tab: u.tab, shared: u.shared } });
      await recordEvent(tx, ctx, 'AnalyticsViewSaved', v.id, { viewId: v.id, change: 'UPDATED' });
      return toRow(u, userId);
    }, TX);
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError('ALREADY_EXISTS', `You already have a view called "${name}"`);
    throw err;
  }
}

export async function deleteView(db: PrismaClient, ctx: ServiceContext, id: string): Promise<{ ok: true }> {
  const userId = requireUser(ctx);
  const v = await ownView(db, ctx, id, userId);
  await db.$transaction(async (tx) => {
    await tx.analyticsView.delete({ where: { id: v.id } });
    await writeAudit(tx, ctx, { action: 'analytics_view.deleted', entityType: 'ANALYTICS_VIEW', entityId: v.id, before: { name: v.name, tab: v.tab, shared: v.shared } });
    await recordEvent(tx, ctx, 'AnalyticsViewSaved', v.id, { viewId: v.id, change: 'DELETED' });
  }, TX);
  return { ok: true };
}
