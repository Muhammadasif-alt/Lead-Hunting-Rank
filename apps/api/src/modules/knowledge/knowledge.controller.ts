import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { KNOWLEDGE_TYPES, ValidationError } from '@revenue-os/shared';
import type { Request } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { KnowledgeQuery } from './knowledge.query.js';
import { KnowledgeService } from './knowledge.service.js';

const Iso = z.iso.datetime({ offset: true });
const Content = z.record(z.string().max(60), z.unknown()).refine((c) => JSON.stringify(c).length <= 60_000, 'Content is too long');
const ListQuery = z.strictObject({ type: z.enum(KNOWLEDGE_TYPES).optional(), status: z.string().max(20).optional(), q: z.string().trim().max(200).optional(), serviceId: z.uuid().optional() });
const CreateInput = z.strictObject({
  type: z.enum(KNOWLEDGE_TYPES),
  title: z.string().trim().max(300).optional(),
  content: Content,
  serviceItemId: z.uuid().nullable().optional(),
  ownerUserId: z.uuid().nullable().optional(),
  reviewIntervalDays: z.number().int().min(7).max(1095).nullable().optional(),
  effectiveFrom: Iso.nullable().optional(),
  changeNote: z.string().trim().max(300).nullable().optional(),
  submit: z.boolean().optional(),
});
const DraftInput = CreateInput.omit({ type: true });
const Reason = z.strictObject({ reason: z.string().trim().min(1).max(500) });
const RestoreInput = z.strictObject({ version: z.number().int().min(1) });
const DisableInput = z.strictObject({ disabled: z.boolean(), reason: z.string().trim().max(300).optional() });
const FeedbackInput = z.strictObject({ kind: z.enum(['HELPFUL', 'OUTDATED', 'INCORRECT', 'INCOMPLETE']), note: z.string().trim().max(500).nullable().optional() });
const ControlsInput = z.strictObject({ pricingAnswers: z.boolean().optional(), technicalClaims: z.boolean().optional() });
const ConflictInput = z.strictObject({ resolution: z.enum(['RESOLVED', 'DISMISSED']), note: z.string().trim().max(500).nullable().optional() });
const GapAnswerInput = z.strictObject({ answer: z.string().trim().min(3).max(4000), question: z.string().trim().min(3).max(300).optional(), category: z.string().max(30).optional(), submit: z.boolean().optional() });
const GapsQuery = z.strictObject({ status: z.enum(['OPEN', 'DRAFTED', 'IN_REVIEW', 'RESOLVED', 'DISMISSED']).optional() });
const SimulateInput = z.strictObject({ question: z.string().trim().min(3).max(1000) });
const SearchQuery = z.strictObject({ q: z.string().trim().max(200) });

const dates = <T extends { effectiveFrom?: string | null }>({ effectiveFrom, ...rest }: T) => ({ ...rest, ...(effectiveFrom !== undefined ? { effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : null } : {}) });

