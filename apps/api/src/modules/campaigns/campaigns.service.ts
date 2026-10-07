import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@revenue-os/config';
import type { Campaign } from '@revenue-os/database';
import {
  applyInbound,
  archiveCampaign,
  checkCampaign,
  completeCampaign,
  createCampaign,
  enrollMore,
  findAudience,
  launchCampaign,
  markReplied,
  markUnsubscribed,
  parseAudience,
  pauseCampaign,
  previewDrafts,
  removeEnrollment,
  resumeCampaign,
  syncMailbox,
  unsubscribeByToken,
  updateCampaign,
  type AudienceFilter,
  type CampaignInput,
} from '@revenue-os/outreach';
import { FakeEmailProvider } from '@revenue-os/providers';
import type { ProviderRuntime } from '@revenue-os/providers/runtime';
import { AuthorityExceededError, BusinessRuleError, ForbiddenError, NotFoundError, ValidationError } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_CONFIG } from '../../infra/tokens.js';
import type { Access, AccessService } from '../auth/access.service.js';
import { PROVIDER_RUNTIME } from '../integrations/provider-runtime.js';

const TX = { timeout: 30_000, maxWait: 10_000 } as const;

export function presentCampaign(c: Campaign) {
  return {
    id: c.id,
    name: c.name,
    objective: c.objective,
    status: c.status,
    statusReason: c.statusReason,
    offer: c.offer,
    audience: parseAudience(c.audience),
    strategy: c.strategy as { cta?: string; tone?: string; avoid?: string[] },
    mailboxIntegrationId: c.mailboxIntegrationId,
    senderName: c.senderName,
    cohortSize: c.cohortSize,
    dailyNewLimit: c.dailyNewLimit,
    checks: c.checks,
    checkedAt: c.checkedAt,
    launchedAt: c.launchedAt,
    pausedAt: c.pausedAt,
    completedAt: c.completedAt,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    version: c.version,
  };
}

/**
 * Campaigns (Phase 11, screen #6). Commands go through @revenue-os/outreach; this service adds who may do what:
 * launching needs campaign.start and audience authority (campaign.max_audience), pausing campaign.pause.
 */
