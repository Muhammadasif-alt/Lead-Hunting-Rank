import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { MANUAL_REVENUE_TYPES } from '@revenue-os/analytics';
import { ATTRIBUTION_MODELS, RANGES, type AnalyticsFilters } from '@revenue-os/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { AnalyticsQuery } from './analytics.query.js';
import { AnalyticsService } from './analytics.service.js';

const IsoDate = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const filterShape = {
  range: z.enum(RANGES).default('30d'),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  marketId: z.uuid().optional(),
  campaignId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  industry: z.string().trim().min(1).max(80).optional(),
};
const FilterQuery = z.strictObject(filterShape);
const AttributionQuery = z.strictObject({ ...filterShape, model: z.enum(ATTRIBUTION_MODELS).default('FULL') });
const DrillQuery = z.strictObject({ ...filterShape, metric: z.string().trim().min(1).max(60), stage: z.string().trim().min(1).max(40).optional() });
const AskInput = z.strictObject({ ...filterShape, q: z.string().trim().min(1).max(500) });
const Tab = z.string().trim().min(1).max(40);
const ViewInput = z.strictObject({ name: z.string().trim().min(1).max(120), tab: Tab, filters: FilterQuery, shared: z.boolean().optional() });
const ViewPatch = z.strictObject({ name: z.string().trim().min(1).max(120).optional(), tab: Tab.optional(), filters: FilterQuery.optional(), shared: z.boolean().optional() });
const RevenueQuery = z.strictObject({ opportunityId: z.uuid().optional() });
const RevenueInput = z.strictObject({
  opportunityId: z.uuid(),
  type: z.enum(MANUAL_REVENUE_TYPES),
  amountMinor: z.number().int().positive().max(1_000_000_000_00),
  currency: z.string().trim().length(3).optional(),
  occurredAt: IsoDate.optional(),
  note: z.string().trim().max(500).nullable().optional(),
});

/** Parsed query → AnalyticsFilters without undefined keys (custom dates only for a custom range). */
function filtersOf(q: z.output<typeof FilterQuery>): AnalyticsFilters {
  const f: AnalyticsFilters = { range: q.range };
  if (q.range === 'custom') {
    if (q.from) f.from = q.from;
    if (q.to) f.to = q.to;
  }
  if (q.marketId) f.marketId = q.marketId;
  if (q.campaignId) f.campaignId = q.campaignId;
  if (q.ownerId) f.ownerId = q.ownerId;
  if (q.industry) f.industry = q.industry;
  return f;
}

