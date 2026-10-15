import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { RELATIONSHIP_INFO, RULE_ACTIONS, SIGNAL_CATEGORIES, SIGNAL_FEEDBACK, SIGNAL_STATUSES, SIGNAL_STRENGTHS, WATCHLIST_KINDS, type Relationship } from '@revenue-os/shared';
import { SIGNAL_ACTIONS } from '@revenue-os/signals';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { SignalsQuery } from './signals.query.js';
import { SignalsService } from './signals.service.js';

const Level = z.enum(['HIGH', 'MEDIUM', 'LOW']);
const Bool = z.enum(['true', 'false']).transform((v) => v === 'true');
const RelationshipKey = z.enum(Object.keys(RELATIONSHIP_INFO) as [Relationship, ...Relationship[]]);
const Priority = z.enum(['HIGH', 'NORMAL', 'LOW']);
const ListQuery = z.strictObject({
  status: z.enum([...SIGNAL_STATUSES, 'OPEN', 'ALL']).optional(),
  strength: z.enum(SIGNAL_STRENGTHS).optional(),
  type: z.string().trim().min(1).max(60).optional(),
  category: z.enum(SIGNAL_CATEGORIES).optional(),
  days: z.coerce.number().int().min(1).max(365).optional(),
  marketId: z.uuid().optional(),
  icp: Level.optional(),
  relationship: RelationshipKey.optional(),
  priority: Bool.optional(),
  campaignCandidate: Bool.optional(),
  companyId: z.uuid().optional(),
  q: z.string().trim().max(200).optional(),
});
const SearchInput = z.strictObject({ q: z.string().trim().min(1).max(300) });
const AnalyticsQuery = z.strictObject({ days: z.coerce.number().int().min(1).max(365).default(90) });
const WatchlistInput = z.strictObject({ name: z.string().trim().min(1).max(120), description: z.string().trim().max(500).nullable().optional(), kind: z.enum(WATCHLIST_KINDS), priority: Priority.default('NORMAL'), marketId: z.uuid().nullable().optional() });
const WatchlistPatch = z.strictObject({ name: z.string().trim().min(1).max(120).optional(), description: z.string().trim().max(500).nullable().optional(), priority: Priority.optional() });
const MembersInput = z.strictObject({ companyIds: z.array(z.uuid()).min(1).max(500), reason: z.string().trim().max(200).nullable().optional() });
const MembersRemove = z.strictObject({ companyIds: z.array(z.uuid()).min(1).max(500) });
const Conditions = z.strictObject({
  types: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  categories: z.array(z.enum(SIGNAL_CATEGORIES)).max(8).optional(),
  minStrength: z.enum(SIGNAL_STRENGTHS).optional(),
  icpLevels: z.array(Level).max(3).optional(),
  industries: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  marketIds: z.array(z.uuid()).max(20).optional(),
  relationships: z.array(RelationshipKey).max(7).optional(),
});
const RuleInput = z.strictObject({ name: z.string().trim().min(1).max(160), enabled: z.boolean().optional(), conditions: Conditions, actions: z.array(z.enum(RULE_ACTIONS)).min(1).max(6) });
const RulePatch = z.strictObject({ name: z.string().trim().min(1).max(160).optional(), enabled: z.boolean().optional(), conditions: Conditions.optional(), actions: z.array(z.enum(RULE_ACTIONS)).min(1).max(6).optional(), position: z.number().int().min(0).max(10_000).optional() });
const ActInput = z.strictObject({ action: z.enum(SIGNAL_ACTIONS), note: z.string().trim().max(300).nullable().optional() });
const DismissInput = z.strictObject({ feedback: z.enum(SIGNAL_FEEDBACK), note: z.string().trim().max(500).nullable().optional() });

/**
 * Signals + Intent (screen #9). Reading: signal.read. Acting on signals, checks and watchlists: signal.manage. Rules:
 * signal.configure. A signal is evidence of change — nothing here sends anything or creates an external action.
 * Static routes come before '/:id'.
 */