@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
  ) {}

  private deps() {
    return { db: this.prisma.client, providers: this.runtime.gateway, publicUrl: this.config.APP_URL };
  }

  private async load(workspaceId: string, id: string) {
    const c = await this.prisma.client.campaign.findFirst({ where: { id, workspaceId } });
    if (!c) throw new NotFoundError('Campaign not found');
    return c;
  }

  private async assertMailbox(workspaceId: string, id: string | null | undefined) {
    if (!id) return;
    const m = await this.prisma.client.integration.findFirst({ where: { id, workspaceId, capabilities: { has: 'EMAIL_SEND' } } });
    if (!m) throw new ValidationError('That mailbox is not connected in this workspace', [{ path: 'mailboxIntegrationId', message: 'Unknown mailbox' }]);
  }

  /** Audience authority (docs/10 §56-61): a cohort bigger than the person's campaign.max_audience limit needs someone with more. */
  private assertAudienceAuthority(access: Access, accessService: AccessService, size: number) {
    const d = accessService.canLaunchCampaign(access, size);
    if (!d.allowed) throw d.code === 'FORBIDDEN' ? new ForbiddenError(d.reason) : new AuthorityExceededError(d.reason);
  }

  async create(ctx: ServiceContext, input: Partial<CampaignInput> & { name: string }) {
    await this.assertMailbox(ctx.workspaceId, input.mailboxIntegrationId);
    return presentCampaign(await this.prisma.client.$transaction((tx) => createCampaign(tx, ctx, input), TX));
  }

  async update(ctx: ServiceContext, id: string, input: Partial<CampaignInput>) {
    await this.assertMailbox(ctx.workspaceId, input.mailboxIntegrationId);
    return presentCampaign(await this.prisma.client.$transaction((tx) => updateCampaign(tx, ctx, id, input), TX));
  }

  check(ctx: ServiceContext, id: string) {
    return this.prisma.client.$transaction((tx) => checkCampaign(tx, ctx, id), TX);
  }

  async audiencePreview(workspaceId: string, filter: AudienceFilter, campaignId?: string) {
    const r = await findAudience(this.prisma.client, workspaceId, filter, { campaignId });
    return { matched: r.matched, eligible: r.eligible.length, excluded: r.excluded, sample: r.eligible.slice(0, 10) };
  }

  async launch(ctx: ServiceContext, access: Access, accessService: AccessService, id: string) {
    const c = await this.load(ctx.workspaceId, id);
    this.assertAudienceAuthority(access, accessService, c.cohortSize);
    return this.prisma.client.$transaction((tx) => launchCampaign(tx, ctx, id), TX);
  }

  async enrollMore(ctx: ServiceContext, access: Access, accessService: AccessService, id: string, count: number) {
    const c = await this.load(ctx.workspaceId, id);
    const total = (await this.prisma.client.campaignEnrollment.count({ where: { campaignId: c.id } })) + count;
    this.assertAudienceAuthority(access, accessService, total);
    return this.prisma.client.$transaction((tx) => enrollMore(tx, ctx, id, count), TX);
  }

  async transition(ctx: ServiceContext, id: string, command: 'pause' | 'resume' | 'complete' | 'archive', reason?: string | null) {
    await this.prisma.client.$transaction(async (tx) => {
      if (command === 'pause') await pauseCampaign(tx, ctx, id, reason ?? null);
      else if (command === 'resume') await resumeCampaign(tx, ctx, id);
      else if (command === 'complete') await completeCampaign(tx, ctx, id, reason || undefined);
      else await archiveCampaign(tx, ctx, id);
    }, TX);
    return presentCampaign(await this.load(ctx.workspaceId, id));
  }

  preview(ctx: ServiceContext, id: string, count: number) {
    return previewDrafts(this.deps(), ctx, id, count);
  }

  async prospectCommand(ctx: ServiceContext, campaignId: string, enrollmentId: string, command: 'remove' | 'replied' | 'unsubscribed', reason?: string) {
    const e = await this.prisma.client.campaignEnrollment.findFirst({ where: { id: enrollmentId, campaignId, workspaceId: ctx.workspaceId } });
    if (!e) throw new NotFoundError('Prospect not found in this campaign');
    if (command === 'remove') await this.prisma.client.$transaction((tx) => removeEnrollment(tx, ctx, e.id, reason?.trim() || 'Removed by a person'), TX);
    else if (command === 'replied') {
      if (!(await markReplied(this.prisma.client, ctx, e.id))) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `This prospect is ${e.status.toLowerCase()}`);
    } else await markUnsubscribed(this.prisma.client, ctx, e.id);
    return { ok: true };
  }

  /**
   * Test mailbox only (never production, never a real mailbox): an email "arrives" from the prospect, then the mailbox
   * is synced — exactly the path a real reply takes, so the stop rules can be tried safely.
   */
  async simulateInbound(ctx: ServiceContext, campaignId: string, enrollmentId: string, kind: 'REPLY' | 'UNSUBSCRIBE' | 'BOUNCE' | 'AUTO_REPLY') {
    if (this.config.APP_ENV === 'production') throw new ForbiddenError('Not available in production');
    const c = await this.load(ctx.workspaceId, campaignId);
    const e = await this.prisma.client.campaignEnrollment.findFirst({ where: { id: enrollmentId, campaignId, workspaceId: ctx.workspaceId } });
    if (!e) throw new NotFoundError('Prospect not found in this campaign');
    const mailbox = c.mailboxIntegrationId ? await this.prisma.client.integration.findFirst({ where: { id: c.mailboxIntegrationId, workspaceId: ctx.workspaceId } }) : null;
    const adapter = mailbox ? this.runtime.factory.forIntegration(mailbox) : null;
    if (!mailbox || !(adapter instanceof FakeEmailProvider)) throw new ValidationError('Simulated replies only work with the test mailbox');
    if (!e.threadRef && kind !== 'BOUNCE') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Nothing was sent to this prospect yet');
    const to = [mailbox.accountRef.includes('@') ? mailbox.accountRef : 'outreach@test-mailbox.example'];
    const first = await this.prisma.client.campaignMessage.findFirst({ where: { enrollmentId: e.id, status: 'SENT' }, orderBy: { position: 'asc' } });
    const subject = first?.subject ?? 'Hello';
    const message =
      kind === 'BOUNCE'
        ? await adapter.receive({ from: 'mailer-daemon@googlemail.com', to, subject: 'Delivery Status Notification (Failure)', text: `Your message wasn't delivered to ${e.email} because the address couldn't be found.`, threadId: e.threadRef ?? undefined })
        : kind === 'AUTO_REPLY'
          ? await adapter.receive({ from: e.email, to, subject: `Automatic reply: ${subject}`, text: 'I am out of the office until Monday.', threadId: e.threadRef! })
          : kind === 'UNSUBSCRIBE'
            ? await adapter.receive({ from: e.email, to, subject: `Re: ${subject}`, text: 'Please unsubscribe me.\n\nOn Mon, someone wrote:\n> Hi', threadId: e.threadRef! })
            : await adapter.receive({ from: e.email, to, subject: `Re: ${subject}`, text: 'Thanks — could you tell me a bit more about how this works?\n\nOn Mon, someone wrote:\n> Hi', threadId: e.threadRef! });
    // Apply this one message straight away (the periodic sync would find it too — deduplicated).
    const applied = await applyInbound(this.prisma.client, mailbox, message);
    await syncMailbox(this.prisma.client, this.runtime.gateway, mailbox).catch(() => null);
    return { kind: applied?.kind ?? kind };
  }

  unsubscribe(token: string) {
    return unsubscribeByToken(this.prisma.client, token);
  }
}
