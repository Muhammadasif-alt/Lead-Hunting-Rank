import { Injectable } from '@nestjs/common';
import {
  aiContribution,
  ask,
  attributionReport,
  campaigns,
  conversations,
  costs,
  definitions,
  drill,
  freshness,
  lineage,
  listRevenue,
  listViews,
  markets,
  overview,
  pipeline,
  sources,
} from '@revenue-os/analytics';
import type { AnalyticsFilters, AttributionModel } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';

/** Analytics reads (screen #10) — read models from @revenue-os/analytics in the shared API shapes. */
@Injectable()
export class AnalyticsQuery {
  constructor(private readonly prisma: PrismaService) {}

  private get db() {
    return this.prisma.client;
  }

  overview(workspaceId: string, f: AnalyticsFilters) {
    return overview(this.db, workspaceId, f);
  }

  attribution(workspaceId: string, f: AnalyticsFilters, model: AttributionModel) {
    return attributionReport(this.db, workspaceId, f, model);
  }

  lineage(workspaceId: string, opportunityId: string) {
    return lineage(this.db, workspaceId, opportunityId);
  }

  markets(workspaceId: string, f: AnalyticsFilters) {
    return markets(this.db, workspaceId, f);
  }

  campaigns(workspaceId: string, f: AnalyticsFilters) {
    return campaigns(this.db, workspaceId, f);
  }

  pipeline(workspaceId: string, f: AnalyticsFilters) {
    return pipeline(this.db, workspaceId, f);
  }

  conversations(workspaceId: string, f: AnalyticsFilters) {
    return conversations(this.db, workspaceId, f);
  }

  sources(workspaceId: string, f: AnalyticsFilters) {
    return sources(this.db, workspaceId, f);
  }

  costs(workspaceId: string, f: AnalyticsFilters) {
    return costs(this.db, workspaceId, f);
  }

  ai(workspaceId: string, f: AnalyticsFilters) {
    return aiContribution(this.db, workspaceId, f);
  }

  drill(workspaceId: string, metric: string, f: AnalyticsFilters, extra: { stage?: string }) {
    return drill(this.db, workspaceId, metric, f, extra);
  }

  ask(workspaceId: string, q: string, f: AnalyticsFilters) {
    return ask(this.db, workspaceId, q, f);
  }

  freshness(workspaceId: string) {
    return freshness(this.db, workspaceId);
  }

  definitions() {
    return definitions();
  }

  views(workspaceId: string, userId: string) {
    return listViews(this.db, workspaceId, userId);
  }

  revenue(workspaceId: string, q: { opportunityId?: string }) {
    return listRevenue(this.db, workspaceId, q);
  }
}
