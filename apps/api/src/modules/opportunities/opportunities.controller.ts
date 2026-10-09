import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { LOSS_REASONS, QUALIFICATION_KEYS, STAGE_SEMANTICS, STAKEHOLDER_ROLES } from '@revenue-os/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { OpportunitiesQuery } from './opportunities.query.js';
import { OpportunitiesService } from './opportunities.service.js';

const Money = z.number().int().min(0).max(1_000_000_000_00);
const Currency = z.string().trim().regex(/^[A-Za-z]{3}$/);

const BoardQuery = z.strictObject({ view: z.enum(['pipeline', 'priority', 'mine', 'closed']).default('pipeline'), q: z.string().trim().max(200).optional() });
const CreateInput = z.strictObject({
  companyId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  service: z.string().trim().max(200).nullable().optional(),
  amountMinor: Money.nullable().optional(),
  currency: Currency.optional(),
  primaryPersonId: z.uuid().nullable().optional(),
  ownerUserId: z.uuid().nullable().optional(),
});
const FromConversationInput = z.strictObject({ conversationId: z.uuid(), name: z.string().trim().max(200).nullable().optional(), service: z.string().trim().max(200).nullable().optional(), amountMinor: Money.nullable().optional() });
const PatchInput = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  service: z.string().trim().max(200).nullable().optional(),
  amountMinor: Money.nullable().optional(),
  currency: Currency.optional(),
  ownerUserId: z.uuid().nullable().optional(),
  primaryPersonId: z.uuid().nullable().optional(),
  nextActionOverride: z.string().trim().max(300).nullable().optional(),
  nextActionDueAt: z.iso.datetime().nullable().optional(),
  version: z.number().int().optional(),
});
const StageInput = z.strictObject({ stage: z.enum(STAGE_SEMANTICS), reason: z.string().trim().max(500).nullable().optional(), version: z.number().int().optional() });
const WonInput = z.strictObject({ amountMinor: Money.refine((v) => v > 0, 'Must be more than 0'), currency: Currency.optional(), note: z.string().trim().min(1).max(500) });
const LostInput = z.strictObject({
  reason: z.enum(LOSS_REASONS),
  details: z.string().trim().max(1000).nullable().optional(),
  competitor: z.string().trim().max(200).nullable().optional(),
  revisitAt: z.iso.datetime().nullable().optional(),
  suggested: z.boolean().optional(),
  evidenceQuote: z.string().max(500).nullable().optional(),
});
const ReasonInput = z.strictObject({ reason: z.string().trim().min(1).max(500) });
const AnswerInput = z.strictObject({ value: z.string().trim().max(300).nullable() });
const StakeholderInput = z.strictObject({
  personId: z.uuid().nullable().optional(),
  name: z.string().trim().max(200).nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  role: z.enum(STAKEHOLDER_ROLES).optional(),
  influence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']).optional(),
});
const StakeholderPatch = z.strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().max(200).nullable().optional(),
  role: z.enum(STAKEHOLDER_ROLES).optional(),
  influence: z.enum(['HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']).optional(),
  status: z.enum(['SUGGESTED', 'KNOWN', 'ENGAGED', 'NOT_CONTACTED']).optional(),
});
const Key = new ZodValidationPipe(z.enum(QUALIFICATION_KEYS));

/**
 * Opportunities (screen #7). Reading: opportunity.read. Creating: opportunity.create. Stages, qualification,
 * stakeholders, lost and reopen: opportunity.update. Won (and reopening a won deal): opportunity.mark_won.
 */
@Controller('opportunities')
export class OpportunitiesController {
  constructor(
    private readonly ops: OpportunitiesService,
    private readonly query: OpportunitiesQuery,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('opportunity.read')
  board(@Query(new ZodValidationPipe(BoardQuery)) q: z.output<typeof BoardQuery>, @CurrentAccess() access: Access) {
    return this.query.board(access.workspaceId, access.userId, { view: q.view, search: q.q });
  }

  @Post()
  @HttpCode(200)
  @RequirePermission('opportunity.create')
  create(@Body(new ZodValidationPipe(CreateInput)) input: z.output<typeof CreateInput>, @CurrentAccess() access: Access) {
    return this.ops.create(this.access.serviceContext(access), { ...input, source: 'MANUAL', originReason: 'Created by a person' });
  }

  /** "Create opportunity" from a conversation — the facts the prospect stated come along, with their words. */
  @Post('from-conversation')
  @HttpCode(200)
  @RequirePermission('opportunity.create')
  fromConversation(@Body(new ZodValidationPipe(FromConversationInput)) input: z.output<typeof FromConversationInput>, @CurrentAccess() access: Access) {
    return this.ops.fromConversation(this.access.serviceContext(access), input.conversationId, input);
  }

  @Get(':id')
  @RequirePermission('opportunity.read')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.query.detail(access.workspaceId, id);
  }