/**
 * Knowledge Base + Business Brain (screen #13). Reading and the simulator: knowledge.read. Drafting, documents and
 * gap answers: knowledge.manage (never AI authority by themselves). Approving, restoring, disabling, kill rules:
 * knowledge.approve — and pricing, policies and claims additionally need knowledge.approve_commercial.
 */
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly query: KnowledgeQuery,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('knowledge.read')
  overview(@CurrentAccess() access: Access) {
    return this.query.overview(access.workspaceId);
  }

  @Get('items')
  @RequirePermission('knowledge.read')
  list(@Query(new ZodValidationPipe(ListQuery)) q: z.output<typeof ListQuery>, @CurrentAccess() access: Access) {
    return this.query.list(access.workspaceId, q);
  }

  @Post('items')
  @RequirePermission('knowledge.manage')
  create(@Body(new ZodValidationPipe(CreateInput)) input: z.output<typeof CreateInput>, @CurrentAccess() access: Access) {
    return this.knowledge.create(this.access.serviceContext(access), dates(input));
  }

  @Get('items/:id')
  @RequirePermission('knowledge.read')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.query.detail(access.workspaceId, id);
  }

  @Put('items/:id/draft')
  @RequirePermission('knowledge.manage')
  saveDraft(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(DraftInput)) input: z.output<typeof DraftInput>, @CurrentAccess() access: Access) {
    return this.knowledge.saveDraft(this.access.serviceContext(access), id, dates(input));
  }

  @Post('items/:id/submit')
  @HttpCode(200)
  @RequirePermission('knowledge.manage')
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.knowledge.submit(this.access.serviceContext(access), id);
  }

  @Post('items/:id/approve')
  @HttpCode(200)
  @RequirePermission('knowledge.approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.knowledge.approve(this.access.serviceContext(access), id, access.permissions.has('knowledge.approve_commercial'));
  }

  @Post('items/:id/reject')
  @HttpCode(200)
  @RequirePermission('knowledge.approve')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(Reason)) input: z.output<typeof Reason>, @CurrentAccess() access: Access) {
    return this.knowledge.reject(this.access.serviceContext(access), id, input.reason);
  }

  /** "Restore v4": a new current version made from v4 — history untouched (screen #13 §58). */
  @Post('items/:id/restore')
  @HttpCode(200)
  @RequirePermission('knowledge.approve')
  restore(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(RestoreInput)) input: z.output<typeof RestoreInput>, @CurrentAccess() access: Access) {
    return this.knowledge.restore(this.access.serviceContext(access), id, input.version, access.permissions.has('knowledge.approve_commercial'));
  }

  @Post('items/:id/reviewed')
  @HttpCode(200)
  @RequirePermission('knowledge.approve')
  reviewed(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.knowledge.reviewed(this.access.serviceContext(access), id, access.permissions.has('knowledge.approve_commercial'));
  }

  /** Emergency disable (screen #13 §91): unavailable to the AI at once; its questions go to a person. */
  @Post('items/:id/disable')
  @HttpCode(200)
  @RequirePermission('knowledge.approve')
  disable(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(DisableInput)) input: z.output<typeof DisableInput>, @CurrentAccess() access: Access) {
    return this.knowledge.disable(this.access.serviceContext(access), id, input.disabled, input.reason);
  }

  @Post('items/:id/archive')
  @HttpCode(200)
  @RequirePermission('knowledge.approve')
  archive(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(Reason)) input: z.output<typeof Reason>, @CurrentAccess() access: Access) {
    return this.knowledge.archive(this.access.serviceContext(access), id, input.reason);
  }

  @Post('items/:id/feedback')
  @HttpCode(200)
  @RequirePermission('knowledge.read')
  feedback(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(FeedbackInput)) input: z.output<typeof FeedbackInput>, @CurrentAccess() access: Access) {
    return this.knowledge.feedback(this.access.serviceContext(access), id, input);
  }

  @Get('review')
  @RequirePermission('knowledge.read')
  review(@CurrentAccess() access: Access) {
    return this.query.review(access.workspaceId);
  }

  @Get('gaps')
  @RequirePermission('knowledge.read')
  gaps(@Query(new ZodValidationPipe(GapsQuery)) q: z.output<typeof GapsQuery>, @CurrentAccess() access: Access) {
    return this.query.gaps(access.workspaceId, q.status);
  }

  /** A person answers a gap → an FAQ draft linked to it; approval resolves the gap (screen #13 §49-50). */
  @Post('gaps/:id/answer')
  @HttpCode(200)
  @RequirePermission('knowledge.manage')
  answerGap(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(GapAnswerInput)) input: z.output<typeof GapAnswerInput>, @CurrentAccess() access: Access) {
    return this.knowledge.answerGap(this.access.serviceContext(access), id, input);
  }

  @Post('gaps/:id/dismiss')
  @HttpCode(200)
  @RequirePermission('knowledge.manage')
  dismissGap(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(Reason)) input: z.output<typeof Reason>, @CurrentAccess() access: Access) {
    return this.knowledge.dismissGap(this.access.serviceContext(access), id, input.reason);
  }

  @Post('conflicts/:id/resolve')
  @HttpCode(200)
  @RequirePermission('knowledge.approve')
  resolveConflict(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ConflictInput)) input: z.output<typeof ConflictInput>, @CurrentAccess() access: Access) {
    return this.knowledge.resolveConflict(this.access.serviceContext(access), id, input);
  }

  @Get('documents')
  @RequirePermission('knowledge.read')
  documents(@CurrentAccess() access: Access) {
    return this.query.documents(access.workspaceId);
  }

  /** Raw file bytes (application/octet-stream) with the name in X-File-Name — a source for review, never truth. */
  @Post('documents')
  @RequirePermission('knowledge.manage')
  upload(@Req() req: Request, @Headers('x-file-name') name: string | undefined, @Headers('x-file-type') type: string | undefined, @CurrentAccess() access: Access) {
    if (!Buffer.isBuffer(req.body)) throw new ValidationError('Send the file as application/octet-stream');
    let fileName = 'document';
    try {
      fileName = decodeURIComponent(name ?? 'document');
    } catch {
      fileName = name ?? 'document';
    }
    return this.knowledge.upload(this.access.serviceContext(access), { fileName, contentType: type ?? 'application/octet-stream', data: req.body });
  }

  /** "Ask as prospect" (screen #13 §51): what the AI would answer, with which knowledge — nothing is sent. */
  @Post('simulate')
  @HttpCode(200)
  @RequirePermission('knowledge.read')
  simulate(@Body(new ZodValidationPipe(SimulateInput)) input: z.output<typeof SimulateInput>, @CurrentAccess() access: Access) {
    return this.knowledge.simulate(this.access.serviceContext(access), input.question);
  }

  @Get('search')
  @RequirePermission('knowledge.read')
  search(@Query(new ZodValidationPipe(SearchQuery)) q: z.output<typeof SearchQuery>, @CurrentAccess() access: Access) {
    return this.query.search(access.workspaceId, q.q);
  }

  /** Granular kill rules (screen #13 §92). */
  @Put('controls')
  @RequirePermission('knowledge.approve')
  controls(@Body(new ZodValidationPipe(ControlsInput)) input: z.output<typeof ControlsInput>, @CurrentAccess() access: Access) {
    return this.knowledge.controls(this.access.serviceContext(access), input);
  }
}
