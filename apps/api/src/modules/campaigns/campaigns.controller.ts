import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AppConfig } from '@revenue-os/config';
import { FOLLOW_UP_ANGLES } from '@revenue-os/outreach';
import { z } from 'zod';
import { RawResponse } from '../../common/envelope.interceptor.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { APP_CONFIG } from '../../infra/tokens.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CsrfExempt, CurrentAccess, Public, RequirePermission } from '../auth/auth.decorators.js';
import { CampaignsQuery } from './campaigns.query.js';
import { CampaignsService } from './campaigns.service.js';

const Audience = z.strictObject({
  marketId: z.uuid().nullable().optional(),
  industries: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
  opportunityKeys: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
  priorities: z.array(z.enum(['HIGH', 'MEDIUM', 'LOW'])).max(3).optional(),
});
const Strategy = z.strictObject({
  cta: z.string().trim().max(200).optional(),
  tone: z.string().trim().max(200).optional(),
  avoid: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
});
const CampaignFields = {
  name: z.string().trim().min(1).max(120),
  objective: z.enum(['START_CONVERSATIONS', 'BOOK_MEETINGS', 'QUOTE_REQUESTS', 'REENGAGE', 'VALIDATE_MARKET']),
  offer: z.string().trim().max(300),
  audience: Audience,
  strategy: Strategy,
  mailboxIntegrationId: z.uuid().nullable(),
  senderName: z.string().trim().max(100),
  cohortSize: z.number().int().min(1).max(500),
  dailyNewLimit: z.number().int().min(1).max(200),
  followUps: z.array(z.strictObject({ delayDays: z.number().int().min(1).max(30), angle: z.enum(FOLLOW_UP_ANGLES) })).max(3),
};
const CreateInput = z.strictObject({ ...CampaignFields }).partial().required({ name: true });
const UpdateInput = z.strictObject({ ...CampaignFields }).partial();
const ReasonInput = z.strictObject({ reason: z.string().trim().max(500).nullable().optional() });
const CountInput = z.strictObject({ count: z.number().int().min(1).max(500) });
const PreviewInput = z.strictObject({ count: z.number().int().min(1).max(5).default(3) });
const EnrollmentQuery = z.strictObject({ status: z.enum(['ELIGIBLE', 'ENROLLED', 'ACTIVE', 'REPLIED', 'PAUSED', 'COMPLETED', 'REMOVED', 'SUPPRESSED', 'BLOCKED']).optional() });
const SimulateInput = z.strictObject({ kind: z.enum(['REPLY', 'UNSUBSCRIBE', 'BOUNCE', 'AUTO_REPLY']) });

/**
 * Campaigns (screen #6). Reading: campaign.read. Drafting and editing: campaign.create. Launching or adding prospects:
 * campaign.start + audience authority. Pausing: campaign.pause. Stopping a prospect is always allowed for company.update
 * — it only ever makes outreach safer.
 */
