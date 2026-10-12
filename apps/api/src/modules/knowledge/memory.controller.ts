import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { KnowledgeService } from './knowledge.service.js';
import { MemoryQuery } from './memory.query.js';

const Iso = z.iso.datetime({ offset: true });
const Scope = z.enum(['COMPANY', 'PERSON', 'CONVERSATION', 'OPPORTUNITY']);
const SearchQuery = z.strictObject({ q: z.string().trim().max(200).optional(), companyId: z.uuid().optional(), key: z.string().max(40).optional(), status: z.enum(['ACTIVE', 'STALE', 'CONFLICTED', 'SUPERSEDED', 'INVALIDATED', 'ARCHIVED']).optional(), origin: z.enum(['DIRECT_STATEMENT', 'MEETING_NOTE', 'HUMAN_NOTE', 'HUMAN_CORRECTION', 'AI_INFERENCE']).optional(), entityType: Scope.optional() });
const ReviewInput = z.strictObject({ action: z.enum(['ACCEPT', 'REJECT']), value: z.string().trim().max(500).nullable().optional() });
const CorrectInput = z.strictObject({ value: z.string().trim().min(1).max(500), reason: z.string().trim().max(300).nullable().optional() });
const Reason = z.strictObject({ reason: z.string().trim().min(1).max(300) });
const NoteInput = z.strictObject({ companyId: z.uuid(), entityType: Scope.default('COMPANY'), entityId: z.uuid().nullable().optional(), text: z.string().trim().min(1).max(500), key: z.string().max(40).nullable().optional() });
const ConflictInput = z.strictObject({ keep: z.enum(['A', 'B', 'BOTH']), note: z.string().trim().max(300).nullable().optional() });
const CommitmentsQuery = z.strictObject({ status: z.enum(['OPEN', 'WAITING', 'DUE', 'COMPLETED', 'BROKEN', 'CANCELLED', 'ALL']).optional(), direction: z.enum(['WE_PROMISED', 'PROSPECT_PROMISED', 'MUTUAL']).optional(), companyId: z.uuid().optional(), conversationId: z.uuid().optional() });
const CommitmentInput = z.strictObject({
  companyId: z.uuid(),
  conversationId: z.uuid().nullable().optional(),
  opportunityId: z.uuid().nullable().optional(),
  personId: z.uuid().nullable().optional(),
  direction: z.enum(['WE_PROMISED', 'PROSPECT_PROMISED', 'MUTUAL']),
  title: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(1000).nullable().optional(),
  dueAt: Iso.nullable().optional(),
  ownerUserId: z.uuid().nullable().optional(),
});
const CompleteInput = z.strictObject({ evidence: z.string().trim().max(500).default('') });
const StatusInput = z.strictObject({ status: z.enum(['CANCELLED', 'BROKEN', 'WAITING', 'OPEN']), reason: z.string().trim().max(300).nullable().optional(), dueAt: Iso.nullable().optional() });
const RelationshipInput = z.strictObject({ status: z.enum(['ACTIVE', 'ENDED', 'INVALIDATED']) });
const RelQuery = z.strictObject({ companyId: z.uuid().optional() });

/**
 * AI Memory + Relationship Intelligence (screen #12). Reading: memory.read. Confirming, correcting, invalidating,
 * notes, conflicts, commitments and relationships: memory.manage. Memory never holds suppression or credentials.
 */