  @Patch(':id')
  @RequirePermission('opportunity.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(PatchInput)) input: z.output<typeof PatchInput>, @CurrentAccess() access: Access) {
    const { version, nextActionDueAt, ...rest } = input;
    const due = nextActionDueAt !== undefined ? { nextActionDueAt: nextActionDueAt ? new Date(nextActionDueAt) : null } : {};
    return this.ops.update(this.access.serviceContext(access), id, { ...rest, ...due }, version);
  }

  /** The board's drag & drop calls this; the stage's requirements are checked here, not in the browser. */
  @Post(':id/stage')
  @HttpCode(200)
  @RequirePermission('opportunity.update')
  stage(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(StageInput)) input: z.output<typeof StageInput>, @CurrentAccess() access: Access) {
    return this.ops.stage(this.access.serviceContext(access), id, input.stage, input.reason ?? null, input.version);
  }

  @Post(':id/won')
  @HttpCode(200)
  @RequirePermission('opportunity.mark_won')
  won(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(WonInput)) input: z.output<typeof WonInput>, @CurrentAccess() access: Access) {
    return this.ops.won(this.access.serviceContext(access), id, input);
  }

  @Post(':id/lost')
  @HttpCode(200)
  @RequirePermission('opportunity.update')
  lost(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(LostInput)) input: z.output<typeof LostInput>, @CurrentAccess() access: Access) {
    return this.ops.lost(this.access.serviceContext(access), id, { ...input, revisitAt: input.revisitAt ? new Date(input.revisitAt) : null });
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermission('opportunity.update')
  reopen(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ReasonInput)) input: z.output<typeof ReasonInput>, @CurrentAccess() access: Access) {
    return this.ops.reopen(this.access.serviceContext(access), id, input.reason, access.permissions.has('opportunity.mark_won'));
  }

  @Post(':id/qualification/:key')
  @HttpCode(200)
  @RequirePermission('opportunity.update')
  answer(@Param('id', ParseUUIDPipe) id: string, @Param('key', Key) key: (typeof QUALIFICATION_KEYS)[number], @Body(new ZodValidationPipe(AnswerInput)) input: z.output<typeof AnswerInput>, @CurrentAccess() access: Access) {
    return this.ops.answer(this.access.serviceContext(access), id, key, input.value);
  }

  @Post(':id/qualification/answers/:answerId/confirm')
  @HttpCode(200)
  @RequirePermission('opportunity.update')
  confirm(@Param('id', ParseUUIDPipe) id: string, @Param('answerId', ParseUUIDPipe) answerId: string, @CurrentAccess() access: Access) {
    return this.ops.confirm(this.access.serviceContext(access), id, answerId);
  }

  @Post(':id/stakeholders')
  @HttpCode(200)
  @RequirePermission('opportunity.update')
  addStakeholder(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(StakeholderInput)) input: z.output<typeof StakeholderInput>, @CurrentAccess() access: Access) {
    return this.ops.addStakeholder(this.access.serviceContext(access), id, input);
  }

  @Patch(':id/stakeholders/:stakeholderId')
  @RequirePermission('opportunity.update')
  updateStakeholder(@Param('id', ParseUUIDPipe) id: string, @Param('stakeholderId', ParseUUIDPipe) sid: string, @Body(new ZodValidationPipe(StakeholderPatch)) input: z.output<typeof StakeholderPatch>, @CurrentAccess() access: Access) {
    return this.ops.updateStakeholder(this.access.serviceContext(access), id, sid, input);
  }

  @Post(':id/stakeholders/:stakeholderId/remove')
  @HttpCode(200)
  @RequirePermission('opportunity.update')
  removeStakeholder(@Param('id', ParseUUIDPipe) id: string, @Param('stakeholderId', ParseUUIDPipe) sid: string, @CurrentAccess() access: Access) {
    return this.ops.removeStakeholder(this.access.serviceContext(access), id, sid);
  }
}
