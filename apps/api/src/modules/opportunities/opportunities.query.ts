import { Injectable } from '@nestjs/common';
import type { Opportunity, PipelineStage, Prisma } from '@revenue-os/database';
import { allowedStages, dealHealth, nextBestAction, stageRequirements, suggestLossReason, type HealthInput } from '@revenue-os/outreach';
import { NotFoundError, OPEN_PATH, QUALIFICATION_KEYS, type StageSemantic } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';

type Row = Opportunity & { stage: PipelineStage };
const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/**
 * Read models for screen #7: the board (stages with cards that say why the deal exists, what is known, its health and
 * next action), the priority view, closed deals, and Opportunity 360. Values are facts — no invented probabilities.
 */
@Injectable()
export class OpportunitiesQuery {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything the health and next-action rules need, for many deals at once. */
  private async inputs(rows: Row[]) {
    const db = this.prisma.client;
    const ids = rows.map((r) => r.id);
    const [answers, history, stakeholders, conversations, people] = await Promise.all([
      db.qualificationAnswer.findMany({ where: { qualification: { opportunityId: { in: ids } }, supersededAt: null }, select: { key: true, qualification: { select: { opportunityId: true } } } }),
      db.opportunityStageHistory.findMany({ where: { opportunityId: { in: ids } }, select: { opportunityId: true, toSemantic: true } }),
      db.opportunityStakeholder.findMany({ where: { opportunityId: { in: ids } }, select: { opportunityId: true, role: true, status: true } }),
      db.conversation.findMany({ where: { id: { in: rows.map((r) => r.conversationId).filter((x): x is string => !!x) } }, select: { id: true, waitingOn: true, lastInboundAt: true, lastOutboundAt: true, contactName: true } }),
      db.person.findMany({ where: { id: { in: rows.map((r) => r.primaryPersonId).filter((x): x is string => !!x) } }, select: { id: true, fullName: true, firstName: true } }),
    ]);
    const losses = await db.opportunityLoss.findMany({ where: { opportunityId: { in: ids }, reopenedAt: null }, select: { opportunityId: true, revisitAt: true } });
    return new Map(
      rows.map((o) => {
        const conv = conversations.find((c) => c.id === o.conversationId) ?? null;
        const person = people.find((p) => p.id === o.primaryPersonId);
        const input: HealthInput = {
          semantic: o.stage.semantic as StageSemantic,
          status: o.status,
          known: new Set(answers.filter((a) => a.qualification.opportunityId === o.id).map((a) => a.key)),
          hasPrimaryContact: !!o.primaryPersonId,
          service: o.service,
          amountMinor: o.amountMinor,
          reached: new Set(history.filter((h) => h.opportunityId === o.id).map((h) => h.toSemantic)),
          stakeholders: stakeholders.filter((s) => s.opportunityId === o.id),
          conversation: conv ? { waitingOn: conv.waitingOn, lastInboundAt: conv.lastInboundAt, lastOutboundAt: conv.lastOutboundAt } : null,
          stageEnteredAt: o.stageEnteredAt,
          lastActivityAt: o.lastActivityAt,
          contactName: person?.firstName ?? person?.fullName ?? conv?.contactName ?? null,
          revisitAt: losses.find((l) => l.opportunityId === o.id)?.revisitAt ?? null,
          nextActionOverride: o.nextActionOverride,
        };
        return [o.id, { input, person: person ? { id: person.id, name: person.fullName } : null }];
      }),
    );
  }

