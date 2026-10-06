import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AUTONOMY_LEVELS, OUTBOUND_STATES, SUPPRESSION_REASONS, SUPPRESSION_SCOPES, type SuppressionReason } from '@revenue-os/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { PolicyService } from './policy.service.js';

const Settings = z.strictObject({
  firstTouchApproval: z.boolean(),
  sendWindow: z.strictObject({ enabled: z.boolean(), startHour: z.number().int().min(0).max(23), endHour: z.number().int().min(1).max(24), days: z.array(z.number().int().min(0).max(6)).max(7) }),
  dailySendLimit: z.number().int().min(0).max(100_000).nullable(),
  contactCooldownDays: z.number().int().min(0).max(365),
  approvalTtlHours: z.number().int().min(1).max(720),
});
const UpdatePolicyInput = z
  .strictObject({ autonomyLevel: z.enum(AUTONOMY_LEVELS).optional(), settings: Settings.optional() })
  .refine((v) => v.autonomyLevel !== undefined || v.settings !== undefined, 'Nothing to change');
const SimulateInput = z.strictObject({ autonomyLevel: z.enum(AUTONOMY_LEVELS).optional(), settings: Settings.optional() });
const OutboundInput = z.strictObject({ state: z.enum(OUTBOUND_STATES), reason: z.string().trim().max(500).nullable().optional() });
const ApprovalQuery = z.strictObject({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'INVALIDATED', 'CANCELLED', 'ALL']).default('PENDING') });
const DecideInput = z.strictObject({ note: z.string().trim().max(1000).optional() });
const SuppressionQuery = z.strictObject({
  status: z.enum(['ACTIVE', 'LIFTED', 'ALL']).default('ACTIVE'),
  scope: z.enum(SUPPRESSION_SCOPES).optional(),
  value: z.string().max(320).optional(),
  search: z.string().max(320).optional(),
});
const SuppressInput = z.strictObject({
  scope: z.enum(SUPPRESSION_SCOPES),
  value: z.string().trim().min(1).max(320),
  reason: z.enum(Object.keys(SUPPRESSION_REASONS) as [SuppressionReason, ...SuppressionReason[]]),
  note: z.string().trim().max(1000).nullable().optional(),
});
const LiftInput = z.strictObject({ reason: z.string().trim().min(1).max(1000) });

/**
 * Policy Engine (docs/10, screen #17). The client never submits a decision — it only changes settings it is allowed to
 * change; every ACT / ASK / WAIT / BLOCK is computed on the server.
 */
@Controller('policy')
export class PolicyController {
  constructor(
    private readonly policy: PolicyService,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('policy.read')
  overview(@CurrentAccess() access: Access) {
    return this.policy.overview(access.workspaceId);
  }

  /** Kill switch state for the banner on every screen — readable by every member. */
  @Get('outbound')
  outbound(@CurrentAccess() access: Access) {
    return this.policy.outbound(access.workspaceId);
  }

  /** Pause / emergency stop / resume. The permission depends on the transition (resume after a stop is owner-only). */
  @Post('outbound')
  @HttpCode(200)
  setOutbound(@Body(new ZodValidationPipe(OutboundInput)) input: z.output<typeof OutboundInput>, @CurrentAccess() access: Access) {
    return this.policy.setOutbound(this.access.serviceContext(access), access.permissions, input.state, input.reason ?? null);
  }

  @Patch()
  @RequirePermission('policy.manage')
  update(@Body(new ZodValidationPipe(UpdatePolicyInput)) input: z.output<typeof UpdatePolicyInput>, @CurrentAccess() access: Access) {
    return this.policy.update(this.access.serviceContext(access), input);
  }

  /** Read-only: what a draft policy would decide, compared with the current one. */
  @Post('simulate')
  @HttpCode(200)
  @RequirePermission('policy.read')
  simulate(@Body(new ZodValidationPipe(SimulateInput)) input: z.output<typeof SimulateInput>, @CurrentAccess() access: Access) {
    return this.policy.simulate(access.workspaceId, input);
  }

  @Get('approvals')
  @RequirePermission('policy.read')
  approvals(@Query(new ZodValidationPipe(ApprovalQuery)) q: z.output<typeof ApprovalQuery>, @CurrentAccess() access: Access) {
    return this.policy.approvals(access.workspaceId, q.status);
  }

  @Post('approvals/:id/approve')
  @HttpCode(200)
  @RequirePermission('approval.decide')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(DecideInput)) input: z.output<typeof DecideInput>, @CurrentAccess() access: Access) {
    return this.policy.decide(this.access.serviceContext(access), id, 'APPROVE', input.note);
  }

  @Post('approvals/:id/reject')
  @HttpCode(200)
  @RequirePermission('approval.decide')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(DecideInput)) input: z.output<typeof DecideInput>, @CurrentAccess() access: Access) {
    return this.policy.decide(this.access.serviceContext(access), id, 'REJECT', input.note);
  }

  @Get('suppressions')
  @RequirePermission('company.read')
  suppressions(@Query(new ZodValidationPipe(SuppressionQuery)) q: z.output<typeof SuppressionQuery>, @CurrentAccess() access: Access) {
    return this.policy.suppressions(access.workspaceId, q);
  }

  /** Anyone who edits contacts can stop contact — adding a suppression only ever makes outreach safer. */
  @Post('suppressions')
  @RequirePermission('company.update')
  suppress(@Body(new ZodValidationPipe(SuppressInput)) input: z.output<typeof SuppressInput>, @CurrentAccess() access: Access) {
    return this.policy.suppress(this.access.serviceContext(access), input);
  }

  /** Lifting re-allows contact, so it is a policy change. */
  @Post('suppressions/:id/lift')
  @HttpCode(200)
  @RequirePermission('policy.manage')
  lift(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(LiftInput)) input: z.output<typeof LiftInput>, @CurrentAccess() access: Access) {
    return this.policy.lift(this.access.serviceContext(access), id, input.reason);
  }
}