@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignsService,
    private readonly query: CampaignsQuery,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('campaign.read')
  list(@CurrentAccess() access: Access) {
    return this.query.list(access.workspaceId);
  }

  @Post()
  @RequirePermission('campaign.create')
  create(@Body(new ZodValidationPipe(CreateInput)) input: z.output<typeof CreateInput>, @CurrentAccess() access: Access) {
    return this.campaigns.create(this.access.serviceContext(access), input);
  }

  /** Who a filter would reach, before saving it. */
  @Post('audience-preview')
  @HttpCode(200)
  @RequirePermission('campaign.read')
  audiencePreview(@Body(new ZodValidationPipe(Audience)) filter: z.output<typeof Audience>, @CurrentAccess() access: Access) {
    return this.campaigns.audiencePreview(access.workspaceId, filter);
  }

  @Get(':id')
  @RequirePermission('campaign.read')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.query.detail(access.workspaceId, id);
  }

  @Patch(':id')
  @RequirePermission('campaign.create')
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(UpdateInput)) input: z.output<typeof UpdateInput>, @CurrentAccess() access: Access) {
    return this.campaigns.update(this.access.serviceContext(access), id, input);
  }

  @Post(':id/check')
  @HttpCode(200)
  @RequirePermission('campaign.create')
  check(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.campaigns.check(this.access.serviceContext(access), id);
  }

  /** Dry run: real drafts for a few prospects, with validator and policy results. Nothing is sent. */
  @Post(':id/preview')
  @HttpCode(200)
  @RequirePermission('campaign.create')
  preview(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(PreviewInput)) input: z.output<typeof PreviewInput>, @CurrentAccess() access: Access) {
    return this.campaigns.preview(this.access.serviceContext(access), id, input.count);
  }

  @Post(':id/launch')
  @HttpCode(200)
  @RequirePermission('campaign.start')
  launch(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.campaigns.launch(this.access.serviceContext(access), access, this.access, id);
  }

  @Post(':id/enroll')
  @HttpCode(200)
  @RequirePermission('campaign.start')
  enroll(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(CountInput)) input: z.output<typeof CountInput>, @CurrentAccess() access: Access) {
    return this.campaigns.enrollMore(this.access.serviceContext(access), access, this.access, id, input.count);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @RequirePermission('campaign.pause')
  pause(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ReasonInput)) input: z.output<typeof ReasonInput>, @CurrentAccess() access: Access) {
    return this.campaigns.transition(this.access.serviceContext(access), id, 'pause', input.reason);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @RequirePermission('campaign.start')
  resume(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.campaigns.transition(this.access.serviceContext(access), id, 'resume');
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermission('campaign.pause')
  complete(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ReasonInput)) input: z.output<typeof ReasonInput>, @CurrentAccess() access: Access) {
    return this.campaigns.transition(this.access.serviceContext(access), id, 'complete', input.reason);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @RequirePermission('campaign.create')
  archive(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.campaigns.transition(this.access.serviceContext(access), id, 'archive');
  }

  @Get(':id/enrollments')
  @RequirePermission('campaign.read')
  enrollments(@Param('id', ParseUUIDPipe) id: string, @Query(new ZodValidationPipe(EnrollmentQuery)) q: z.output<typeof EnrollmentQuery>, @CurrentAccess() access: Access) {
    return this.query.enrollments(access.workspaceId, id, q.status);
  }

  @Post(':id/enrollments/:enrollmentId/remove')
  @HttpCode(200)
  @RequirePermission('campaign.pause')
  remove(@Param('id', ParseUUIDPipe) id: string, @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string, @Body(new ZodValidationPipe(ReasonInput)) input: z.output<typeof ReasonInput>, @CurrentAccess() access: Access) {
    return this.campaigns.prospectCommand(this.access.serviceContext(access), id, enrollmentId, 'remove', input.reason ?? undefined);
  }

  @Post(':id/enrollments/:enrollmentId/replied')
  @HttpCode(200)
  @RequirePermission('company.update')
  replied(@Param('id', ParseUUIDPipe) id: string, @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string, @CurrentAccess() access: Access) {
    return this.campaigns.prospectCommand(this.access.serviceContext(access), id, enrollmentId, 'replied');
  }

  @Post(':id/enrollments/:enrollmentId/unsubscribed')
  @HttpCode(200)
  @RequirePermission('company.update')
  unsubscribed(@Param('id', ParseUUIDPipe) id: string, @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string, @CurrentAccess() access: Access) {
    return this.campaigns.prospectCommand(this.access.serviceContext(access), id, enrollmentId, 'unsubscribed');
  }

  /** Test mailbox only: make an email "arrive" (reply, unsubscribe, bounce, auto-reply) to try the stop rules. */
  @Post(':id/enrollments/:enrollmentId/simulate')
  @HttpCode(200)
  @RequirePermission('campaign.create')
  simulate(@Param('id', ParseUUIDPipe) id: string, @Param('enrollmentId', ParseUUIDPipe) enrollmentId: string, @Body(new ZodValidationPipe(SimulateInput)) input: z.output<typeof SimulateInput>, @CurrentAccess() access: Access) {
    return this.campaigns.simulateInbound(this.access.serviceContext(access), id, enrollmentId, input.kind);
  }
}

const Token = new ZodValidationPipe(z.string().regex(/^[A-Za-z0-9_-]{20,64}$/));

/**
 * One-click unsubscribe (RFC 8058). Mail clients POST here from the List-Unsubscribe header; a browser that opens the
 * link is sent to a confirmation page. Always answers the same way, so a token reveals nothing.
 */
@Controller('public/unsubscribe')
export class UnsubscribeController {
  constructor(
    private readonly campaigns: CampaignsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post(':token')
  @Public()
  @CsrfExempt()
  @HttpCode(200)
  async unsubscribe(@Param('token', Token) token: string) {
    await this.campaigns.unsubscribe(token);
    return { unsubscribed: true };
  }

  @Get(':token')
  @Public()
  @RawResponse()
  open(@Param('token', Token) token: string, @Res() res: Response) {
    res.redirect(302, `${this.config.APP_URL.replace(/\/$/, '')}/unsubscribe/${token}`);
  }
}