  private card(o: Row, ctx: { input: HealthInput; person: { id: string; name: string } | null }, companies: Map<string, { id: string; name: string }>, owners: Map<string, string>, now: Date) {
    const health = dealHealth(ctx.input, now);
    return {
      id: o.id,
      name: o.name,
      service: o.service,
      company: companies.get(o.companyId) ?? null,
      contact: ctx.person,
      stage: o.stage.semantic,
      status: o.status,
      amountMinor: o.amountMinor,
      wonAmountMinor: o.wonAmountMinor,
      currency: o.currency,
      owner: o.ownerUserId ? { id: o.ownerUserId, name: owners.get(o.ownerUserId) ?? null } : null,
      health: health.health,
      topRisk: [...health.risks].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'HIGH' ? -1 : b.severity === 'HIGH' ? 1 : a.severity === 'MEDIUM' ? -1 : 1))[0] ?? null,
      nextAction: nextBestAction(ctx.input, now),
      known: QUALIFICATION_KEYS.filter((k) => ctx.input.known.has(k)),
      waitingOnUs: ctx.input.conversation?.waitingOn === 'US',
      daysInStage: Math.floor((now.getTime() - o.stageEnteredAt.getTime()) / 86_400_000),
      lastActivityAt: o.lastActivityAt,
      closedAt: o.closedAt,
      version: o.version,
    };
  }

  async board(workspaceId: string, userId: string, q: { view: 'pipeline' | 'priority' | 'mine' | 'closed'; search?: string }) {
    const db = this.prisma.client;
    const now = new Date();
    const search = q.search?.trim();
    const where: Prisma.OpportunityWhereInput = {
      workspaceId,
      status: q.view === 'closed' ? { in: ['WON', 'LOST'] } : 'OPEN',
      ...(q.view === 'mine' ? { ownerUserId: userId } : {}),
      ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { service: { contains: search, mode: 'insensitive' } }] } : {}),
    };
    const rows = (await db.opportunity.findMany({ where, include: { stage: true }, orderBy: [{ updatedAt: 'desc' }], take: 300 })) as Row[];
    const [companyRows, ownerRows, pipeline, open, wonMonth, lostMonth] = await Promise.all([
      db.company.findMany({ where: { workspaceId, id: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { id: true, displayName: true } }),
      db.user.findMany({ where: { id: { in: rows.map((r) => r.ownerUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      db.pipeline.findFirst({ where: { workspaceId, isDefault: true }, include: { stages: { orderBy: { position: 'asc' } } } }),
      db.opportunity.findMany({ where: { workspaceId, status: 'OPEN' }, select: { amountMinor: true, currency: true, stage: { select: { semantic: true } } } }),
      db.opportunity.findMany({ where: { workspaceId, status: 'WON', closedAt: { gte: startOfMonth(now) } }, select: { wonAmountMinor: true, currency: true } }),
      db.opportunity.count({ where: { workspaceId, status: 'LOST', closedAt: { gte: startOfMonth(now) } } }),
    ]);
    // Search also matches the company name.
    const companies = new Map(companyRows.map((c) => [c.id, { id: c.id, name: c.displayName }]));
    const owners = new Map(ownerRows.map((u) => [u.id, u.name]));
    const inputs = await this.inputs(rows);
    let cards = rows.map((o) => this.card(o, inputs.get(o.id)!, companies, owners, now));
    if (search) {
      const extra = (await db.company.findMany({ where: { workspaceId, displayName: { contains: search, mode: 'insensitive' } }, select: { id: true } })).map((c) => c.id);
      if (extra.length && q.view !== 'closed') {
        const more = (await db.opportunity.findMany({ where: { workspaceId, status: 'OPEN', companyId: { in: extra }, id: { notIn: rows.map((r) => r.id) } }, include: { stage: true } })) as Row[];
        if (more.length) {
          const cs = await db.company.findMany({ where: { id: { in: more.map((m) => m.companyId) } }, select: { id: true, displayName: true } });
          for (const c of cs) companies.set(c.id, { id: c.id, name: c.displayName });
          const mi = await this.inputs(more);
          cards = [...cards, ...more.map((o) => this.card(o, mi.get(o.id)!, companies, owners, now))];
        }
      }
    }

    const sum = (xs: { amount: number | null; currency: string }[]) => {
      const by: Record<string, number> = {};
      for (const x of xs) if (x.amount) by[x.currency] = (by[x.currency] ?? 0) + x.amount;
      return by;
    };
    const summary = {
      openCount: open.length,
      openValue: sum(open.map((o) => ({ amount: o.amountMinor, currency: o.currency }))),
      unpricedCount: open.filter((o) => !o.amountMinor).length,
      proposalValue: sum(open.filter((o) => o.stage.semantic === 'PROPOSAL' || o.stage.semantic === 'NEGOTIATION').map((o) => ({ amount: o.amountMinor, currency: o.currency }))),
      wonThisMonth: sum(wonMonth.map((o) => ({ amount: o.wonAmountMinor, currency: o.currency }))),
      wonThisMonthCount: wonMonth.length,
      lostThisMonthCount: lostMonth,
    };
    const stages = (pipeline?.stages ?? []).filter((s) => s.semantic !== 'WON' && s.semantic !== 'LOST').map((s) => ({ id: s.id, name: s.name, semantic: s.semantic }));
    if (q.view === 'priority') {
      const order = { STALLED: 1, AT_RISK: 1, HEALTHY: 2, CLOSED: 3 } as const;
      cards.sort((a, b) => Number(b.waitingOnUs) - Number(a.waitingOnUs) || order[a.health] - order[b.health] || b.daysInStage - a.daysInStage);
    }
    return { summary, stages, cards };
  }

  async detail(workspaceId: string, id: string) {
    const db = this.prisma.client;
    const o = (await db.opportunity.findFirst({ where: { id, workspaceId }, include: { stage: true } })) as Row | null;
    if (!o) throw new NotFoundError('Opportunity not found');
    const now = new Date();
    const [company, owner, qualification, stakeholders, history, losses, conversation, campaign, events, members, pipeline, people] = await Promise.all([
      db.company.findFirstOrThrow({ where: { id: o.companyId, workspaceId }, select: { id: true, displayName: true, industry: true, city: true, region: true, websiteDomain: true, status: true } }),
      o.ownerUserId ? db.user.findUnique({ where: { id: o.ownerUserId }, select: { id: true, name: true } }) : null,
      db.qualification.findUnique({ where: { opportunityId: o.id }, include: { answers: { orderBy: { createdAt: 'desc' } } } }),
      db.opportunityStakeholder.findMany({ where: { opportunityId: o.id }, orderBy: { createdAt: 'asc' } }),
      db.opportunityStageHistory.findMany({ where: { opportunityId: o.id }, orderBy: { changedAt: 'asc' } }),
      db.opportunityLoss.findMany({ where: { opportunityId: o.id }, orderBy: { lostAt: 'desc' } }),
      o.conversationId ? db.conversation.findFirst({ where: { id: o.conversationId, workspaceId }, select: { id: true, subject: true, email: true, contactName: true, category: true, waitingOn: true, mode: true, lastInboundAt: true, summary: true } }) : null,
      o.campaignId ? db.campaign.findFirst({ where: { id: o.campaignId, workspaceId }, select: { id: true, name: true, offer: true } }) : null,
      db.domainEvent.findMany({ where: { workspaceId, aggregateType: 'OPPORTUNITY', aggregateId: o.id }, orderBy: { occurredAt: 'asc' }, take: 200, select: { id: true, eventType: true, payload: true, actorType: true, actorId: true, occurredAt: true } }),
      db.workspaceMember.findMany({ where: { workspaceId, status: 'ACTIVE' }, select: { user: { select: { id: true, name: true } } } }),
      db.pipeline.findFirst({ where: { workspaceId, isDefault: true }, include: { stages: { orderBy: { position: 'asc' } } } }),
      db.employment.findMany({ where: { workspaceId, companyId: o.companyId, isCurrent: true }, select: { title: true, person: { select: { id: true, fullName: true } } } }),
    ]);
    // Meeting journey (screen #8 §35): this deal's meetings, plus the company's that aren't tied to another deal.
    const meetings = await db.meeting.findMany({
      where: { workspaceId, OR: [{ opportunityId: o.id }, { companyId: o.companyId, opportunityId: null }] },
      orderBy: [{ startAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      take: 20,
      select: { id: true, title: true, status: true, startAt: true, pendingStartAt: true, timezone: true, meetingType: { select: { name: true } }, outcome: { select: { outcome: true, nextStep: true } } },
    });
    // Origin (screen #7 §28): which market found the company first.
    const firstSeen = await db.discoveryObservation.findFirst({ where: { workspaceId, companyId: o.companyId }, orderBy: { createdAt: 'asc' }, select: { provider: true, mission: { select: { market: { select: { id: true, name: true } } } } } });
    const inputs = await this.inputs([o]);
    const ctx = inputs.get(o.id)!;
    const health = dealHealth(ctx.input, now);
    const userIds = [...new Set([...history.map((h) => h.actorId), ...events.map((e) => e.actorId), ...(qualification?.answers ?? []).map((a) => a.verifiedById)].filter((x): x is string => !!x))];
    const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const nameOf = (uid: string | null) => (uid ? (users.find((u) => u.id === uid)?.name ?? null) : null);
    const stageName = new Map((pipeline?.stages ?? []).map((s) => [s.id, s.name]));

    // Suggested loss reason from what they said (a person confirms).
    let lossSuggestion = null;
    if (o.status === 'OPEN' && o.conversationId) {
      const readings = await db.messageClassification.findMany({ where: { conversationId: o.conversationId }, orderBy: { createdAt: 'asc' }, select: { primaryIntent: true, objections: true, message: { select: { text: true } } } });
      lossSuggestion = suggestLossReason(readings.map((r) => ({ primaryIntent: r.primaryIntent, objections: r.objections as { type: string; text: string }[], text: r.message.text })));
    }

    const answers = qualification?.answers ?? [];
    return {
      opportunity: {
        id: o.id,
        name: o.name,
        service: o.service,
        status: o.status,
        stage: o.stage.semantic,
        stageName: o.stage.name,
        amountMinor: o.amountMinor,
        wonAmountMinor: o.wonAmountMinor,
        wonNote: o.wonNote,
        currency: o.currency,
        source: o.source,
        originReason: o.originReason,
        originQuote: o.originQuote,
        createdByType: o.createdByType,
        nextActionOverride: o.nextActionOverride,
        nextActionDueAt: o.nextActionDueAt,
        stageEnteredAt: o.stageEnteredAt,
        lastActivityAt: o.lastActivityAt,
        closedAt: o.closedAt,
        createdAt: o.createdAt,
        primaryPersonId: o.primaryPersonId,
        version: o.version,
      },
      owner,
      company: { id: company.id, name: company.displayName, industry: company.industry, city: company.city, region: company.region, website: company.websiteDomain, status: company.status },
      contact: ctx.person,
      people: people.map((p) => ({ id: p.person.id, name: p.person.fullName, title: p.title })),
      conversation,
      campaign,
      origin: { market: firstSeen?.mission?.market ?? null, leadSource: firstSeen?.provider ?? null, campaign: campaign ? { id: campaign.id, name: campaign.name } : null, offer: campaign?.offer ?? null, source: o.source },
      health,
      nextAction: nextBestAction(ctx.input, now),
      qualification: {
        status: qualification?.status ?? 'UNQUALIFIED',
        fields: QUALIFICATION_KEYS.map((key) => {
          const current = answers.find((a) => a.key === key && !a.supersededAt) ?? null;
          return {
            key,
            current: current ? { id: current.id, value: current.value, quote: current.quote, source: current.source, confidence: current.confidence, verified: current.verified, verifiedBy: nameOf(current.verifiedById), messageId: current.sourceMessageId, at: current.createdAt } : null,
            history: answers.filter((a) => a.key === key && a.supersededAt).map((a) => ({ id: a.id, value: a.value, quote: a.quote, source: a.source, at: a.createdAt, supersededAt: a.supersededAt })),
          };
        }),
      },
      stakeholders,
      stages: (pipeline?.stages ?? []).map((s) => ({
        id: s.id,
        name: s.name,
        semantic: s.semantic,
        current: s.id === o.stageId,
        allowed: allowedStages(ctx.input).includes(s.semantic as StageSemantic),
        missing: OPEN_PATH.includes(s.semantic as StageSemantic) ? stageRequirements(s.semantic as StageSemantic, ctx.input) : [],
      })),
      history: history.map((h) => ({ id: h.id, from: h.fromStageId ? (stageName.get(h.fromStageId) ?? h.fromSemantic) : null, to: stageName.get(h.toStageId) ?? h.toSemantic, toSemantic: h.toSemantic, actorType: h.actorType, actorName: nameOf(h.actorId), reason: h.reason, at: h.changedAt })),
      losses,
      lossSuggestion,
      timeline: events.map((e) => ({ id: e.id, type: e.eventType, payload: e.payload, actorType: e.actorType, actorName: nameOf(e.actorId), at: e.occurredAt })),
      members: members.map((m) => m.user),
      meetings: meetings.map((m) => ({ id: m.id, title: m.title, typeName: m.meetingType.name, status: m.status, startAt: m.startAt, pendingStartAt: m.pendingStartAt, timezone: m.timezone, outcome: m.outcome?.outcome ?? null, nextStep: m.outcome?.nextStep ?? null })),
    };
  }
}