/**
 * Analytics + Attribution (screen #10). Reading: analytics.read; cost: analytics.costs (owner/admin); recording
 * payments / expansions / refunds: revenue.record. Every number is drillable; unknown stays unknown. Static routes come
 * before parameterised ones.
 */
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly query: AnalyticsQuery,
    private readonly access: AccessService,
  ) {}

  @Get('overview')
  @RequirePermission('analytics.read')
  overview(@Query(new ZodValidationPipe(FilterQuery)) q: z.output<typeof FilterQuery>, @CurrentAccess() access: Access) {
    return this.query.overview(access.workspaceId, filtersOf(q));
  }

  @Get('attribution')
  @RequirePermission('analytics.read')
  attribution(@Query(new ZodValidationPipe(AttributionQuery)) q: z.output<typeof AttributionQuery>, @CurrentAccess() access: Access) {
    return this.query.attribution(access.workspaceId, filtersOf(q), q.model);
  }

  @Get('markets')
  @RequirePermission('analytics.read')
  markets(@Query(new ZodValidationPipe(FilterQuery)) q: z.output<typeof FilterQuery>, @CurrentAccess() access: Access) {
    return this.query.markets(access.workspaceId, filtersOf(q));
  }

  @Get('campaigns')
  @RequirePermission('analytics.read')
  campaigns(@Query(new ZodValidationPipe(FilterQuery)) q: z.output<typeof FilterQuery>, @CurrentAccess() access: Access) {
    return this.query.campaigns(access.workspaceId, filtersOf(q));
  }

  @Get('pipeline')
  @RequirePermission('analytics.read')
  pipeline(@Query(new ZodValidationPipe(FilterQuery)) q: z.output<typeof FilterQuery>, @CurrentAccess() access: Access) {
    return this.query.pipeline(access.workspaceId, filtersOf(q));
  }

  @Get('conversations')
  @RequirePermission('analytics.read')
  conversations(@Query(new ZodValidationPipe(FilterQuery)) q: z.output<typeof FilterQuery>, @CurrentAccess() access: Access) {
    return this.query.conversations(access.workspaceId, filtersOf(q));
  }

  @Get('sources')
  @RequirePermission('analytics.read')
  sources(@Query(new ZodValidationPipe(FilterQuery)) q: z.output<typeof FilterQuery>, @CurrentAccess() access: Access) {
    return this.query.sources(access.workspaceId, filtersOf(q));
  }

  @Get('costs')
  @RequirePermission('analytics.costs')
  costs(@Query(new ZodValidationPipe(FilterQuery)) q: z.output<typeof FilterQuery>, @CurrentAccess() access: Access) {
    return this.query.costs(access.workspaceId, filtersOf(q));
  }

  @Get('ai')
  @RequirePermission('analytics.read')
  ai(@Query(new ZodValidationPipe(FilterQuery)) q: z.output<typeof FilterQuery>, @CurrentAccess() access: Access) {
    return this.query.ai(access.workspaceId, filtersOf(q));
  }

  @Get('drill')
  @RequirePermission('analytics.read')
  drill(@Query(new ZodValidationPipe(DrillQuery)) q: z.output<typeof DrillQuery>, @CurrentAccess() access: Access) {
    return this.query.drill(access.workspaceId, q.metric, filtersOf(q), { stage: q.stage });
  }

  @Post('ask')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  ask(@Body(new ZodValidationPipe(AskInput)) input: z.output<typeof AskInput>, @CurrentAccess() access: Access) {
    return this.query.ask(access.workspaceId, input.q, filtersOf(input));
  }

  @Get('freshness')
  @RequirePermission('analytics.read')
  freshness(@CurrentAccess() access: Access) {
    return this.query.freshness(access.workspaceId);
  }

  @Get('definitions')
  @RequirePermission('analytics.read')
  definitions() {
    return this.query.definitions();
  }

  @Post('refresh')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  refresh(@CurrentAccess() access: Access) {
    return this.analytics.refresh(this.access.serviceContext(access));
  }

  @Get('views')
  @RequirePermission('analytics.read')
  views(@CurrentAccess() access: Access) {
    return this.query.views(access.workspaceId, access.userId);
  }

  @Post('views')
  @RequirePermission('analytics.read')
  saveView(@Body(new ZodValidationPipe(ViewInput)) input: z.output<typeof ViewInput>, @CurrentAccess() access: Access) {
    return this.analytics.saveView(this.access.serviceContext(access), { ...input, filters: filtersOf(input.filters) });
  }

  @Patch('views/:id')
  @RequirePermission('analytics.read')
  updateView(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ViewPatch)) input: z.output<typeof ViewPatch>, @CurrentAccess() access: Access) {
    return this.analytics.updateView(this.access.serviceContext(access), id, { ...input, filters: input.filters ? filtersOf(input.filters) : undefined });
  }

  @Post('views/:id/delete')
  @HttpCode(200)
  @RequirePermission('analytics.read')
  deleteView(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.analytics.deleteView(this.access.serviceContext(access), id);
  }

  @Get('revenue')
  @RequirePermission('analytics.read')
  revenue(@Query(new ZodValidationPipe(RevenueQuery)) q: z.output<typeof RevenueQuery>, @CurrentAccess() access: Access) {
    return this.query.revenue(access.workspaceId, q);
  }

  @Post('revenue')
  @RequirePermission('revenue.record')
  recordRevenue(@Body(new ZodValidationPipe(RevenueInput)) input: z.output<typeof RevenueInput>, @CurrentAccess() access: Access) {
    return this.analytics.recordRevenue(this.access.serviceContext(access), { ...input, occurredAt: input.occurredAt ? new Date(input.occurredAt) : null });
  }

  @Get('deals/:opportunityId/lineage')
  @RequirePermission('analytics.read')
  lineage(@Param('opportunityId', ParseUUIDPipe) opportunityId: string, @CurrentAccess() access: Access) {
    return this.query.lineage(access.workspaceId, opportunityId);
  }
}