@Controller('memory')
export class MemoryController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly query: MemoryQuery,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('memory.read')
  overview(@CurrentAccess() access: Access) {
    return this.query.overview(access.workspaceId);
  }

  @Get('search')
  @RequirePermission('memory.read')
  search(@Query(new ZodValidationPipe(SearchQuery)) q: z.output<typeof SearchQuery>, @CurrentAccess() access: Access) {
    return this.query.search(access.workspaceId, q);
  }

  @Get('memories/:id')
  @RequirePermission('memory.read')
  memory(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.query.memory(access.workspaceId, id);
  }

  @Post('memories/:id/correct')
  @HttpCode(200)
  @RequirePermission('memory.manage')
  correct(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(CorrectInput)) input: z.output<typeof CorrectInput>, @CurrentAccess() access: Access) {
    return this.knowledge.correct(this.access.serviceContext(access), id, input);
  }

  @Post('memories/:id/invalidate')
  @HttpCode(200)
  @RequirePermission('memory.manage')
  invalidate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(Reason)) input: z.output<typeof Reason>, @CurrentAccess() access: Access) {
    return this.knowledge.invalidate(this.access.serviceContext(access), id, input.reason);
  }

  @Post('memories/:id/verify')
  @HttpCode(200)
  @RequirePermission('memory.manage')
  verify(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.knowledge.verify(this.access.serviceContext(access), id);
  }

  @Post('notes')
  @RequirePermission('memory.manage')
  note(@Body(new ZodValidationPipe(NoteInput)) input: z.output<typeof NoteInput>, @CurrentAccess() access: Access) {
    return this.knowledge.note(this.access.serviceContext(access), input);
  }

  @Get('candidates')
  @RequirePermission('memory.read')
  candidates(@CurrentAccess() access: Access) {
    return this.query.candidates(access.workspaceId);
  }

  @Post('candidates/:id/review')
  @HttpCode(200)
  @RequirePermission('memory.manage')
  review(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ReviewInput)) input: z.output<typeof ReviewInput>, @CurrentAccess() access: Access) {
    return this.knowledge.reviewCandidate(this.access.serviceContext(access), id, input);
  }

  @Get('conflicts')
  @RequirePermission('memory.read')
  conflicts(@CurrentAccess() access: Access) {
    return this.query.conflicts(access.workspaceId);
  }

  @Post('conflicts/:id/resolve')
  @HttpCode(200)
  @RequirePermission('memory.manage')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ConflictInput)) input: z.output<typeof ConflictInput>, @CurrentAccess() access: Access) {
    return this.knowledge.resolveMemoryConflict(this.access.serviceContext(access), id, input);
  }

  @Get('commitments')
  @RequirePermission('memory.read')
  commitments(@Query(new ZodValidationPipe(CommitmentsQuery)) q: z.output<typeof CommitmentsQuery>, @CurrentAccess() access: Access) {
    return this.query.commitments(access.workspaceId, q);
  }

  @Post('commitments')
  @RequirePermission('memory.manage')
  createCommitment(@Body(new ZodValidationPipe(CommitmentInput)) input: z.output<typeof CommitmentInput>, @CurrentAccess() access: Access) {
    return this.knowledge.createCommitment(this.access.serviceContext(access), { ...input, dueAt: input.dueAt ? new Date(input.dueAt) : null });
  }

  @Post('commitments/:id/complete')
  @HttpCode(200)
  @RequirePermission('memory.manage')
  complete(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(CompleteInput)) input: z.output<typeof CompleteInput>, @CurrentAccess() access: Access) {
    return this.knowledge.completeCommitment(this.access.serviceContext(access), id, input.evidence);
  }

  @Post('commitments/:id/status')
  @HttpCode(200)
  @RequirePermission('memory.manage')
  status(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(StatusInput)) input: z.output<typeof StatusInput>, @CurrentAccess() access: Access) {
    const { dueAt, ...rest } = input;
    return this.knowledge.commitmentStatus(this.access.serviceContext(access), id, { ...rest, ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}) });
  }

  @Get('relationships')
  @RequirePermission('memory.read')
  relationships(@Query(new ZodValidationPipe(RelQuery)) q: z.output<typeof RelQuery>, @CurrentAccess() access: Access) {
    return this.query.relationships(access.workspaceId, q.companyId);
  }

  @Post('relationships/:id/status')
  @HttpCode(200)
  @RequirePermission('memory.manage')
  relationship(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(RelationshipInput)) input: z.output<typeof RelationshipInput>, @CurrentAccess() access: Access) {
    return this.knowledge.relationshipStatus(this.access.serviceContext(access), id, input.status);
  }

  /** Company 360 "What does AI currently know?" */
  @Get('companies/:companyId')
  @RequirePermission('memory.read')
  company(@Param('companyId', ParseUUIDPipe) companyId: string, @CurrentAccess() access: Access) {
    return this.query.company(access.workspaceId, companyId);
  }

  /** "View AI context" for a conversation's latest message (screen #12 §63). */
  @Get('context/conversations/:conversationId')
  @RequirePermission('conversation.read')
  context(@Param('conversationId', ParseUUIDPipe) conversationId: string, @CurrentAccess() access: Access) {
    return this.knowledge.conversationContext(this.access.serviceContext(access), conversationId);
  }
}
