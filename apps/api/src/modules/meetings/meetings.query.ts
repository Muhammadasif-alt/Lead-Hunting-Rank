import { Injectable } from '@nestjs/common';
import type { Meeting, MeetingType, Prisma } from '@revenue-os/database';
import { meetingNextAction, meetingTypeBlocked, meetingTypes, noShowRisk } from '@revenue-os/outreach';
import { NotFoundError, QUALIFICATION_KEYS, type StageSemantic } from '@revenue-os/shared';
import { PrismaService } from '../../infra/prisma.service.js';

type Row = Meeting & { meetingType: MeetingType };
const slotsOf = (m: Pick<Meeting, 'offeredSlots'>) => (Array.isArray(m.offeredSlots) ? (m.offeredSlots as unknown as { start: string; end: string }[]) : []);
const DAY_MS = 86_400_000;

/**
 * Read models for screen #8: the calendar (booked meetings in a range, what is being arranged, what needs action),
 * one meeting with its brief, journey and allowed actions, and the setup (meeting types, who can be booked when).
 * Priority is evidence (deal stage, decision maker attending), never calendar order.
 */
@Injectable()
export class MeetingsQuery {
  constructor(private readonly prisma: PrismaService) {}

  private async cards(rows: Row[], now: Date) {
    const db = this.prisma.client;
    const [companies, users, opps, briefs, attendees] = await Promise.all([
      db.company.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.companyId))] } }, select: { id: true, displayName: true } }),
      db.user.findMany({ where: { id: { in: rows.map((r) => r.ownerUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
      db.opportunity.findMany({ where: { id: { in: rows.map((r) => r.opportunityId).filter((x): x is string => !!x) } }, select: { id: true, name: true, status: true, amountMinor: true, currency: true, stage: { select: { semantic: true, name: true } } } }),
      db.meetingBrief.findMany({ where: { meetingId: { in: rows.map((r) => r.id) } }, orderBy: { version: 'desc' }, select: { meetingId: true, gaps: true, generatedAt: true } }),
      db.meetingAttendee.findMany({ where: { meetingId: { in: rows.map((r) => r.id) } }, select: { meetingId: true, side: true, name: true, personId: true } }),
    ]);
    const titles = await db.employment.findMany({ where: { personId: { in: attendees.map((a) => a.personId).filter((x): x is string => !!x) }, isCurrent: true }, select: { personId: true, title: true } });
    return rows.map((m) => {
      const opp = opps.find((o) => o.id === m.opportunityId) ?? null;
      const external = attendees.filter((a) => a.meetingId === m.id && a.side === 'EXTERNAL');
      const decider = external.some((a) => a.personId && /\b(owner|founder|ceo|president|director|partner)\b/i.test(titles.find((t) => t.personId === a.personId)?.title ?? ''));
      const highlights: string[] = [];
      if (opp?.stage.semantic === 'PROPOSAL' || opp?.stage.semantic === 'NEGOTIATION') highlights.push(`${opp.stage.name} decision`);
      if (decider) highlights.push('Decision maker attending');
      if (opp?.amountMinor && opp.amountMinor >= 500_000) highlights.push('High value');
      const latestBrief = briefs.find((b) => b.meetingId === m.id) ?? null;
      const slots = slotsOf(m);
      return {
        id: m.id,
        title: m.title,
        typeName: m.meetingType.name,
        status: m.status,
        startAt: m.startAt,
        endAt: m.endAt,
        pendingStartAt: m.pendingStartAt,
        timezone: m.timezone,
        ownerTimezone: m.ownerTimezone,
        locationType: m.locationType,
        meetingUrl: m.meetingUrl,
        company: companies.find((c) => c.id === m.companyId) ? { id: m.companyId, name: companies.find((c) => c.id === m.companyId)!.displayName } : null,
        contact: external[0]?.name ?? null,
        owner: m.ownerUserId ? { id: m.ownerUserId, name: users.find((u) => u.id === m.ownerUserId)?.name ?? null } : null,
        opportunity: opp ? { id: opp.id, name: opp.name, stage: opp.stage.semantic as StageSemantic, stageName: opp.stage.name, status: opp.status } : null,
        conversationId: m.conversationId,
        highlights,
        priority: highlights.length ? 'HIGH' : 'NORMAL',
        needsOutcome: m.status === 'BOOKED' && !!m.endAt && m.endAt < now,
        brief: latestBrief ? { gaps: latestBrief.gaps.length, generatedAt: latestBrief.generatedAt } : null,
        slots: slots.length,
        statusReason: m.statusReason,
        nextAction: meetingNextAction({ status: m.status, startAt: m.startAt, endAt: m.endAt, pendingStartAt: m.pendingStartAt, offeredAt: m.offeredAt, slots: slots.length, statusReason: m.statusReason, hasOwner: !!m.ownerUserId }, now),
        createdAt: m.createdAt,
      };
    });
  }

  /** The calendar: booked meetings between `from` and `to`, plus what is being arranged and what needs a person. */
  async list(workspaceId: string, userId: string, q: { from: Date; to: Date; mine: boolean }) {
    const db = this.prisma.client;
    const now = new Date();
    const mine: Prisma.MeetingWhereInput = q.mine ? { ownerUserId: userId } : {};
    const [booked, arranging, needsOutcome, noShows] = await Promise.all([
      db.meeting.findMany({ where: { workspaceId, ...mine, status: { in: ['BOOKED', 'RESCHEDULING', 'COMPLETED', 'NO_SHOW'] }, startAt: { gte: q.from, lt: q.to } }, include: { meetingType: true }, orderBy: { startAt: 'asc' }, take: 300 }),
      db.meeting.findMany({ where: { workspaceId, ...mine, status: { in: ['PROPOSED', 'PENDING_CONFIRMATION'] } }, include: { meetingType: true }, orderBy: { createdAt: 'desc' }, take: 100 }),
      db.meeting.findMany({ where: { workspaceId, ...mine, status: 'BOOKED', endAt: { lt: now } }, include: { meetingType: true }, orderBy: { endAt: 'desc' }, take: 50 }),
      db.meeting.findMany({ where: { workspaceId, ...mine, status: 'NO_SHOW', completedAt: { gte: new Date(now.getTime() - 14 * DAY_MS) } }, include: { meetingType: true }, orderBy: { completedAt: 'desc' }, take: 20 }),
    ]);
    const all = [...new Map([...booked, ...arranging, ...needsOutcome, ...noShows].map((m) => [m.id, m])).values()];
    const cards = await this.cards(all, now);
    const byId = new Map(cards.map((c) => [c.id, c]));
    const startOfDay = new Date(now);
    startOfDay.setUTCHours(0, 0, 0, 0);
    const weekEnd = new Date(now.getTime() + 7 * DAY_MS);
    const [todayCount, weekCount, upcoming] = await Promise.all([
      db.meeting.count({ where: { workspaceId, ...mine, status: { in: ['BOOKED', 'RESCHEDULING'] }, startAt: { gte: now, lt: new Date(now.getTime() + DAY_MS) } } }),
      db.meeting.count({ where: { workspaceId, ...mine, status: { in: ['BOOKED', 'RESCHEDULING'] }, startAt: { gte: now, lt: weekEnd } } }),
      db.meeting.findMany({ where: { workspaceId, ...mine, status: { in: ['BOOKED', 'RESCHEDULING'] }, startAt: { gte: now } }, include: { meetingType: true }, orderBy: { startAt: 'asc' }, take: 1 }),
    ]);
    const next = upcoming[0] ? ((await this.cards(upcoming, now))[0] ?? null) : null;
    const prep = cards.filter((c) => c.status === 'BOOKED' && c.startAt && c.startAt > now && c.startAt.getTime() - now.getTime() < 2 * DAY_MS && (!c.brief || c.brief.gaps > 1)).length;
    return {
      summary: { next24h: todayCount, next7d: weekCount, arranging: arranging.length, needsOutcome: needsOutcome.length, noShowFollowUps: noShows.length, prepRequired: prep },
      next,
      meetings: booked.map((m) => byId.get(m.id)!),
      arranging: arranging.map((m) => byId.get(m.id)!),
      needsAction: [...needsOutcome, ...noShows].map((m) => byId.get(m.id)!),
    };
  }

  async detail(workspaceId: string, id: string) {
    const db = this.prisma.client;
    const now = new Date();
    const m = await db.meeting.findFirst({ where: { id, workspaceId }, include: { meetingType: true, attendees: { orderBy: { createdAt: 'asc' } }, outcome: true, changes: { orderBy: { at: 'asc' } } } });
    if (!m) throw new NotFoundError('Meeting not found');
    const [company, conversation, opportunity, latestBrief, briefCount, action, types, profiles, members, journey, noShows] = await Promise.all([
      db.company.findFirstOrThrow({ where: { id: m.companyId, workspaceId }, select: { id: true, displayName: true, industry: true, city: true, region: true, websiteDomain: true } }),
      m.conversationId ? db.conversation.findFirst({ where: { id: m.conversationId, workspaceId }, select: { id: true, subject: true, email: true, contactName: true, category: true, stage: true, mode: true, context: true } }) : null,
      m.opportunityId ? db.opportunity.findFirst({ where: { id: m.opportunityId, workspaceId }, include: { stage: true, qualification: true } }) : null,
      db.meetingBrief.findFirst({ where: { meetingId: m.id }, orderBy: { version: 'desc' } }),
      db.meetingBrief.count({ where: { meetingId: m.id } }),
      m.externalActionId ? db.externalAction.findUnique({ where: { id: m.externalActionId }, select: { id: true, actionType: true, status: true, statusReason: true, approvalRequestId: true, resumeAt: true } }) : null,
      db.meetingType.findMany({ where: { workspaceId, active: true }, orderBy: { position: 'asc' } }),
      db.schedulingProfile.findMany({ where: { workspaceId } }),
      db.workspaceMember.findMany({ where: { workspaceId, status: 'ACTIVE' }, select: { user: { select: { id: true, name: true } } } }),
      db.meeting.findMany({ where: { workspaceId, companyId: m.companyId }, orderBy: [{ startAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }], include: { meetingType: { select: { name: true } }, outcome: { select: { outcome: true } } }, take: 20 }),
      db.meeting.count({ where: { workspaceId, companyId: m.companyId, status: 'NO_SHOW' } }),
    ]);
    const userIds = [...new Set([m.ownerUserId, ...m.changes.map((c) => c.actorId), m.outcome?.recordedById].filter((x): x is string => !!x))];
    const users = userIds.length ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const nameOf = (uid: string | null | undefined) => (uid ? (users.find((u) => u.id === uid)?.name ?? null) : null);
    const answers = opportunity ? await db.qualificationAnswer.findMany({ where: { qualification: { opportunityId: opportunity.id }, supersededAt: null }, select: { key: true } }) : [];
    const ctxKeys = Object.keys((conversation?.context ?? {}) as Record<string, unknown>).filter((k) => (QUALIFICATION_KEYS as readonly string[]).includes(k));
    const known = new Set(opportunity ? answers.map((a) => a.key) : ctxKeys);
    const qualified = opportunity ? opportunity.qualification?.status === 'QUALIFIED' : known.has('NEED') && (known.has('AUTHORITY') || known.has('TIMELINE'));
    const slots = slotsOf(m);
    const arranging = m.status === 'PROPOSED' || m.status === 'PENDING_CONFIRMATION';
    const booking = arranging && !!m.pendingStartAt;
    const started = !!m.startAt && m.startAt.getTime() <= now.getTime() + 15 * 60_000;
    const allowed: string[] = [];
    if (arranging && !booking) allowed.push('refresh', 'offer', 'book', 'confirm-manual');
    if (m.status === 'BOOKED') allowed.push('reschedule');
    if (['PROPOSED', 'PENDING_CONFIRMATION', 'BOOKED', 'RESCHEDULING'].includes(m.status) && !(action && ['EXECUTING', 'UNKNOWN_OUTCOME'].includes(action.status))) allowed.push('cancel');
    if (m.status === 'BOOKED' && started) allowed.push('outcome', 'no-show');
    if (m.outcome?.recommendedStage && !m.outcome.stageApplied && opportunity?.status === 'OPEN') allowed.push('apply-stage');
    allowed.push('brief');

    return {
      meeting: {
        id: m.id,
        title: m.title,
        status: m.status,
        statusReason: m.statusReason,
        startAt: m.startAt,
        endAt: m.endAt,
        pendingStartAt: m.pendingStartAt,
        pendingEndAt: m.pendingEndAt,
        timezone: m.timezone,
        timezoneSource: m.timezoneSource,
        timezoneConfidence: m.timezoneConfidence,
        ownerTimezone: m.ownerTimezone,
        routingReason: m.routingReason,
        requestText: m.requestText,
        preferenceLabel: (m.preference as { label?: string } | null)?.label ?? null,
        slots,
        slotsCheckedAt: m.slotsCheckedAt,
        offeredAt: m.offeredAt,
        locationType: m.locationType,
        meetingUrl: m.meetingUrl,
        bookedVia: m.bookedVia,
        bookedAt: m.bookedAt,
        providerEventId: m.providerEventId,
        lastSyncedAt: m.lastSyncedAt,
        cancelSource: m.cancelSource,
        cancelReason: m.cancelReason,
        cancelledAt: m.cancelledAt,
        completedAt: m.completedAt,
        createdByType: m.createdByType,
        createdAt: m.createdAt,
        version: m.version,
        nextAction: meetingNextAction({ status: m.status, startAt: m.startAt, endAt: m.endAt, pendingStartAt: m.pendingStartAt, offeredAt: m.offeredAt, slots: slots.length, statusReason: m.statusReason, hasOwner: !!m.ownerUserId }, now),
      },
      type: { id: m.meetingType.id, key: m.meetingType.key, name: m.meetingType.name, durationMinutes: m.meetingType.durationMinutes, aiBookingAllowed: m.meetingType.aiBookingAllowed, requiredQualification: m.meetingType.requiredQualification },
      owner: m.ownerUserId ? { id: m.ownerUserId, name: nameOf(m.ownerUserId) } : null,
      company: { id: company.id, name: company.displayName, industry: company.industry, city: company.city, region: company.region, website: company.websiteDomain },
      conversation: conversation ? { id: conversation.id, subject: conversation.subject, email: conversation.email, contactName: conversation.contactName, category: conversation.category, stage: conversation.stage, mode: conversation.mode } : null,
      opportunity: opportunity ? { id: opportunity.id, name: opportunity.name, status: opportunity.status, stage: opportunity.stage.semantic as StageSemantic, stageName: opportunity.stage.name, amountMinor: opportunity.amountMinor, currency: opportunity.currency } : null,
      attendees: m.attendees.map((a) => ({ id: a.id, side: a.side, name: a.name, email: a.email, role: a.role, personId: a.personId, userId: a.userId, expected: a.expected, attended: a.attended })),
      brief: latestBrief ? { version: latestBrief.version, versions: briefCount, content: latestBrief.content, gaps: latestBrief.gaps, method: latestBrief.method, generatedAt: latestBrief.generatedAt } : null,
      outcome: m.outcome ? { ...m.outcome, recordedBy: nameOf(m.outcome.recordedById) } : null,
      action,
      changes: m.changes.map((c) => ({ id: c.id, kind: c.kind, fromStartAt: c.fromStartAt, toStartAt: c.toStartAt, toEndAt: c.toEndAt, source: c.source, actorType: c.actorType, actorName: nameOf(c.actorId), reason: c.reason, at: c.at })),
      journey: journey.map((j) => ({ id: j.id, title: j.meetingType.name, status: j.status, startAt: j.startAt, outcome: j.outcome?.outcome ?? null, current: j.id === m.id })),
      noShows,
      noShowRisk: noShowRisk(noShows),
      types: types.map((t) => ({ id: t.id, name: t.name, durationMinutes: t.durationMinutes, blocked: meetingTypeBlocked(t.requiredQualification, { known, qualified }), aiBookingAllowed: t.aiBookingAllowed })),
      owners: members.filter((x) => profiles.some((p) => p.userId === x.user.id && p.acceptsMeetings)).map((x) => x.user),
      allowedActions: allowed,
    };
  }

  /** Setup: meeting types, who can be booked when, and the calendars they can use. */
  async setup(workspaceId: string, userId: string) {
    const db = this.prisma.client;
    const [types, profiles, members, calendars, workspace] = await Promise.all([
      // The default types are created on first use.
      meetingTypes(db, workspaceId),
      db.schedulingProfile.findMany({ where: { workspaceId } }),
      db.workspaceMember.findMany({ where: { workspaceId, status: 'ACTIVE' }, select: { user: { select: { id: true, name: true, email: true, timezone: true } } } }),
      db.integration.findMany({ where: { workspaceId, capabilities: { has: 'CALENDAR_READ' }, status: { notIn: ['DISCONNECTED'] } }, select: { id: true, name: true, provider: true, status: true, accountRef: true } }),
      db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { defaultTimezone: true } }),
    ]);
    const shape = (p: (typeof profiles)[number]) => ({
      userId: p.userId,
      timezone: p.timezone,
      workingDays: p.workingDays,
      meetingStartMinute: p.meetingStartMinute,
      meetingEndMinute: p.meetingEndMinute,
      lunchStartMinute: p.lunchStartMinute,
      lunchEndMinute: p.lunchEndMinute,
      bufferMinutes: p.bufferMinutes,
      maxMeetingsPerDay: p.maxMeetingsPerDay,
      minNoticeMinutes: p.minNoticeMinutes,
      calendarIntegrationId: p.calendarIntegrationId,
      calendarId: p.calendarId,
      acceptsMeetings: p.acceptsMeetings,
      unavailableUntil: p.unavailableUntil,
      version: p.version,
    });
    const mine = profiles.find((p) => p.userId === userId);
    return {
      workspaceTimezone: workspace.defaultTimezone,
      types: types.map((t) => ({ id: t.id, key: t.key, name: t.name, description: t.description, durationMinutes: t.durationMinutes, bufferMinutes: t.bufferMinutes, requiredQualification: t.requiredQualification, aiBookingAllowed: t.aiBookingAllowed, briefEnabled: t.briefEnabled, locationType: t.locationType, active: t.active, version: t.version })),
      me: mine ? shape(mine) : null,
      team: members.map((x) => {
        const p = profiles.find((pp) => pp.userId === x.user.id);
        return { user: { id: x.user.id, name: x.user.name, email: x.user.email }, profile: p ? shape(p) : null };
      }),
      calendars: calendars.map((c) => ({ id: c.id, name: c.name, provider: c.provider, status: c.status, test: c.provider === 'fake_calendar' })),
      suggestedTimezone: members.find((x) => x.user.id === userId)?.user.timezone ?? workspace.defaultTimezone,
    };
  }
}