@Controller('signals')
export class SignalsController {
  constructor(
    private readonly signals: SignalsService,
    private readonly query: SignalsQuery,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('signal.read')
  overview(@CurrentAccess() access: Access) {
    return this.query.overview(access.workspaceId);
  }

  @Get('list')
  @RequirePermission('signal.read')
  async list(@Query(new ZodValidationPipe(ListQuery)) q: z.output<typeof ListQuery>, @CurrentAccess() access: Access) {
    const items = await this.query.list(access.workspaceId, q);
    return { items, total: items.length };
  }

  @Post('search')
  @HttpCode(200)
  @RequirePermission('signal.read')
  search(@Body(new ZodValidationPipe(SearchInput)) input: z.output<typeof SearchInput>, @CurrentAccess() access: Access) {
    return this.query.search(access.workspaceId, input.q);
  }

  @Get('analytics')
  @RequirePermission('signal.read')
  analytics(@Query(new ZodValidationPipe(AnalyticsQuery)) q: z.output<typeof AnalyticsQuery>, @CurrentAccess() access: Access) {
    return this.query.analytics(access.workspaceId, q.days);
  }

  @Get('companies/:companyId')
  @RequirePermission('signal.read')
  company(@Param('companyId', ParseUUIDPipe) companyId: string, @CurrentAccess() access: Access) {
    return this.query.company(access.workspaceId, companyId);
  }

  @Post('companies/:companyId/check')
  @HttpCode(200)
  @RequirePermission('signal.manage')
  check(@Param('companyId', ParseUUIDPipe) companyId: string, @CurrentAccess() access: Access) {
    return this.signals.check(this.access.serviceContext(access), companyId);
  }

  @Get('watchlists')
  @RequirePermission('signal.read')
  watchlists(@CurrentAccess() access: Access) {
    return this.query.watchlists(access.workspaceId);
  }

  @Post('watchlists')
  @RequirePermission('signal.manage')
  createWatchlist(@Body(new ZodValidationPipe(WatchlistInput)) input: z.output<typeof WatchlistInput>, @CurrentAccess() access: Access) {
    return this.signals.createWatchlist(this.access.serviceContext(access), input);
  }

  @Get('watchlists/:id')
  @RequirePermission('signal.read')
  watchlist(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.query.watchlist(access.workspaceId, id);
  }

  @Patch('watchlists/:id')
  @RequirePermission('signal.manage')
  updateWatchlist(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(WatchlistPatch)) input: z.output<typeof WatchlistPatch>, @CurrentAccess() access: Access) {
    return this.signals.updateWatchlist(this.access.serviceContext(access), id, input);
  }

  @Post('watchlists/:id/archive')
  @HttpCode(200)
  @RequirePermission('signal.manage')
  archiveWatchlist(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.signals.archiveWatchlist(this.access.serviceContext(access), id);
  }

  @Post('watchlists/:id/members')
  @HttpCode(200)
  @RequirePermission('signal.manage')
  addMembers(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(MembersInput)) input: z.output<typeof MembersInput>, @CurrentAccess() access: Access) {
    return this.signals.addMembers(this.access.serviceContext(access), id, input);
  }

  @Post('watchlists/:id/members/remove')
  @HttpCode(200)
  @RequirePermission('signal.manage')
  removeMembers(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(MembersRemove)) input: z.output<typeof MembersRemove>, @CurrentAccess() access: Access) {
    return this.signals.removeMembers(this.access.serviceContext(access), id, input);
  }

  @Get('rules')
  @RequirePermission('signal.read')
  rules(@CurrentAccess() access: Access) {
    return this.query.rules(access.workspaceId);
  }

  @Post('rules')
  @RequirePermission('signal.configure')
  createRule(@Body(new ZodValidationPipe(RuleInput)) input: z.output<typeof RuleInput>, @CurrentAccess() access: Access) {
    return this.signals.createRule(this.access.serviceContext(access), input);
  }

  @Patch('rules/:id')
  @RequirePermission('signal.configure')
  updateRule(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(RulePatch)) input: z.output<typeof RulePatch>, @CurrentAccess() access: Access) {
    return this.signals.updateRule(this.access.serviceContext(access), id, input);
  }

  @Post('rules/:id/delete')
  @HttpCode(200)
  @RequirePermission('signal.configure')
  deleteRule(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.signals.deleteRule(this.access.serviceContext(access), id);
  }

  @Get(':id')
  @RequirePermission('signal.read')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.query.detail(access.workspaceId, id);
  }

  @Post(':id/act')
  @HttpCode(200)
  @RequirePermission('signal.manage')
  act(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ActInput)) input: z.output<typeof ActInput>, @CurrentAccess() access: Access) {
    return this.signals.act(this.access.serviceContext(access), id, input);
  }

  @Post(':id/dismiss')
  @HttpCode(200)
  @RequirePermission('signal.manage')
  dismiss(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(DismissInput)) input: z.output<typeof DismissInput>, @CurrentAccess() access: Access) {
    return this.signals.dismiss(this.access.serviceContext(access), id, input);
  }

  @Post(':id/analyze')
  @HttpCode(200)
  @RequirePermission('signal.manage')
  analyze(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.signals.analyze(this.access.serviceContext(access), id);
  }
}
