import { Injectable } from '@nestjs/common';
import { deleteView, freshness, recordRevenue, rollupDailyMetrics, saveView, updateView, type RecordRevenueInput } from '@revenue-os/analytics';
import type { AnalyticsFilters } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';

/**
 * Analytics commands (Phase 17): recording payments / expansions / refunds on won deals, saved views, and a bounded
 * on-demand rebuild of the daily projection. Nothing here sends anything or creates an external action.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  recordRevenue(ctx: ServiceContext, input: RecordRevenueInput) {
    return recordRevenue(this.db, ctx, input);
  }

  saveView(ctx: ServiceContext, input: { name: string; tab: string; filters: AnalyticsFilters; shared?: boolean }) {
    return saveView(this.db, ctx, input);
  }

  updateView(ctx: ServiceContext, id: string, input: { name?: string; tab?: string; filters?: AnalyticsFilters; shared?: boolean }) {
    return updateView(this.db, ctx, id, input);
  }

  deleteView(ctx: ServiceContext, id: string) {
    return deleteView(this.db, ctx, id);
  }

  /** "Refresh now": rebuild this workspace's last 35 days (idempotent) and return the new freshness. */
  async refresh(ctx: ServiceContext) {
    const result = await rollupDailyMetrics({ db: this.db }, { workspaceId: ctx.workspaceId, days: 35 });
    return { ...result, freshness: await freshness(this.db, ctx.workspaceId) };
  }
}
