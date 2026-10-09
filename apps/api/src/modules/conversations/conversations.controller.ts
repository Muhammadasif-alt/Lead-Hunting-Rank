import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { ConversationsQuery } from './conversations.query.js';
import { ConversationsService } from './conversations.service.js';

const ListQuery = z.strictObject({
  category: z.enum(['HIGH_INTENT', 'NEEDS_HUMAN', 'AI_HANDLING', 'MEETING', 'NURTURE', 'CLOSED']).optional(),
  q: z.string().trim().max(200).optional(),
  mine: z.enum(['true', 'false']).optional(),
});
const ModeInput = z.strictObject({ mode: z.enum(['AUTO', 'ASSIST', 'HUMAN']) });
const ReplyInput = z.strictObject({
  body: z.string().trim().min(1).max(10_000),
  subject: z.string().trim().max(300).nullable().optional(),
  fromReplyId: z.uuid().nullable().optional(),
});
const NoteInput = z.strictObject({ text: z.string().trim().min(1).max(5000) });
const ReasonInput = z.strictObject({ reason: z.string().trim().max(500).nullable().optional() });
const SnoozeInput = z.strictObject({ until: z.iso.datetime() });
const AssignInput = z.strictObject({ userId: z.uuid().nullable() });
const FeedbackInput = z.strictObject({ rating: z.enum(['UP', 'DOWN']), reason: z.string().trim().max(300).nullable().optional() });
const SimulateInput = z.strictObject({ text: z.string().trim().min(1).max(4000) });

/**
 * Conversations / AI Inbox (screen #5). Reading: conversation.read. Replying: conversation.send. Take Over and switching
 * AUTO / ASSIST / HUMAN: conversation.takeover. Approving an AI reply is the approvals endpoint (approval.decide).
 */
@Controller('conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly query: ConversationsQuery,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('conversation.read')
  list(@Query(new ZodValidationPipe(ListQuery)) q: z.output<typeof ListQuery>, @CurrentAccess() access: Access) {
    return this.query.list(access.workspaceId, access.userId, { category: q.category, search: q.q, mine: q.mine === 'true' });
  }

  @Get(':id')
  @RequirePermission('conversation.read')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.query.detail(access.workspaceId, id);
  }

  @Post(':id/read')
  @HttpCode(200)
  @RequirePermission('conversation.read')
  read(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.conversations.read(this.access.serviceContext(access), id);
  }

  /** AUTO / ASSIST / HUMAN. HUMAN is "Take Over": pending AI replies are cancelled at once. */
  @Post(':id/mode')
  @HttpCode(200)
  @RequirePermission('conversation.takeover')
  mode(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ModeInput)) input: z.output<typeof ModeInput>, @CurrentAccess() access: Access) {
    return this.conversations.setMode(this.access.serviceContext(access), id, input.mode);
  }

  @Post(':id/takeover')
  @HttpCode(200)
  @RequirePermission('conversation.takeover')
  takeover(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.conversations.setMode(this.access.serviceContext(access), id, 'HUMAN');
  }

  @Post(':id/reply')
  @HttpCode(200)
  @RequirePermission('conversation.send')
  reply(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ReplyInput)) input: z.output<typeof ReplyInput>, @CurrentAccess() access: Access) {
    return this.conversations.reply(this.access.serviceContext(access), id, input);
  }

  /** A fresh AI draft (a suggestion — nothing is sent). */
  @Post(':id/suggest')
  @HttpCode(200)
  @RequirePermission('conversation.read')
  suggest(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.conversations.suggest(this.access.serviceContext(access), id);
  }

  @Post(':id/replies/:replyId/discard')
  @HttpCode(200)
  @RequirePermission('conversation.send')
  discard(@Param('id', ParseUUIDPipe) id: string, @Param('replyId', ParseUUIDPipe) replyId: string, @CurrentAccess() access: Access) {
    return this.conversations.discard(this.access.serviceContext(access), id, replyId);
  }

  @Post(':id/replies/:replyId/feedback')
  @HttpCode(200)
  @RequirePermission('conversation.read')
  feedback(@Param('id', ParseUUIDPipe) id: string, @Param('replyId', ParseUUIDPipe) replyId: string, @Body(new ZodValidationPipe(FeedbackInput)) input: z.output<typeof FeedbackInput>, @CurrentAccess() access: Access) {
    return this.conversations.feedback(this.access.serviceContext(access), id, replyId, input);
  }

  @Post(':id/notes')
  @HttpCode(200)
  @RequirePermission('conversation.read')
  note(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(NoteInput)) input: z.output<typeof NoteInput>, @CurrentAccess() access: Access) {
    return this.conversations.note(this.access.serviceContext(access), id, input.text);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermission('conversation.takeover')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ReasonInput)) input: z.output<typeof ReasonInput>, @CurrentAccess() access: Access) {
    return this.conversations.resolve(this.access.serviceContext(access), id, input.reason ?? null);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermission('conversation.takeover')
  reopen(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.conversations.reopen(this.access.serviceContext(access), id);
  }

  @Post(':id/snooze')
  @HttpCode(200)
  @RequirePermission('conversation.takeover')
  snooze(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(SnoozeInput)) input: z.output<typeof SnoozeInput>, @CurrentAccess() access: Access) {
    return this.conversations.snooze(this.access.serviceContext(access), id, new Date(input.until));
  }

  @Post(':id/assign')
  @HttpCode(200)
  @RequirePermission('conversation.takeover')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(AssignInput)) input: z.output<typeof AssignInput>, @CurrentAccess() access: Access) {
    return this.conversations.assign(this.access.serviceContext(access), id, input.userId);
  }

  /** Puts their address on the do-not-contact list — only ever makes outreach safer. */
  @Post(':id/do-not-contact')
  @HttpCode(200)
  @RequirePermission('company.update')
  doNotContact(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ReasonInput)) input: z.output<typeof ReasonInput>, @CurrentAccess() access: Access) {
    return this.conversations.doNotContact(this.access.serviceContext(access), id, input.reason ?? null);
  }

  @Post(':id/facts/:extractionId/reject')
  @HttpCode(200)
  @RequirePermission('company.update')
  rejectFact(@Param('id', ParseUUIDPipe) id: string, @Param('extractionId', ParseUUIDPipe) extractionId: string, @CurrentAccess() access: Access) {
    return this.conversations.rejectFact(this.access.serviceContext(access), id, extractionId);
  }

  /** Test mailbox only: the prospect writes a message in this thread (to try the inbox safely). */
  @Post(':id/simulate')
  @HttpCode(200)
  @RequirePermission('campaign.create')
  simulate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(SimulateInput)) input: z.output<typeof SimulateInput>, @CurrentAccess() access: Access) {
    return this.conversations.simulateProspect(this.access.serviceContext(access), id, input.text);
  }
}
