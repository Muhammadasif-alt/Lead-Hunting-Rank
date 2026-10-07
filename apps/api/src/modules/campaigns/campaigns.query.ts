import { Injectable } from '@nestjs/common';
import type { EnrollmentStatus, Prisma } from '@revenue-os/database';
import { NotFoundError } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';
import { presentCampaign } from './campaigns.service.js';

const sum = (rows: { status: string; _count: number }[], status?: string) => rows.filter((r) => !status || r.status === status).reduce((n, r) => n + r._count, 0);

/** Read models for screen #6: list with outcome counts (not open rates), detail with funnel and live feed, prospects. */
@Injectable()
export class CampaignsQuery {
  constructor(private readonly prisma: PrismaService) {}

  async list(workspaceId: string) {
    const db = this.prisma.client;
    const campaigns = await db.campaign.findMany({ where: { workspaceId, status: { not: 'ARCHIVED' } }, orderBy: { createdAt: 'desc' }, take: 100 });
    const ids = campaigns.map((c) => c.id);
    const [enrollments, messages] = await Promise.all([
      db.campaignEnrollment.groupBy({ by: ['campaignId', 'status'], where: { campaignId: { in: ids } }, _count: true }),
      db.campaignMessage.groupBy({ by: ['campaignId', 'status'], where: { campaignId: { in: ids } }, _count: true }),
    ]);
    return campaigns.map((c) => {
      const e = enrollments.filter((x) => x.campaignId === c.id);
      const m = messages.filter((x) => x.campaignId === c.id);
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        objective: c.objective,
        launchedAt: c.launchedAt,
        createdAt: c.createdAt,
        prospects: sum(e),
        sent: sum(m, 'SENT'),
        replied: sum(e, 'REPLIED'),
        unsubscribed: sum(e, 'SUPPRESSED'),
        needsApproval: sum(m, 'PENDING_APPROVAL'),
      };
    });
  }

  async detail(workspaceId: string, id: string) {
    const db = this.prisma.client;
    const c = await db.campaign.findFirst({ where: { id, workspaceId }, include: { steps: { orderBy: { position: 'asc' } } } });
    if (!c) throw new NotFoundError('Campaign not found');
    const [enrollments, messages, inbound, mailbox, firstContacted] = await Promise.all([
      db.campaignEnrollment.groupBy({ by: ['status'], where: { campaignId: c.id }, _count: true }),
      db.campaignMessage.groupBy({ by: ['status'], where: { campaignId: c.id }, _count: true }),
      db.mailboxMessage.groupBy({ by: ['kind'], where: { workspaceId, campaignId: c.id }, _count: true }),
      c.mailboxIntegrationId ? db.integration.findFirst({ where: { id: c.mailboxIntegrationId, workspaceId }, select: { id: true, name: true, provider: true, status: true, capabilities: true } }) : null,
      db.campaignEnrollment.count({ where: { campaignId: c.id, lastSentAt: { not: null } } }),
    ]);
    const e = (s: EnrollmentStatus) => enrollments.find((x) => x.status === s)?._count ?? 0;
    const m = (s: string) => messages.find((x) => x.status === s)?._count ?? 0;
    const k = (s: string) => inbound.find((x) => x.kind === s)?._count ?? 0;
    const total = enrollments.reduce((n, x) => n + x._count, 0);
    return {
      campaign: presentCampaign(c),
      steps: c.steps.map((s) => ({ id: s.id, position: s.position, kind: s.kind, delayDays: s.delayDays, angle: s.angle })),
      mailbox,
      // Funnel (screen #6 §38) — outcomes, not opens.
      funnel: { enrolled: total, contacted: firstContacted, replied: e('REPLIED'), unsubscribed: e('SUPPRESSED'), bounced: k('BOUNCE'), completed: e('COMPLETED') },
      prospects: { active: e('ACTIVE') + e('ENROLLED'), replied: e('REPLIED'), completed: e('COMPLETED'), suppressed: e('SUPPRESSED'), blocked: e('BLOCKED'), removed: e('REMOVED') },
      messages: { sent: m('SENT'), pendingApproval: m('PENDING_APPROVAL'), waiting: m('WAITING'), queued: m('QUEUED'), blocked: m('BLOCKED'), cancelled: m('CANCELLED'), failed: m('FAILED'), rejectedDrafts: m('DRAFT_REJECTED') },
      inbound: { replies: k('REPLY'), autoReplies: k('AUTO_REPLY'), unsubscribes: k('UNSUBSCRIBE'), bounces: k('BOUNCE') },
      feed: await this.feed(workspaceId, c.id),
    };
  }

  /** Live feed (screen #6 §37): what happened, newest first — drafted, sent, skipped with reason, replied. */
  private async feed(workspaceId: string, campaignId: string) {
    const db = this.prisma.client;
    const [messages, inbound] = await Promise.all([
      db.campaignMessage.findMany({ where: { campaignId }, orderBy: { updatedAt: 'desc' }, take: 25, include: { enrollment: { select: { email: true, companyId: true } } } }),
      db.mailboxMessage.findMany({ where: { workspaceId, campaignId }, orderBy: { occurredAt: 'desc' }, take: 25 }),
    ]);
    const companyIds = [...new Set(messages.map((x) => x.enrollment.companyId))];
    const companies = await db.company.findMany({ where: { workspaceId, id: { in: companyIds } }, select: { id: true, displayName: true } });
    const name = (id: string) => companies.find((x) => x.id === id)?.displayName ?? null;
    return [
      ...messages.map((x) => ({ type: 'message' as const, id: x.id, at: x.sentAt ?? x.updatedAt, status: x.status, position: x.position, subject: x.subject, reason: x.statusReason, email: x.enrollment.email, company: name(x.enrollment.companyId), companyId: x.enrollment.companyId })),
      ...inbound.map((x) => ({ type: 'inbound' as const, id: x.id, at: x.occurredAt, status: x.kind, position: null, subject: x.subject, reason: x.snippet.slice(0, 200), email: x.fromEmail, company: null, companyId: null })),
    ]
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 30);
  }

  async enrollments(workspaceId: string, campaignId: string, status?: EnrollmentStatus) {
    const db = this.prisma.client;
    const where: Prisma.CampaignEnrollmentWhereInput = { workspaceId, campaignId, ...(status ? { status } : {}) };
    const rows = await db.campaignEnrollment.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }],
      take: 200,
      include: { messages: { orderBy: { position: 'asc' }, select: { id: true, position: true, status: true, statusReason: true, subject: true, body: true, claims: true, sentAt: true, externalActionId: true } } },
    });
    const companies = await db.company.findMany({ where: { workspaceId, id: { in: rows.map((r) => r.companyId) } }, select: { id: true, displayName: true } });
    return rows.map((r) => ({
      id: r.id,
      company: { id: r.companyId, name: companies.find((x) => x.id === r.companyId)?.displayName ?? null },
      email: r.email,
      firstName: r.firstName,
      title: (r.eligibilitySnapshot as { title?: string | null }).title ?? null,
      status: r.status,
      statusReason: r.statusReason,
      nextStepPosition: r.nextStepPosition,
      nextStepDueAt: r.nextStepDueAt,
      lastSentAt: r.lastSentAt,
      repliedAt: r.repliedAt,
      enrolledAt: r.enrolledAt,
      messages: r.messages,
    }));
  }
}
