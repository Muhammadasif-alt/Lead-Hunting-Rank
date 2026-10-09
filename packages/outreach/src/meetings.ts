import { agentDefinition } from '@revenue-os/ai';
import { Prisma, provisionMeetingTypes, type ExternalAction, type Meeting, type MeetingOutcomeType, type MeetingStatus, type MeetingType, type PrismaClient, type SchedulingProfile } from '@revenue-os/database';
import { writeAudit, type ServiceContext, type Tx } from '@revenue-os/domain';
import { recordEvent, type Revalidator } from '@revenue-os/events';
import { requestExternalAction } from '@revenue-os/policy';
import { CALENDAR_ACTIONS } from '@revenue-os/providers';
import {
  BusinessRuleError,
  ConflictError,
  describeError,
  findSlots,
  formatSlot,
  inferTimezone,
  isTimezone,
  matchChosenSlot,
  NotFoundError,
  offerMessage,
  parseMeetingPreference,
  QUALIFICATION_KEYS,
  ValidationError,
  zonedParts,
  type MeetingPreference,
  type QualificationKey,
  type StageSemantic,
  type TimeSlot,
} from '@revenue-os/shared';
import { cancelPendingMessages, LIVE_ENROLLMENT } from './campaigns.js';
import { categorize, priorityOf } from './conversation-rules.js';
import type { OutreachDeps } from './engine.js';
import { buildBrief, meetingTypeBlocked, noShowRisk, recommendMeetingType, recommendStage, routeMeeting, type BriefInput } from './meeting-rules.js';
import { advanceStageTx, changeStage, createOpportunityTx, shortOffer, snapshotOf } from './opportunities.js';
import { qualificationStatus } from './opportunity-rules.js';

const TX = { timeout: 30_000, maxWait: 10_000 } as const;
const DAY_MS = 86_400_000;
const system = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'SYSTEM', id: null } });
const schedulingAgent = (workspaceId: string): ServiceContext => ({ workspaceId, actor: { type: 'AI_AGENT', id: null } });

/** Statuses of a meeting that is still being arranged — at most one per conversation (partial unique index). */
const SCHEDULING: MeetingStatus[] = ['PROPOSED', 'PENDING_CONFIRMATION'];
/** Statuses that occupy the owner's time. */
const HOLDS_TIME: MeetingStatus[] = ['BOOKED', 'RESCHEDULING'];
const CANCELLABLE_ACTION = ['PREPARED', 'WAITING_APPROVAL', 'APPROVED', 'QUEUED', 'WAITING'] as const;
const IN_FLIGHT_ACTION = ['EXECUTING', 'UNKNOWN_OUTCOME'];
const SLOTS_FRESH_MS = 30 * 60_000;

/** One key per booking attempt / move / cancellation (docs/11 §21) — a double click never books twice. */
export const meetingKeys = {
  book: (meetingId: string, start: string) => `meeting:${meetingId}:book:${new Date(start).toISOString()}`,
  move: (meetingId: string, start: string) => `meeting:${meetingId}:move:${new Date(start).toISOString()}`,
  cancel: (meetingId: string) => `meeting:${meetingId}:cancel`,
};

const slotsOf = (m: Pick<Meeting, 'offeredSlots'>) => (Array.isArray(m.offeredSlots) ? (m.offeredSlots as unknown as TimeSlot[]) : []);

async function loadMeeting(db: Tx | PrismaClient, workspaceId: string, id: string) {
  const m = await db.meeting.findFirst({ where: { id, workspaceId }, include: { meetingType: true } });
  if (!m) throw new NotFoundError('Meeting not found');
  return m;
}

async function change(tx: Tx, ctx: ServiceContext, meetingId: string, kind: string, source: string, data: { fromStartAt?: Date | null; toStartAt?: Date | null; toEndAt?: Date | null; reason?: string | null } = {}) {
  await tx.meetingChange.create({
    data: { workspaceId: ctx.workspaceId, meetingId, kind, source, actorType: ctx.actor.type, actorId: ctx.actor.id, fromStartAt: data.fromStartAt ?? null, toStartAt: data.toStartAt ?? null, toEndAt: data.toEndAt ?? null, reason: data.reason?.slice(0, 500) ?? null },
  });
}

const sourceOf = (ctx: ServiceContext) => (ctx.actor.type === 'HUMAN' ? 'TEAM' : ctx.actor.type === 'AI_AGENT' ? 'AI' : 'SYSTEM');

// ───────────────────────────── setup ─────────────────────────────

/** The workspace's meeting types (the defaults are created on first use). */
export async function meetingTypes(db: PrismaClient | Tx, workspaceId: string): Promise<MeetingType[]> {
  let types = await db.meetingType.findMany({ where: { workspaceId }, orderBy: { position: 'asc' } });
  if (!types.length) {
    await provisionMeetingTypes(db, workspaceId);
    types = await db.meetingType.findMany({ where: { workspaceId }, orderBy: { position: 'asc' } });
  }
  return types;
}

export interface MeetingTypeInput {
  name?: string;
  description?: string | null;
  durationMinutes?: number;
  bufferMinutes?: number;
  requiredQualification?: 'NONE' | 'NEED' | 'QUALIFIED';
  aiBookingAllowed?: boolean;
  briefEnabled?: boolean;
  locationType?: 'VIDEO' | 'PHONE' | 'IN_PERSON';
  active?: boolean;
}

export async function updateMeetingType(db: PrismaClient, ctx: ServiceContext, id: string, input: MeetingTypeInput) {
  if (input.durationMinutes !== undefined && (input.durationMinutes < 5 || input.durationMinutes > 480)) throw new ValidationError('Duration must be 5–480 minutes', [{ path: 'durationMinutes', message: '5–480' }]);
  if (input.bufferMinutes !== undefined && (input.bufferMinutes < 0 || input.bufferMinutes > 240)) throw new ValidationError('Buffer must be 0–240 minutes', [{ path: 'bufferMinutes', message: '0–240' }]);
  return db.$transaction(async (tx) => {
    const t = await tx.meetingType.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!t) throw new NotFoundError('Meeting type not found');
    const data: Prisma.MeetingTypeUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim().slice(0, 100) || t.name;
    if (input.description !== undefined) data.description = input.description?.trim().slice(0, 300) || null;
    for (const k of ['durationMinutes', 'bufferMinutes', 'requiredQualification', 'aiBookingAllowed', 'briefEnabled', 'locationType', 'active'] as const) if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
    const changed = Object.keys(data);
    if (!changed.length) return t;
    const updated = await tx.meetingType.update({ where: { id: t.id }, data: { ...data, version: { increment: 1 } } });
    await writeAudit(tx, ctx, { action: 'meeting_type.updated', entityType: 'MEETING_TYPE', entityId: t.id, before: Object.fromEntries(changed.map((k) => [k, (t as Record<string, unknown>)[k]])), after: Object.fromEntries(changed.map((k) => [k, (updated as Record<string, unknown>)[k]])) });
    await recordEvent(tx, ctx, 'MeetingTypeUpdated', t.id, { meetingTypeId: t.id, changedFields: changed });
    return updated;
  }, TX);
}

export interface SchedulingProfileInput {
  timezone?: string;
  workingDays?: number[];
  meetingStartMinute?: number;
  meetingEndMinute?: number;
  lunchStartMinute?: number | null;
  lunchEndMinute?: number | null;
  bufferMinutes?: number;
  maxMeetingsPerDay?: number;
  minNoticeMinutes?: number;
  calendarIntegrationId?: string | null;
  calendarId?: string;
  acceptsMeetings?: boolean;
  unavailableUntil?: Date | null;
}

/** A person sets when they can be booked (screen #8 §5). Creating it the first time uses sensible defaults. */
export async function saveSchedulingProfile(db: PrismaClient, ctx: ServiceContext, userId: string, input: SchedulingProfileInput) {
  if (input.timezone !== undefined && !isTimezone(input.timezone)) throw new ValidationError('Unknown time zone', [{ path: 'timezone', message: 'Use an IANA name like America/Chicago' }]);
  if (input.workingDays && (!input.workingDays.length || input.workingDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))) throw new ValidationError('Pick at least one working day', [{ path: 'workingDays', message: '0 (Sun) – 6 (Sat)' }]);
  return db.$transaction(async (tx) => {
    const member = await tx.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId } }, include: { user: { select: { timezone: true } } } });
    if (!member || member.status !== 'ACTIVE') throw new NotFoundError('Member not found');
    if (input.calendarIntegrationId) {
      const cal = await tx.integration.findFirst({ where: { id: input.calendarIntegrationId, workspaceId: ctx.workspaceId, capabilities: { has: 'CALENDAR_READ' } } });
      if (!cal) throw new ValidationError('That calendar is not connected', [{ path: 'calendarIntegrationId', message: 'Unknown calendar' }]);
    }
    const existing = await tx.schedulingProfile.findUnique({ where: { workspaceId_userId: { workspaceId: ctx.workspaceId, userId } } });
    const ws = await tx.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { defaultTimezone: true } });
    const merged = {
      timezone: input.timezone ?? existing?.timezone ?? (isTimezone(member.user.timezone) ? member.user.timezone : ws.defaultTimezone),
      workingDays: input.workingDays ?? existing?.workingDays ?? [1, 2, 3, 4, 5],
      meetingStartMinute: input.meetingStartMinute ?? existing?.meetingStartMinute ?? 9 * 60,
      meetingEndMinute: input.meetingEndMinute ?? existing?.meetingEndMinute ?? 17 * 60,
      lunchStartMinute: input.lunchStartMinute !== undefined ? input.lunchStartMinute : (existing?.lunchStartMinute ?? 12 * 60 + 30),
      lunchEndMinute: input.lunchEndMinute !== undefined ? input.lunchEndMinute : (existing?.lunchEndMinute ?? 13 * 60 + 30),
      bufferMinutes: input.bufferMinutes ?? existing?.bufferMinutes ?? 15,
      maxMeetingsPerDay: input.maxMeetingsPerDay ?? existing?.maxMeetingsPerDay ?? 5,
      minNoticeMinutes: input.minNoticeMinutes ?? existing?.minNoticeMinutes ?? 240,
      calendarIntegrationId: input.calendarIntegrationId !== undefined ? input.calendarIntegrationId : (existing?.calendarIntegrationId ?? null),
      calendarId: input.calendarId?.trim() || existing?.calendarId || 'primary',
      acceptsMeetings: input.acceptsMeetings ?? existing?.acceptsMeetings ?? true,
      unavailableUntil: input.unavailableUntil !== undefined ? input.unavailableUntil : (existing?.unavailableUntil ?? null),
    };
    if (merged.meetingEndMinute <= merged.meetingStartMinute) throw new ValidationError('Meeting hours must end after they start', [{ path: 'meetingEndMinute', message: 'After the start' }]);
    if ((merged.lunchStartMinute === null) !== (merged.lunchEndMinute === null) || (merged.lunchStartMinute !== null && merged.lunchEndMinute! <= merged.lunchStartMinute)) throw new ValidationError('Lunch needs a start and a later end (or neither)', [{ path: 'lunchEndMinute', message: 'Invalid' }]);
    const saved = existing
      ? await tx.schedulingProfile.update({ where: { id: existing.id }, data: { ...merged, version: { increment: 1 } } })
      : await tx.schedulingProfile.create({ data: { workspaceId: ctx.workspaceId, userId, ...merged } });
    const changed = Object.keys(input);
    await writeAudit(tx, ctx, { action: 'scheduling_profile.saved', entityType: 'USER', entityId: userId, after: { changedFields: changed } });
    await recordEvent(tx, ctx, 'SchedulingProfileUpdated', ctx.workspaceId, { userId, changedFields: changed.length ? changed : ['created'] });
    return saved;
  }, TX);
}

// ───────────────────────────── availability ─────────────────────────────

/** The calendar a person's availability is read from: theirs if set, else the workspace's first connected calendar. */
async function calendarFor(db: Tx | PrismaClient, workspaceId: string, profile: Pick<SchedulingProfile, 'calendarIntegrationId' | 'calendarId'>) {
  const integration = await db.integration.findFirst({
    where: { workspaceId, ...(profile.calendarIntegrationId ? { id: profile.calendarIntegrationId } : {}), status: { notIn: ['DISABLED', 'DISCONNECTED', 'CONNECTING'] }, capabilities: { hasEvery: ['CALENDAR_READ', 'CALENDAR_WRITE'] } },
    orderBy: [{ priority: 'asc' }, { connectedAt: 'asc' }],
  });
  return integration ? { integration, calendarId: profile.calendarId || 'primary' } : null;
}

export interface AvailabilityRequest {
  workspaceId: string;
  ownerUserId: string;
  durationMinutes: number;
  bufferMinutes: number;
  prospectTimezone: string;
  preference: MeetingPreference | null;
  exceptMeetingId?: string;
  from?: Date;
  days?: number;
  limit?: number;
}

export interface Availability {
  slots: TimeSlot[];
  preferenceMatched: boolean;
  reason: string | null;
  calendar: { integrationId: string; provider: string; calendarId: string } | null;
  ownerTimezone: string | null;
  checkedAt: Date;
}

/** Busy time from the calendar (fresh) plus our own meetings that hold the owner's time. */
async function busyFor(deps: OutreachDeps, req: { workspaceId: string; ownerUserId: string; integrationId: string; calendarId: string; from: Date; to: Date; exceptMeetingId?: string; tz: string }) {
  const { value: calendarBusy } = await deps.providers.call({ workspaceId: req.workspaceId, capability: 'CALENDAR_READ', operation: 'get_busy', integrationId: req.integrationId }, (cal, options) =>
    cal.getBusy(req.calendarId, { start: req.from.toISOString(), end: req.to.toISOString() }, options),
  );
  const ours = await deps.db.meeting.findMany({
    where: {
      workspaceId: req.workspaceId,
      ownerUserId: req.ownerUserId,
      ...(req.exceptMeetingId ? { id: { not: req.exceptMeetingId } } : {}),
      OR: [
        { status: { in: HOLDS_TIME }, startAt: { lt: req.to }, endAt: { gt: req.from } },
        { pendingStartAt: { lt: req.to }, pendingEndAt: { gt: req.from } },
      ],
    },
    select: { status: true, startAt: true, endAt: true, pendingStartAt: true, pendingEndAt: true },
  });
  const busy: TimeSlot[] = [...calendarBusy];
  const bookedPerDay: Record<string, number> = {};
  for (const m of ours) {
    if (HOLDS_TIME.includes(m.status) && m.startAt && m.endAt) {
      busy.push({ start: m.startAt.toISOString(), end: m.endAt.toISOString() });
      const day = zonedParts(m.startAt, req.tz).date;
      bookedPerDay[day] = (bookedPerDay[day] ?? 0) + 1;
    }
    if (m.pendingStartAt && m.pendingEndAt) busy.push({ start: m.pendingStartAt.toISOString(), end: m.pendingEndAt.toISOString() });
  }
  return { busy, bookedPerDay };
}

/**
 * Real availability (docs/12 §33: never cached as truth): the owner's rules, the calendar's busy time read now, and
 * our own booked meetings. A calendar that can't be read means no slots and a reason — never invented times.
 */
export async function findAvailability(deps: OutreachDeps, req: AvailabilityRequest): Promise<Availability> {
  const now = deps.now?.() ?? new Date();
  const db = deps.db;
  const empty = (reason: string, extra: Partial<Availability> = {}): Availability => ({ slots: [], preferenceMatched: false, reason, calendar: null, ownerTimezone: null, checkedAt: now, ...extra });
  const profile = await db.schedulingProfile.findUnique({ where: { workspaceId_userId: { workspaceId: req.workspaceId, userId: req.ownerUserId } } });
  const user = await db.user.findUnique({ where: { id: req.ownerUserId }, select: { name: true } });
  if (!profile) return empty(`${user?.name ?? 'The owner'} has not set when they can be booked — Meetings → Setup`);
  const cal = await calendarFor(db, req.workspaceId, profile);
  if (!cal) return empty('No calendar is connected — connect Google Calendar (or the test calendar) in Integrations', { ownerTimezone: profile.timezone });
  const calendar = { integrationId: cal.integration.id, provider: cal.integration.provider, calendarId: cal.calendarId };
  if (!profile.acceptsMeetings) return empty(`${user?.name ?? 'The owner'} is not taking meetings right now`, { calendar, ownerTimezone: profile.timezone });
  const from = req.from && req.from > now ? req.from : now;
  const to = new Date(from.getTime() + (req.days ?? 14) * DAY_MS);
  let busy: TimeSlot[];
  let bookedPerDay: Record<string, number>;
  try {
    ({ busy, bookedPerDay } = await busyFor(deps, { workspaceId: req.workspaceId, ownerUserId: req.ownerUserId, integrationId: cal.integration.id, calendarId: cal.calendarId, from, to, exceptMeetingId: req.exceptMeetingId, tz: profile.timezone }));
  } catch (err) {
    return empty(`The calendar could not be read (${describeError(err).slice(0, 160)}) — no times offered`, { calendar, ownerTimezone: profile.timezone });
  }
  const r = findSlots({ rules: profile, durationMinutes: req.durationMinutes, bufferMinutes: req.bufferMinutes, from, to, busy, bookedPerDay, prospectTimezone: req.prospectTimezone, preference: req.preference, now, limit: req.limit ?? 3 });
  return { ...r, calendar, ownerTimezone: profile.timezone, checkedAt: now };
}

// ───────────────────────────── context ─────────────────────────────

/** What the deal (or, before a deal exists, the conversation) already knows — for meeting-type gates and the brief. */
async function dealKnowledge(db: Tx | PrismaClient, opportunityId: string | null, conversationContext: unknown) {
  if (opportunityId) {
    const o = await db.opportunity.findFirst({ where: { id: opportunityId }, include: { stage: true, qualification: true } });
    if (o) {
      const answers = await db.qualificationAnswer.findMany({ where: { qualification: { opportunityId: o.id }, supersededAt: null } });
      return {
        stage: o.stage.semantic as StageSemantic,
        status: o.status,
        known: new Set(answers.map((a) => a.key)),
        qualified: o.qualification?.status === 'QUALIFIED',
        answers: answers.map((a) => ({ key: a.key as QualificationKey, value: a.value, quote: a.quote, verified: a.verified })),
      };
    }
  }
  const ctx = (conversationContext ?? {}) as Record<string, { value: string; quote: string }>;
  const answers = QUALIFICATION_KEYS.filter((k) => ctx[k]).map((k) => ({ key: k, value: ctx[k]!.value, quote: ctx[k]!.quote, verified: false }));
  const known = new Set<string>(answers.map((a) => a.key));
  return { stage: null, status: null, known, qualified: qualificationStatus(known) === 'QUALIFIED', answers };
}

async function contactEmail(db: Tx | PrismaClient, workspaceId: string, personId: string | null): Promise<string | null> {
  if (!personId) return null;
  const cp = await db.contactPoint.findFirst({ where: { workspaceId, entityType: 'PERSON', entityId: personId, type: 'EMAIL', archivedAt: null, status: { not: 'INVALID' } }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
  return cp?.normalizedValue ?? null;
}

async function routingFor(db: Tx | PrismaClient, workspaceId: string, rel: { opportunityOwnerId?: string | null; takenOverById?: string | null; assignedToId?: string | null; companyId: string }, requested: string | null | undefined, now: Date) {
  const profiles = await db.schedulingProfile.findMany({ where: { workspaceId } });
  const members = await db.workspaceMember.findMany({ where: { workspaceId, status: 'ACTIVE', userId: { in: profiles.map((p) => p.userId) } }, select: { userId: true, user: { select: { name: true } } } });
  const weekAhead = new Date(now.getTime() + 7 * DAY_MS);
  const load = await db.meeting.groupBy({ by: ['ownerUserId'], where: { workspaceId, status: { in: HOLDS_TIME }, startAt: { gte: now, lt: weekAhead } }, _count: true });
  const lastMeeting = await db.meeting.findFirst({ where: { workspaceId, companyId: rel.companyId, ownerUserId: { not: null }, status: { in: ['BOOKED', 'COMPLETED', 'NO_SHOW'] } }, orderBy: { createdAt: 'desc' }, select: { ownerUserId: true } });
  const candidates = profiles.flatMap((p) => {
    const m = members.find((x) => x.userId === p.userId);
    return m ? [{ userId: p.userId, name: m.user.name, acceptsMeetings: p.acceptsMeetings, unavailableUntil: p.unavailableUntil, upcoming: load.find((l) => l.ownerUserId === p.userId)?._count ?? 0 }] : [];
  });
  const relationship = [
    rel.opportunityOwnerId ? { userId: rel.opportunityOwnerId, why: 'owns the deal' } : null,
    rel.takenOverById ? { userId: rel.takenOverById, why: 'took over the conversation' } : null,
    rel.assignedToId ? { userId: rel.assignedToId, why: 'owns the conversation' } : null,
    lastMeeting?.ownerUserId ? { userId: lastMeeting.ownerUserId, why: 'met them before' } : null,
  ].filter((x): x is { userId: string; why: string } => !!x);
  return routeMeeting({ candidates, relationship, requested, now });
}

// ───────────────────────────── propose ─────────────────────────────

export interface ProposeInput {
  conversationId?: string | null;
  opportunityId?: string | null;
  companyId?: string | null;
  personId?: string | null;
  meetingTypeId?: string | null;
  ownerUserId?: string | null;
  requestText?: string | null;
  requestMessageId?: string | null;
}

/**
 * Meeting intent → meeting type → timezone → routing → real availability (docs/17 §93-98 Scheduling Agent flow, up to
 * the slot proposal). Creates a PROPOSED meeting with genuinely free times — nothing is offered or booked yet. A
 * conversation has at most one meeting being arranged: asking again returns it (with fresh times when it changed).
 */
export async function proposeMeeting(deps: OutreachDeps, ctx: ServiceContext, input: ProposeInput): Promise<Meeting> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const ws = ctx.workspaceId;
  const conv = input.conversationId ? await db.conversation.findFirst({ where: { id: input.conversationId, workspaceId: ws } }) : null;
  if (input.conversationId && !conv) throw new NotFoundError('Conversation not found');
  const opp = input.opportunityId
    ? await db.opportunity.findFirst({ where: { id: input.opportunityId, workspaceId: ws } })
    : conv?.opportunityId
      ? await db.opportunity.findFirst({ where: { id: conv.opportunityId, workspaceId: ws } })
      : null;
  if (input.opportunityId && !opp) throw new NotFoundError('Opportunity not found');
  const conversation = conv ?? (opp?.conversationId ? await db.conversation.findFirst({ where: { id: opp.conversationId, workspaceId: ws } }) : null);
  const companyId = conversation?.companyId ?? opp?.companyId ?? input.companyId;
  if (!companyId) throw new ValidationError('Say who the meeting is with', [{ path: 'companyId', message: 'A conversation, deal or company is required' }]);

  if (conversation) {
    const active = await db.meeting.findFirst({ where: { workspaceId: ws, conversationId: conversation.id, status: { in: SCHEDULING } } });
    if (active) {
      if (input.requestText && !active.pendingStartAt) return refreshSlots(deps, ctx, active.id, { requestText: input.requestText, requestMessageId: input.requestMessageId ?? null });
      return active;
    }
  }

  const company = await db.company.findFirst({ where: { id: companyId, workspaceId: ws } });
  if (!company) throw new NotFoundError('Company not found');
  if (company.status === 'ARCHIVED' || company.mergedIntoId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'The company is archived or merged');
  const personId = input.personId ?? conversation?.personId ?? opp?.primaryPersonId ?? null;
  const person = personId ? await db.person.findFirst({ where: { id: personId, workspaceId: ws } }) : null;
  const email = conversation?.email ?? (await contactEmail(db, ws, person?.id ?? null));

  const knowledge = await dealKnowledge(db, opp?.id ?? null, conversation?.context);
  const types = await meetingTypes(db, ws);
  const hadMeeting = (await db.meeting.count({ where: { workspaceId: ws, companyId, status: 'COMPLETED' } })) > 0;
  let type: MeetingType | null;
  if (input.meetingTypeId) {
    type = types.find((t) => t.id === input.meetingTypeId && t.active) ?? null;
    if (!type) throw new ValidationError('Unknown or inactive meeting type', [{ path: 'meetingTypeId', message: 'Unknown' }]);
    const blocked = meetingTypeBlocked(type.requiredQualification, knowledge);
    if (blocked) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `${type.name} ${blocked}`);
  } else {
    type = recommendMeetingType(types, { stage: knowledge.stage, known: knowledge.known, qualified: knowledge.qualified, hadMeeting });
    if (!type) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'No active meeting type fits this deal yet — check Meetings → Setup');
  }

  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: ws }, select: { defaultTimezone: true } });
  const tz = inferTimezone({ personTimezone: person?.timezone, region: company.region, country: company.country, city: company.city }, workspace.defaultTimezone);
  const route = await routingFor(db, ws, { opportunityOwnerId: opp?.ownerUserId, takenOverById: conversation?.takenOverById, assignedToId: conversation?.assignedToId, companyId }, input.ownerUserId, now);
  const preference = input.requestText ? parseMeetingPreference(input.requestText, now, tz.timezone) : null;
  const availability = route
    ? await findAvailability(deps, { workspaceId: ws, ownerUserId: route.userId, durationMinutes: type.durationMinutes, bufferMinutes: type.bufferMinutes, prospectTimezone: tz.timezone, preference })
    : null;
  const owner = route ? await db.user.findUnique({ where: { id: route.userId }, select: { id: true, name: true, email: true } }) : null;
  const statusReason = !route ? 'Nobody has set when they can be booked — Meetings → Setup' : availability?.reason ?? null;

  try {
    return await db.$transaction(async (tx) => {
      const m = await tx.meeting.create({
        data: {
          workspaceId: ws,
          companyId,
          opportunityId: opp?.id ?? null,
          conversationId: conversation?.id ?? null,
          meetingTypeId: type.id,
          ownerUserId: route?.userId ?? null,
          primaryPersonId: person?.id ?? null,
          title: `${type.name} — ${company.displayName}`.slice(0, 200),
          status: 'PROPOSED',
          timezone: tz.timezone,
          timezoneSource: tz.source,
          timezoneConfidence: tz.confidence,
          ownerTimezone: availability?.ownerTimezone ?? tz.timezone,
          routingReason: route?.reason ?? null,
          requestText: input.requestText?.slice(0, 500) ?? null,
          requestMessageId: input.requestMessageId ?? null,
          preference: preference ? (preference as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
          offeredSlots: (availability?.slots ?? []) as unknown as Prisma.InputJsonValue,
          slotsCheckedAt: availability?.checkedAt ?? null,
          calendarIntegrationId: availability?.calendar?.integrationId ?? null,
          calendarId: availability?.calendar?.calendarId ?? null,
          locationType: type.locationType,
          statusReason,
          createdByType: ctx.actor.type,
          createdById: ctx.actor.id,
        },
      });
      const attendees: Prisma.MeetingAttendeeCreateManyInput[] = [];
      if (person || email) attendees.push({ workspaceId: ws, meetingId: m.id, side: 'EXTERNAL', personId: person?.id ?? null, name: person?.fullName ?? conversation?.contactName ?? email ?? 'Contact', email, role: 'Prospect' });
      if (owner) attendees.push({ workspaceId: ws, meetingId: m.id, side: 'INTERNAL', userId: owner.id, name: owner.name, email: owner.email, role: 'Owner' });
      if (attendees.length) await tx.meetingAttendee.createMany({ data: attendees });
      await change(tx, ctx, m.id, 'PROPOSED', sourceOf(ctx), { reason: [preference ? `Asked for: ${preference.label}` : null, `${availability?.slots.length ?? 0} free time(s) found`, statusReason].filter(Boolean).join(' · ') });
      await writeAudit(tx, ctx, { action: 'meeting.proposed', entityType: 'MEETING', entityId: m.id, after: { companyId, conversationId: conversation?.id ?? null, type: type.key, owner: route?.userId ?? null, slots: availability?.slots.length ?? 0 } });
      await recordEvent(tx, ctx, 'MeetingProposed', m.id, { meetingId: m.id, companyId, conversationId: conversation?.id ?? null, opportunityId: opp?.id ?? null, slots: availability?.slots.length ?? 0, requestedBy: ctx.actor.type });
      return m;
    }, TX);
  } catch (err) {
    // Two replies at once: the partial unique index lets only one meeting be arranged per conversation.
    if (conversation && err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await db.meeting.findFirst({ where: { workspaceId: ws, conversationId: conversation.id, status: { in: SCHEDULING } } });
      if (existing) return existing;
    }
    throw err;
  }
}

/**
 * Find times again (a new day they asked for, another owner or meeting type, or simply stale times). Only while
 * nothing is being booked. New times have to be offered again.
 */
export async function refreshSlots(deps: OutreachDeps, ctx: ServiceContext, meetingId: string, input: { requestText?: string | null; requestMessageId?: string | null; ownerUserId?: string | null; meetingTypeId?: string | null } = {}): Promise<Meeting> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const m = await loadMeeting(db, ctx.workspaceId, meetingId);
  if (!SCHEDULING.includes(m.status) || m.pendingStartAt) throw new BusinessRuleError('INVALID_STATE_TRANSITION', m.pendingStartAt ? 'A booking is already in progress for this meeting' : `This meeting is ${m.status.toLowerCase().replace('_', ' ')}`);
  let type = m.meetingType;
  if (input.meetingTypeId && input.meetingTypeId !== type.id) {
    const t = await db.meetingType.findFirst({ where: { id: input.meetingTypeId, workspaceId: ctx.workspaceId, active: true } });
    if (!t) throw new ValidationError('Unknown or inactive meeting type', [{ path: 'meetingTypeId', message: 'Unknown' }]);
    const conv = m.conversationId ? await db.conversation.findFirst({ where: { id: m.conversationId } }) : null;
    const blocked = meetingTypeBlocked(t.requiredQualification, await dealKnowledge(db, m.opportunityId, conv?.context));
    if (blocked) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `${t.name} ${blocked}`);
    type = t;
  }
  let ownerUserId = m.ownerUserId;
  let routingReason = m.routingReason;
  if (input.ownerUserId !== undefined && input.ownerUserId !== m.ownerUserId) {
    const route = await routingFor(db, ctx.workspaceId, { companyId: m.companyId }, input.ownerUserId, now);
    if (!route || route.userId !== input.ownerUserId) throw new ValidationError('That person has not set when they can be booked', [{ path: 'ownerUserId', message: 'No availability' }]);
    ownerUserId = route.userId;
    routingReason = route.reason;
  } else if (!ownerUserId) {
    const conv = m.conversationId ? await db.conversation.findFirst({ where: { id: m.conversationId } }) : null;
    const opp = m.opportunityId ? await db.opportunity.findFirst({ where: { id: m.opportunityId } }) : null;
    const route = await routingFor(db, ctx.workspaceId, { opportunityOwnerId: opp?.ownerUserId, takenOverById: conv?.takenOverById, assignedToId: conv?.assignedToId, companyId: m.companyId }, null, now);
    ownerUserId = route?.userId ?? null;
    routingReason = route?.reason ?? null;
  }
  const preference = input.requestText ? parseMeetingPreference(input.requestText, now, m.timezone) : ((m.preference as MeetingPreference | null) ?? null);
  const availability = ownerUserId ? await findAvailability(deps, { workspaceId: ctx.workspaceId, ownerUserId, durationMinutes: type.durationMinutes, bufferMinutes: type.bufferMinutes, prospectTimezone: m.timezone, preference, exceptMeetingId: m.id }) : null;
  const owner = ownerUserId ? await db.user.findUnique({ where: { id: ownerUserId }, select: { id: true, name: true, email: true } }) : null;
  const company = await db.company.findUniqueOrThrow({ where: { id: m.companyId }, select: { displayName: true } });
  const sameSlots = JSON.stringify(availability?.slots ?? []) === JSON.stringify(slotsOf(m));

  return db.$transaction(async (tx) => {
    const { count } = await tx.meeting.updateMany({
      where: { id: m.id, version: m.version, pendingStartAt: null },
      data: {
        meetingTypeId: type.id,
        title: `${type.name} — ${company.displayName}`.slice(0, 200),
        locationType: type.locationType,
        ownerUserId,
        routingReason,
        ownerTimezone: availability?.ownerTimezone ?? m.ownerTimezone,
        ...(input.requestText ? { requestText: input.requestText.slice(0, 500), requestMessageId: input.requestMessageId ?? null, preference: preference ? (preference as unknown as Prisma.InputJsonValue) : Prisma.DbNull } : {}),
        offeredSlots: (availability?.slots ?? []) as unknown as Prisma.InputJsonValue,
        slotsCheckedAt: availability?.checkedAt ?? now,
        calendarIntegrationId: availability?.calendar?.integrationId ?? m.calendarIntegrationId,
        calendarId: availability?.calendar?.calendarId ?? m.calendarId,
        statusReason: !ownerUserId ? 'Nobody has set when they can be booked — Meetings → Setup' : availability?.reason ?? null,
        // Different times have to be offered again.
        ...(sameSlots ? {} : { status: 'PROPOSED' as const, offeredAt: null }),
        version: { increment: 1 },
      },
    });
    if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This meeting changed meanwhile — reload');
    if (owner && owner.id !== m.ownerUserId) {
      await tx.meetingAttendee.deleteMany({ where: { meetingId: m.id, side: 'INTERNAL', role: 'Owner' } });
      await tx.meetingAttendee.create({ data: { workspaceId: m.workspaceId, meetingId: m.id, side: 'INTERNAL', userId: owner.id, name: owner.name, email: owner.email, role: 'Owner' } });
    }
    if (!sameSlots) await change(tx, ctx, m.id, 'PROPOSED', sourceOf(ctx), { reason: [preference ? `Asked for: ${preference.label}` : null, `${availability?.slots.length ?? 0} free time(s) found`, availability?.reason].filter(Boolean).join(' · ') });
    return tx.meeting.findUniqueOrThrow({ where: { id: m.id } });
  }, TX);
}

/**
 * The message that offers the free times (a person sends it from the inbox, or edits it first). Times older than 30
 * minutes are checked again first. The meeting then waits for their pick; their reply can book it.
 */
export async function offerSlots(deps: OutreachDeps, ctx: ServiceContext, meetingId: string): Promise<{ text: string; meeting: Meeting }> {
  const now = deps.now?.() ?? new Date();
  let m = await loadMeeting(deps.db, ctx.workspaceId, meetingId);
  if (!SCHEDULING.includes(m.status) || m.pendingStartAt) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Times can only be offered while the meeting is being arranged');
  if (!m.slotsCheckedAt || now.getTime() - m.slotsCheckedAt.getTime() > SLOTS_FRESH_MS || !slotsOf(m).length) {
    await refreshSlots(deps, ctx, m.id);
    m = await loadMeeting(deps.db, ctx.workspaceId, meetingId);
  }
  const slots = slotsOf(m);
  if (!slots.length) throw new BusinessRuleError('INVALID_STATE_TRANSITION', m.statusReason ?? 'No free times to offer');
  const person = m.primaryPersonId ? await deps.db.person.findFirst({ where: { id: m.primaryPersonId }, select: { firstName: true } }) : null;
  const conv = m.conversationId ? await deps.db.conversation.findFirst({ where: { id: m.conversationId }, select: { contactName: true } }) : null;
  const text = offerMessage(slots, m.timezone, { firstName: person?.firstName ?? conv?.contactName?.split(/\s+/)[0] ?? null, meetingName: m.meetingType.name, durationMinutes: m.meetingType.durationMinutes, confirmTimezone: m.timezoneConfidence === 'LOW' });
  const meeting = await deps.db.$transaction(async (tx) => {
    await tx.meeting.update({ where: { id: m.id }, data: { status: 'PENDING_CONFIRMATION', offeredAt: now, statusReason: null, version: { increment: 1 } } });
    await change(tx, ctx, m.id, 'OFFERED', sourceOf(ctx), { reason: slots.map((s) => formatSlot(s.start, m.timezone)).join(' · ') });
    await recordEvent(tx, ctx, 'MeetingSlotsOffered', m.id, { meetingId: m.id, slots: slots.length });
    return tx.meeting.findUniqueOrThrow({ where: { id: m.id } });
  }, TX);
  return { text, meeting };
}

// ───────────────────────────── book ─────────────────────────────

/** Right before asking the calendar: is this time still free? Strict (AI) = every rule; otherwise just no clash. */
async function stillFree(deps: OutreachDeps, m: Meeting & { meetingType: MeetingType }, start: Date, end: Date, strict: boolean, ignoreOwnEvent = false): Promise<boolean> {
  if (!m.ownerUserId || !m.calendarIntegrationId) return false;
  const profile = await deps.db.schedulingProfile.findUnique({ where: { workspaceId_userId: { workspaceId: m.workspaceId, userId: m.ownerUserId } } });
  if (!profile) return false;
  const now = deps.now?.() ?? new Date();
  const from = new Date(start.getTime() - 6 * 3_600_000);
  const to = new Date(end.getTime() + 6 * 3_600_000);
  const { busy, bookedPerDay } = await busyFor(deps, { workspaceId: m.workspaceId, ownerUserId: m.ownerUserId, integrationId: m.calendarIntegrationId, calendarId: m.calendarId ?? profile.calendarId, from, to, exceptMeetingId: m.id, tz: profile.timezone });
  const others = ignoreOwnEvent && m.startAt && m.endAt ? busy.filter((b) => !(Date.parse(b.start) === m.startAt!.getTime() && Date.parse(b.end) === m.endAt!.getTime())) : busy;
  if (!strict) return !others.some((b) => Date.parse(b.start) < end.getTime() && Date.parse(b.end) > start.getTime());
  const r = findSlots({ rules: profile, durationMinutes: m.meetingType.durationMinutes, bufferMinutes: m.meetingType.bufferMinutes, from: start, to: end, busy: others, bookedPerDay, prospectTimezone: m.timezone, now, limit: 1 });
  return r.slots.some((s) => Date.parse(s.start) === start.getTime());
}

/**
 * Book a slot (docs/17 §93-98: final recheck → book). The time is checked against the calendar again, a calendar.book
 * external action is requested and the Policy Engine decides (a person: meeting.book; the Scheduling Agent: its
 * authority, autonomy L3, the meeting type allowing AI booking). The meeting is BOOKED only when the calendar confirms
 * (settleMeetingAction). A taken slot is never double-booked: new free times are found instead.
 */
export async function requestBooking(deps: OutreachDeps, ctx: ServiceContext, meetingId: string, input: { start: string; agent?: boolean }): Promise<Meeting> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const m = await loadMeeting(db, ctx.workspaceId, meetingId);
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime())) throw new ValidationError('Pick a valid time', [{ path: 'start', message: 'ISO date-time' }]);
  if (m.pendingStartAt) {
    if (m.pendingStartAt.getTime() === start.getTime()) return m; // the same click twice
    throw new ConflictError('ALREADY_EXISTS', 'A booking is already in progress for this meeting');
  }
  if (!SCHEDULING.includes(m.status)) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `This meeting is ${m.status.toLowerCase().replace('_', ' ')} — ${m.status === 'BOOKED' ? 'reschedule it instead' : 'arrange a new one'}`);
  if (start.getTime() <= now.getTime()) throw new ValidationError('That time has passed', [{ path: 'start', message: 'Future time' }]);
  if (!m.ownerUserId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Nobody owns this meeting yet — set up availability first');
  const end = new Date(start.getTime() + m.meetingType.durationMinutes * 60_000);
  const conv = m.conversationId ? await db.conversation.findFirst({ where: { id: m.conversationId } }) : null;
  const blocked = meetingTypeBlocked(m.meetingType.requiredQualification, await dealKnowledge(db, m.opportunityId, conv?.context));
  if (blocked) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `${m.meetingType.name} ${blocked}`);
  if (input.agent) {
    if (!m.meetingType.aiBookingAllowed) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `${m.meetingType.name} is booked by a person, not the AI`);
    if (!(await agentDefinition(db, ctx.workspaceId, 'SCHEDULING')).enabled) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'The Scheduling Agent is turned off');
    if (!slotsOf(m).some((s) => Date.parse(s.start) === start.getTime())) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'The AI only books a time that was offered');
    if (conv?.mode === 'HUMAN') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'A person took this conversation over — they book');
  }
  // The calendar may not have been resolved yet (availability set up after the meeting was proposed).
  if (!m.calendarIntegrationId) await refreshSlots(deps, ctx, m.id);
  const fresh = await loadMeeting(db, ctx.workspaceId, meetingId);
  if (!fresh.calendarIntegrationId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', fresh.statusReason ?? 'No calendar is connected');
  const integration = await db.integration.findFirstOrThrow({ where: { id: fresh.calendarIntegrationId, workspaceId: ctx.workspaceId } });
  const attendees = await db.meetingAttendee.findMany({ where: { meetingId: m.id } });
  const external = [...new Set(attendees.filter((a) => a.side === 'EXTERNAL' && a.email).map((a) => a.email!.toLowerCase()))];
  if (!external.length) throw new ValidationError('There is no email address for the person to invite', [{ path: 'attendees', message: 'Add an email to the contact' }]);

  let free: boolean;
  try {
    free = await stillFree(deps, fresh, start, end, !!input.agent);
  } catch (err) {
    throw new BusinessRuleError('INVALID_STATE_TRANSITION', `The calendar could not be checked (${describeError(err).slice(0, 120)}) — nothing was booked`);
  }
  if (!free) {
    await refreshSlots(deps, ctx, m.id).catch(() => null);
    throw new ConflictError('SLOT_UNAVAILABLE', 'That time is no longer free — new times are shown');
  }

  // Our own double-booking guard: one owner, one booking decision at a time, nothing overlapping in flight.
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-owner:${m.ownerUserId}`}))`;
    const clash = await tx.meeting.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        ownerUserId: m.ownerUserId,
        id: { not: m.id },
        OR: [
          { status: { in: HOLDS_TIME }, startAt: { lt: end }, endAt: { gt: start } },
          { pendingStartAt: { lt: end }, pendingEndAt: { gt: start } },
        ],
      },
      select: { id: true },
    });
    if (clash) throw new ConflictError('SLOT_UNAVAILABLE', 'Another meeting was just booked at that time — pick another slot');
    const { count } = await tx.meeting.updateMany({ where: { id: m.id, pendingStartAt: null, status: { in: SCHEDULING } }, data: { status: 'PENDING_CONFIRMATION', pendingStartAt: start, pendingEndAt: end, statusReason: 'Booking with the calendar…', version: { increment: 1 } } });
    if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This meeting changed meanwhile — reload');
    await change(tx, ctx, m.id, 'BOOKING_REQUESTED', sourceOf(ctx), { toStartAt: start, toEndAt: end });
  }, TX);

  const company = await db.company.findUniqueOrThrow({ where: { id: m.companyId }, select: { displayName: true } });
  const owner = await db.user.findUnique({ where: { id: m.ownerUserId }, select: { name: true } });
  const payload = {
    meetingId: m.id,
    calendarId: fresh.calendarId ?? 'primary',
    title: `${m.meetingType.name}: ${company.displayName} × ${owner?.name ?? 'us'}`.slice(0, 300),
    description: [m.meetingType.description, m.requestText ? `They asked: “${m.requestText.slice(0, 200)}”` : null, 'Booked by Rank High Lead.'].filter(Boolean).join('\n\n'),
    start: start.toISOString(),
    end: end.toISOString(),
    timezone: m.timezone,
    attendees: external,
    videoLink: m.locationType === 'VIDEO',
  };
  let action: ExternalAction;
  try {
    ({ action } = await requestExternalAction(db, ctx, {
      actionType: 'calendar.book',
      provider: integration.provider,
      providerAccountId: integration.id,
      entityType: m.primaryPersonId ? 'PERSON' : 'COMPANY',
      entityId: m.primaryPersonId ?? m.companyId,
      idempotencyKey: meetingKeys.book(m.id, start.toISOString()),
      payload,
      ...(input.agent ? { requestedByAgent: 'SCHEDULING' } : {}),
    }));
  } catch (err) {
    await db.meeting.updateMany({ where: { id: m.id, pendingStartAt: start }, data: { status: m.status, pendingStartAt: null, pendingEndAt: null, statusReason: `Not booked: ${describeError(err).slice(0, 200)}` } });
    throw err;
  }
  await db.$transaction(async (tx) => {
    await tx.meeting.update({ where: { id: m.id }, data: { externalActionId: action.id } });
    await recordEvent(tx, ctx, 'MeetingBookingRequested', m.id, { meetingId: m.id, externalActionId: action.id, start: start.toISOString(), requestedBy: input.agent ? 'AI' : ctx.actor.type });
  }, TX);
  await settleMeetingAction(db, action.id, now);
  return db.meeting.findUniqueOrThrow({ where: { id: m.id } });
}

/**
 * A meeting a person booked elsewhere (on the phone, in their own calendar) — the "explicitly authorized manual
 * confirmation" of docs/17 §93-98. Recorded as BOOKED via MANUAL, with the person's note.
 */
export async function confirmManually(db: PrismaClient, ctx: ServiceContext, meetingId: string, input: { start: Date; end?: Date | null; note: string; meetingUrl?: string | null }) {
  if (!input.note.trim()) throw new ValidationError('Say how it was booked (phone call, their calendar…)', [{ path: 'note', message: 'Required' }]);
  if (ctx.actor.type !== 'HUMAN') throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only a person can record a meeting booked elsewhere');
  return db.$transaction(async (tx) => {
    const m = await loadMeeting(tx, ctx.workspaceId, meetingId);
    if (!SCHEDULING.includes(m.status) || m.pendingStartAt) throw new BusinessRuleError('INVALID_STATE_TRANSITION', m.pendingStartAt ? 'A calendar booking is in progress — wait for it or cancel it first' : `This meeting is ${m.status.toLowerCase().replace('_', ' ')}`);
    const end = input.end ?? new Date(input.start.getTime() + m.meetingType.durationMinutes * 60_000);
    if (end <= input.start) throw new ValidationError('The meeting must end after it starts', [{ path: 'end', message: 'After the start' }]);
    await applyBookedTx(tx, ctx, m, { start: input.start, end, via: 'MANUAL', meetingUrl: input.meetingUrl ?? null, reason: input.note.trim() }, new Date());
    return { ok: true };
  }, TX);
}

/** BOOKED, and everything that follows from it — one transaction (screen #8 §11 "then automatically"). */
async function applyBookedTx(tx: Tx, ctx: ServiceContext, m: Meeting & { meetingType: MeetingType }, b: { start: Date; end: Date; via: 'PROVIDER' | 'MANUAL'; eventId?: string | null; etag?: string | null; meetingUrl?: string | null; calendarId?: string | null; reason?: string | null }, now: Date) {
  await tx.meeting.update({
    where: { id: m.id },
    data: {
      status: 'BOOKED',
      startAt: b.start,
      endAt: b.end,
      pendingStartAt: null,
      pendingEndAt: null,
      bookedVia: b.via,
      bookedAt: now,
      providerEventId: b.eventId ?? null,
      providerEtag: b.etag ?? null,
      meetingUrl: b.meetingUrl ?? m.meetingUrl,
      calendarId: b.calendarId ?? m.calendarId,
      lastSyncedAt: b.via === 'PROVIDER' ? now : null,
      statusReason: null,
      version: { increment: 1 },
    },
  });
  await change(tx, ctx, m.id, 'BOOKED', b.via === 'MANUAL' ? 'TEAM' : 'PROVIDER', { toStartAt: b.start, toEndAt: b.end, reason: b.reason ?? (b.via === 'PROVIDER' ? 'Confirmed by the calendar' : null) });
  await writeAudit(tx, ctx, { action: 'meeting.booked', entityType: 'MEETING', entityId: m.id, after: { start: b.start.toISOString(), via: b.via, eventId: b.eventId ?? null } });
  await recordEvent(tx, ctx, 'MeetingBooked', m.id, { meetingId: m.id, companyId: m.companyId, opportunityId: m.opportunityId, start: b.start.toISOString(), end: b.end.toISOString(), via: b.via });

  // The conversation: the meeting request is handled.
  if (m.conversationId) {
    const c = await tx.conversation.findFirst({ where: { id: m.conversationId } });
    if (c && c.stage !== 'SUPPRESSED' && c.stage !== 'CLOSED') {
      const meetingOnly = !!c.escalationReason && /meeting/i.test(c.escalationReason);
      const needsHuman = meetingOnly ? false : c.needsHuman;
      const waitingOn = meetingOnly && c.waitingOn === 'US' ? ('NOBODY' as const) : c.waitingOn;
      const state = { stage: 'MEETING_BOOKED' as const, mode: c.mode, waitingOn, needsHuman, primaryIntent: c.primaryIntent, snoozedUntil: c.snoozedUntil, resolvedAt: c.resolvedAt };
      const { priority, reasons } = priorityOf({ primaryIntent: c.primaryIntent, needsHuman, riskFlags: [], waitingOn, stage: state.stage });
      await tx.conversation.update({ where: { id: c.id }, data: { ...state, category: categorize(state, now), escalationReason: needsHuman ? c.escalationReason : null, priority, priorityReasons: reasons, version: { increment: 1 } } });
    }
  }

  // The deal: a booked meeting is commercial evidence (docs/17 §87-92) — link or create it, then move to Meeting if the
  // stage's requirements are met.
  let opportunityId = m.opportunityId;
  if (!opportunityId && m.conversationId) opportunityId = (await tx.conversation.findFirst({ where: { id: m.conversationId }, select: { opportunityId: true } }))?.opportunityId ?? null;
  if (opportunityId && !(await tx.opportunity.findFirst({ where: { id: opportunityId, status: 'OPEN' }, select: { id: true } }))) opportunityId = null;
  if (!opportunityId) {
    const open = await tx.opportunity.findMany({ where: { workspaceId: m.workspaceId, companyId: m.companyId, status: 'OPEN' }, select: { id: true }, take: 2 });
    if (open.length === 1) opportunityId = open[0]!.id;
  }
  if (!opportunityId) {
    const company = await tx.company.findUniqueOrThrow({ where: { id: m.companyId }, select: { displayName: true } });
    const conv = m.conversationId ? await tx.conversation.findFirst({ where: { id: m.conversationId } }) : null;
    const campaign = conv?.campaignId ? await tx.campaign.findUnique({ where: { id: conv.campaignId }, select: { offer: true } }) : null;
    const service = shortOffer(campaign?.offer);
    const o = await createOpportunityTx(tx, system(m.workspaceId), {
      companyId: m.companyId,
      name: `${company.displayName}${service ? ` — ${service}` : ''}`,
      service,
      conversationId: conv?.id ?? null,
      primaryPersonId: m.primaryPersonId,
      ownerUserId: m.ownerUserId,
      source: conv ? 'CONVERSATION' : 'MANUAL',
      originReason: `A ${m.meetingType.name.toLowerCase()} was booked`,
      originQuote: m.requestText,
    }, now);
    opportunityId = o.id;
  }
  if (opportunityId !== m.opportunityId) await tx.meeting.update({ where: { id: m.id }, data: { opportunityId } });
  await tx.opportunity.update({ where: { id: opportunityId }, data: { lastActivityAt: now } });
  await advanceStageTx(tx, system(m.workspaceId), opportunityId, 'MEETING', `${m.meetingType.name} booked for ${formatSlot(b.start, m.ownerTimezone)}`);

  // Cold outreach to the company stops — they are talking to us now (screen #8 §11).
  const live = await tx.campaignEnrollment.findMany({ where: { workspaceId: m.workspaceId, companyId: m.companyId, status: { in: LIVE_ENROLLMENT } }, select: { id: true, campaignId: true } });
  await cancelPendingMessages(tx, ctx, live.map((e) => e.id), 'Meeting booked');
  for (const e of live) {
    await tx.campaignEnrollment.update({ where: { id: e.id }, data: { status: 'REMOVED', statusReason: 'Meeting booked', nextStepDueAt: null } });
    await recordEvent(tx, ctx, 'EnrollmentRemoved', e.id, { enrollmentId: e.id, campaignId: e.campaignId, reason: 'Meeting booked' });
  }

  if (m.meetingType.briefEnabled) await generateBriefTx(tx, m.workspaceId, m.id, now);
}

// ───────────────────────────── calendar results ─────────────────────────────

/**
 * Meeting bookkeeping when its calendar action changes state (runs with the action-settled job; other actions are
 * ignored). Booked only on SUCCEEDED; a refused or failed booking frees the time and asks for new times.
 */
export async function settleMeetingAction(db: PrismaClient, externalActionId: string, now = new Date()): Promise<string> {
  const action = await db.externalAction.findUnique({ where: { id: externalActionId } });
  if (!action || !(CALENDAR_ACTIONS as readonly string[]).includes(action.actionType)) return 'NOT_MEETING';
  const meetingId = (action.payload as { meetingId?: string }).meetingId;
  const m = meetingId ? await db.meeting.findFirst({ where: { id: meetingId, workspaceId: action.workspaceId }, include: { meetingType: true } }) : null;
  if (!m) return 'NOT_FOUND';
  if (m.externalActionId && m.externalActionId !== action.id) return 'STALE';
  const ctx = system(m.workspaceId);
  const meta = (action.responseMeta ?? {}) as { eventId?: string; etag?: string; meetingUrl?: string; calendarId?: string; start?: string; end?: string };
  const failed = action.status === 'BLOCKED' || action.status === 'FAILED' || action.status === 'CANCELLED';
  const waitingText =
    action.status === 'WAITING_APPROVAL'
      ? 'Waiting for approval (AI Control Center → Approvals)'
      : action.status === 'WAITING'
        ? `Waiting: ${action.statusReason ?? 'outside the allowed hours'}`
        : action.status === 'UNKNOWN_OUTCOME'
          ? 'Checking with the calendar whether it was booked'
          : 'Booking with the calendar…';

  return db.$transaction(async (tx) => {
    const cur = await tx.meeting.findUniqueOrThrow({ where: { id: m.id }, include: { meetingType: true } });
    switch (action.actionType) {
      case 'calendar.book': {
        const payload = action.payload as { start: string; end: string; calendarId: string };
        if (action.status === 'SUCCEEDED') {
          if (cur.status === 'BOOKED' && cur.providerEventId === action.responseRef) return 'UNCHANGED';
          if (cur.status === 'CANCELLED') return 'CANCELLED_MEANWHILE';
          await applyBookedTx(tx, ctx, cur, { start: new Date(meta.start ?? payload.start), end: new Date(meta.end ?? payload.end), via: 'PROVIDER', eventId: action.responseRef ?? meta.eventId ?? null, etag: meta.etag ?? null, meetingUrl: meta.meetingUrl ?? null, calendarId: meta.calendarId ?? payload.calendarId }, now);
          return 'BOOKED';
        }
        if (failed) {
          if (!cur.pendingStartAt) return 'UNCHANGED';
          const reason = action.statusReason ?? action.status.toLowerCase();
          const remaining = slotsOf(cur).filter((s) => Date.parse(s.start) !== cur.pendingStartAt!.getTime());
          await tx.meeting.update({ where: { id: cur.id }, data: { status: 'PROPOSED', pendingStartAt: null, pendingEndAt: null, offeredAt: null, offeredSlots: remaining as unknown as Prisma.InputJsonValue, statusReason: `Not booked: ${reason}`.slice(0, 300), version: { increment: 1 } } });
          await change(tx, ctx, cur.id, 'BOOKING_FAILED', 'SYSTEM', { toStartAt: cur.pendingStartAt, reason });
          await recordEvent(tx, ctx, 'MeetingBookingFailed', cur.id, { meetingId: cur.id, reason: reason.slice(0, 300) });
          if (cur.conversationId) await escalateConversationTx(tx, ctx, cur.conversationId, `The meeting was not booked (${reason.slice(0, 120)}) — offer new times`);
          return 'NOT_BOOKED';
        }
        if (cur.statusReason !== waitingText) await tx.meeting.update({ where: { id: cur.id }, data: { statusReason: waitingText } });
        return action.status;
      }
      case 'calendar.update': {
        if (action.status === 'SUCCEEDED') {
          if (cur.status !== 'RESCHEDULING' || !cur.pendingStartAt) return 'UNCHANGED';
          const from = cur.startAt;
          await tx.meeting.update({ where: { id: cur.id }, data: { status: 'BOOKED', startAt: cur.pendingStartAt, endAt: cur.pendingEndAt, pendingStartAt: null, pendingEndAt: null, providerEtag: meta.etag ?? cur.providerEtag, lastSyncedAt: now, statusReason: null, version: { increment: 1 } } });
          await change(tx, ctx, cur.id, 'RESCHEDULED', 'PROVIDER', { fromStartAt: from, toStartAt: cur.pendingStartAt, toEndAt: cur.pendingEndAt, reason: 'Confirmed by the calendar' });
          await recordEvent(tx, ctx, 'MeetingRescheduled', cur.id, { meetingId: cur.id, from: from?.toISOString() ?? null, to: cur.pendingStartAt.toISOString(), source: 'TEAM' });
          if (cur.opportunityId) await tx.opportunity.updateMany({ where: { id: cur.opportunityId, status: 'OPEN' }, data: { lastActivityAt: now } });
          if (cur.meetingType.briefEnabled) await generateBriefTx(tx, cur.workspaceId, cur.id, now);
          return 'RESCHEDULED';
        }
        if (failed) {
          if (cur.status !== 'RESCHEDULING') return 'UNCHANGED';
          const reason = action.statusReason ?? action.status.toLowerCase();
          await tx.meeting.update({ where: { id: cur.id }, data: { status: 'BOOKED', pendingStartAt: null, pendingEndAt: null, statusReason: `Not moved (${reason}) — the old time stands`.slice(0, 300), version: { increment: 1 } } });
          await change(tx, ctx, cur.id, 'BOOKING_FAILED', 'SYSTEM', { toStartAt: cur.pendingStartAt, reason: `Move not confirmed: ${reason}` });
          return 'NOT_MOVED';
        }
        if (cur.statusReason !== waitingText) await tx.meeting.update({ where: { id: cur.id }, data: { statusReason: waitingText.replace('Booking', 'Moving') } });
        return action.status;
      }
      default: {
        // calendar.cancel — the meeting is already CANCELLED in our records; this is about the calendar event.
        if (action.status === 'SUCCEEDED') {
          await tx.meeting.update({ where: { id: cur.id }, data: { statusReason: null, lastSyncedAt: now } });
          return 'EVENT_REMOVED';
        }
        if (failed) {
          await tx.meeting.update({ where: { id: cur.id }, data: { statusReason: `The calendar event may still exist (${(action.statusReason ?? action.status).slice(0, 120)}) — remove it in the calendar` } });
          return 'EVENT_NOT_REMOVED';
        }
        return action.status;
      }
    }
  }, TX);
}

async function escalateConversationTx(tx: Tx, ctx: ServiceContext, conversationId: string, reason: string, stage?: 'ENGAGED') {
  const c = await tx.conversation.findFirst({ where: { id: conversationId } });
  if (!c || c.stage === 'SUPPRESSED' || c.stage === 'CLOSED') return;
  const state = { stage: stage ?? c.stage, mode: c.mode, waitingOn: 'US' as const, needsHuman: true, primaryIntent: c.primaryIntent, snoozedUntil: c.snoozedUntil, resolvedAt: c.resolvedAt };
  const { priority, reasons } = priorityOf({ primaryIntent: c.primaryIntent, needsHuman: true, riskFlags: [], waitingOn: 'US', stage: state.stage });
  await tx.conversation.update({ where: { id: c.id }, data: { ...state, category: categorize(state), escalationReason: reason.slice(0, 300), priority, priorityReasons: reasons, version: { increment: 1 } } });
  if (!c.needsHuman) await recordEvent(tx, ctx, 'ConversationEscalated', c.id, { conversationId: c.id, reason: reason.slice(0, 300) });
}

// ───────────────────────────── reschedule / cancel ─────────────────────────────

/**
 * Move a booked meeting (screen #8 §14): the new time is checked, the calendar event is moved through a calendar.update
 * action, and the old time stands until the calendar confirms — never two meetings. A meeting recorded by hand is
 * moved directly.
 */
export async function rescheduleMeeting(deps: OutreachDeps, ctx: ServiceContext, meetingId: string, input: { start: string; reason: string }): Promise<Meeting> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  if (!input.reason.trim()) throw new ValidationError('Say why it moves', [{ path: 'reason', message: 'Required' }]);
  const m = await loadMeeting(db, ctx.workspaceId, meetingId);
  if (m.status !== 'BOOKED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', m.status === 'RESCHEDULING' ? 'It is already being moved' : 'Only a booked meeting can be moved');
  const start = new Date(input.start);
  if (Number.isNaN(start.getTime()) || start <= now) throw new ValidationError('Pick a future time', [{ path: 'start', message: 'Future time' }]);
  const end = new Date(start.getTime() + (m.endAt && m.startAt ? m.endAt.getTime() - m.startAt.getTime() : m.meetingType.durationMinutes * 60_000));

  if (m.bookedVia !== 'PROVIDER' || !m.providerEventId || !m.calendarIntegrationId) {
    await db.$transaction(async (tx) => {
      await tx.meeting.update({ where: { id: m.id }, data: { startAt: start, endAt: end, statusReason: null, version: { increment: 1 } } });
      await change(tx, ctx, m.id, 'RESCHEDULED', sourceOf(ctx), { fromStartAt: m.startAt, toStartAt: start, toEndAt: end, reason: input.reason.trim() });
      await recordEvent(tx, ctx, 'MeetingRescheduled', m.id, { meetingId: m.id, from: m.startAt?.toISOString() ?? null, to: start.toISOString(), source: sourceOf(ctx) });
    }, TX);
    return db.meeting.findUniqueOrThrow({ where: { id: m.id } });
  }

  let free: boolean;
  try {
    free = await stillFree(deps, m, start, end, false, true);
  } catch (err) {
    throw new BusinessRuleError('INVALID_STATE_TRANSITION', `The calendar could not be checked (${describeError(err).slice(0, 120)}) — nothing was moved`);
  }
  if (!free) throw new ConflictError('SLOT_UNAVAILABLE', 'That time is not free in the calendar — pick another');
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`meeting-owner:${m.ownerUserId}`}))`;
    const clash = await tx.meeting.findFirst({ where: { workspaceId: ctx.workspaceId, ownerUserId: m.ownerUserId, id: { not: m.id }, OR: [{ status: { in: HOLDS_TIME }, startAt: { lt: end }, endAt: { gt: start } }, { pendingStartAt: { lt: end }, pendingEndAt: { gt: start } }] }, select: { id: true } });
    if (clash) throw new ConflictError('SLOT_UNAVAILABLE', 'Another meeting is booked at that time — pick another');
    const { count } = await tx.meeting.updateMany({ where: { id: m.id, status: 'BOOKED', version: m.version }, data: { status: 'RESCHEDULING', pendingStartAt: start, pendingEndAt: end, statusReason: 'Moving it in the calendar…', version: { increment: 1 } } });
    if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This meeting changed meanwhile — reload');
    await change(tx, ctx, m.id, 'RESCHEDULE_REQUESTED', sourceOf(ctx), { fromStartAt: m.startAt, toStartAt: start, toEndAt: end, reason: input.reason.trim() });
  }, TX);
  const integration = await db.integration.findFirstOrThrow({ where: { id: m.calendarIntegrationId, workspaceId: ctx.workspaceId } });
  const attendees = (await db.meetingAttendee.findMany({ where: { meetingId: m.id, side: 'EXTERNAL' } })).map((a) => a.email).filter((e): e is string => !!e);
  let action: ExternalAction;
  try {
    ({ action } = await requestExternalAction(db, ctx, {
      actionType: 'calendar.update',
      provider: integration.provider,
      providerAccountId: integration.id,
      entityType: m.primaryPersonId ? 'PERSON' : 'COMPANY',
      entityId: m.primaryPersonId ?? m.companyId,
      idempotencyKey: meetingKeys.move(m.id, start.toISOString()),
      payload: { meetingId: m.id, calendarId: m.calendarId ?? 'primary', eventId: m.providerEventId, start: start.toISOString(), end: end.toISOString(), attendees: [...new Set(attendees)] },
    }));
  } catch (err) {
    await db.meeting.updateMany({ where: { id: m.id, status: 'RESCHEDULING' }, data: { status: 'BOOKED', pendingStartAt: null, pendingEndAt: null, statusReason: `Not moved: ${describeError(err).slice(0, 200)}` } });
    throw err;
  }
  await db.$transaction(async (tx) => {
    await tx.meeting.update({ where: { id: m.id }, data: { externalActionId: action.id } });
    await recordEvent(tx, ctx, 'MeetingRescheduleRequested', m.id, { meetingId: m.id, externalActionId: action.id, from: m.startAt?.toISOString() ?? null, to: start.toISOString() });
  }, TX);
  await settleMeetingAction(db, action.id, now);
  return db.meeting.findUniqueOrThrow({ where: { id: m.id } });
}

/**
 * Cancel (screen #8 §15, docs/09: a cancellation is not a lost deal). A booking still waiting is withdrawn; a calendar
 * event is removed through a calendar.cancel action (which stays possible even when outbound is stopped).
 */
export async function cancelMeeting(db: PrismaClient, ctx: ServiceContext, meetingId: string, input: { reason: string; source: 'PROSPECT' | 'TEAM' | 'SYSTEM' | 'PROVIDER' | 'MANUAL' }): Promise<Meeting> {
  if (!input.reason.trim()) throw new ValidationError('Say why it is cancelled', [{ path: 'reason', message: 'Required' }]);
  const now = new Date();
  const m = await loadMeeting(db, ctx.workspaceId, meetingId);
  if (!['PROPOSED', 'PENDING_CONFIRMATION', 'BOOKED', 'RESCHEDULING'].includes(m.status)) throw new BusinessRuleError('INVALID_STATE_TRANSITION', `This meeting is already ${m.status.toLowerCase().replace('_', ' ')}`);
  const pending = m.externalActionId ? await db.externalAction.findUnique({ where: { id: m.externalActionId } }) : null;
  if (pending && IN_FLIGHT_ACTION.includes(pending.status)) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'The calendar is being updated right now — try again in a minute');

  await db.$transaction(async (tx) => {
    if (pending && (CANCELLABLE_ACTION as readonly string[]).includes(pending.status)) {
      const { count } = await tx.externalAction.updateMany({ where: { id: pending.id, status: { in: [...CANCELLABLE_ACTION] } }, data: { status: 'CANCELLED', statusReason: 'The meeting was cancelled', version: { increment: 1 } } });
      if (count === 1) {
        await tx.approvalRequest.updateMany({ where: { externalActionId: pending.id, status: 'PENDING' }, data: { status: 'CANCELLED', decidedAt: now, decisionNote: 'The meeting was cancelled' } });
        await recordEvent(tx, ctx, 'ExternalActionCancelled', pending.id, { externalActionId: pending.id, actionType: pending.actionType, reason: 'The meeting was cancelled' });
      }
    }
    const { count } = await tx.meeting.updateMany({
      where: { id: m.id, version: m.version },
      data: { status: 'CANCELLED', pendingStartAt: null, pendingEndAt: null, cancelSource: input.source, cancelReason: input.reason.trim().slice(0, 500), cancelledAt: now, statusReason: null, version: { increment: 1 } },
    });
    if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This meeting changed meanwhile — reload');
    await change(tx, ctx, m.id, 'CANCELLED', input.source, { fromStartAt: m.startAt, reason: input.reason.trim() });
    await writeAudit(tx, ctx, { action: 'meeting.cancelled', entityType: 'MEETING', entityId: m.id, before: { status: m.status }, after: { status: 'CANCELLED', source: input.source }, reason: input.reason });
    await recordEvent(tx, ctx, 'MeetingCancelled', m.id, { meetingId: m.id, source: input.source, reason: input.reason.trim().slice(0, 300) });
    if (m.conversationId) {
      const c = await tx.conversation.findFirst({ where: { id: m.conversationId } });
      if (c && (c.stage === 'MEETING_BOOKED' || c.stage === 'MEETING_REQUESTED')) {
        if (input.source === 'PROSPECT' || input.source === 'PROVIDER') await escalateConversationTx(tx, ctx, c.id, 'The meeting was cancelled — decide whether to offer new times', 'ENGAGED');
        else {
          const state = { stage: 'ENGAGED' as const, mode: c.mode, waitingOn: c.waitingOn, needsHuman: c.needsHuman, primaryIntent: c.primaryIntent, snoozedUntil: c.snoozedUntil, resolvedAt: c.resolvedAt };
          await tx.conversation.update({ where: { id: c.id }, data: { stage: 'ENGAGED', category: categorize(state, now), version: { increment: 1 } } });
        }
      }
    }
    if (m.opportunityId) await tx.opportunity.updateMany({ where: { id: m.opportunityId, status: 'OPEN' }, data: { lastActivityAt: now } });
  }, TX);

  // Remove the calendar event (the invitation is withdrawn by the calendar).
  if (m.providerEventId && m.calendarIntegrationId && m.bookedVia === 'PROVIDER' && input.source !== 'PROVIDER') {
    const integration = await db.integration.findFirst({ where: { id: m.calendarIntegrationId, workspaceId: ctx.workspaceId } });
    if (integration) {
      const { action } = await requestExternalAction(db, ctx, {
        actionType: 'calendar.cancel',
        provider: integration.provider,
        providerAccountId: integration.id,
        entityType: m.primaryPersonId ? 'PERSON' : 'COMPANY',
        entityId: m.primaryPersonId ?? m.companyId,
        idempotencyKey: meetingKeys.cancel(m.id),
        payload: { meetingId: m.id, calendarId: m.calendarId ?? 'primary', eventId: m.providerEventId, reason: input.reason.trim().slice(0, 500) },
      });
      await db.meeting.update({ where: { id: m.id }, data: { externalActionId: action.id } });
      await settleMeetingAction(db, action.id, now);
    }
  }
  return db.meeting.findUniqueOrThrow({ where: { id: m.id } });
}

// ───────────────────────────── outcome ─────────────────────────────

export interface OutcomeInput {
  outcome: MeetingOutcomeType;
  summary?: string | null;
  notes?: string | null;
  nextStep?: string | null;
  attendance?: { attendeeId: string; attended: boolean | null }[];
  applyStage?: boolean;
}

/**
 * What happened (screen #8 §24-29): a structured outcome, notes, the next step and who actually attended. The rules
 * recommend a stage; it is applied only when the person accepts. A no-show is not a lost deal: the conversation comes
 * back to a person to offer a new time, and repeated no-shows show as a risk.
 */
export async function recordOutcome(db: PrismaClient, ctx: ServiceContext, meetingId: string, input: OutcomeInput) {
  const now = new Date();
  const m = await loadMeeting(db, ctx.workspaceId, meetingId);
  if (m.status !== 'BOOKED') throw new BusinessRuleError('INVALID_STATE_TRANSITION', m.status === 'COMPLETED' || m.status === 'NO_SHOW' ? 'The outcome is already recorded' : 'Only a booked meeting can have an outcome');
  if (m.startAt && m.startAt.getTime() > now.getTime() + 15 * 60_000) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'It has not started yet');
  const opp = m.opportunityId ? await db.opportunity.findFirst({ where: { id: m.opportunityId }, include: { stage: true } }) : null;
  const snapshot = opp ? await snapshotOf(db, opp) : null;
  const rec = recommendStage(input.outcome, snapshot);
  const noShow = input.outcome === 'NO_SHOW';

  const noShows = await db.$transaction(async (tx) => {
    await tx.meetingOutcome.create({
      data: { workspaceId: m.workspaceId, meetingId: m.id, outcome: input.outcome, summary: input.summary?.trim().slice(0, 1000) || null, notes: input.notes?.trim().slice(0, 20_000) || null, nextStep: input.nextStep?.trim().slice(0, 300) || null, recommendedStage: rec.stage, recordedById: ctx.actor.id },
    });
    const { count } = await tx.meeting.updateMany({ where: { id: m.id, status: 'BOOKED', version: m.version }, data: { status: noShow ? 'NO_SHOW' : 'COMPLETED', completedAt: now, version: { increment: 1 } } });
    if (count !== 1) throw new ConflictError('VERSION_CONFLICT', 'This meeting changed meanwhile — reload');
    for (const a of input.attendance ?? []) {
      const row = await tx.meetingAttendee.findFirst({ where: { id: a.attendeeId, meetingId: m.id } });
      if (!row) continue;
      await tx.meetingAttendee.update({ where: { id: row.id }, data: { attended: a.attended } });
      // Who really took part updates the deal's stakeholders (screen #8 §33).
      if (a.attended && row.side === 'EXTERNAL' && row.personId && m.opportunityId) await tx.opportunityStakeholder.updateMany({ where: { opportunityId: m.opportunityId, personId: row.personId }, data: { status: 'ENGAGED' } });
    }
    if (noShow) for (const a of await tx.meetingAttendee.findMany({ where: { meetingId: m.id, side: 'EXTERNAL', attended: null } })) await tx.meetingAttendee.update({ where: { id: a.id }, data: { attended: false } });
    await change(tx, ctx, m.id, noShow ? 'NO_SHOW' : 'COMPLETED', sourceOf(ctx), { fromStartAt: m.startAt, reason: input.summary ?? input.nextStep ?? null });
    await writeAudit(tx, ctx, { action: noShow ? 'meeting.no_show' : 'meeting.completed', entityType: 'MEETING', entityId: m.id, after: { outcome: input.outcome, recommendedStage: rec.stage } });
    if (m.opportunityId) await tx.opportunity.updateMany({ where: { id: m.opportunityId, status: 'OPEN' }, data: { lastActivityAt: now, ...(input.nextStep?.trim() ? { nextActionOverride: input.nextStep.trim().slice(0, 300) } : {}) } });
    let count2 = 0;
    if (noShow) {
      count2 = await tx.meeting.count({ where: { workspaceId: m.workspaceId, companyId: m.companyId, status: 'NO_SHOW' } });
      await recordEvent(tx, ctx, 'MeetingNoShow', m.id, { meetingId: m.id, companyId: m.companyId, noShows: count2 });
      if (m.conversationId) await escalateConversationTx(tx, ctx, m.conversationId, `No-show — offer to reschedule${noShowRisk(count2) ? ` (${noShowRisk(count2)})` : ''}`, 'ENGAGED');
    } else {
      await recordEvent(tx, ctx, 'MeetingCompleted', m.id, { meetingId: m.id, outcome: input.outcome, recommendedStage: rec.stage });
    }
    return count2;
  }, TX);

  let stageApplied = false;
  let stageError: string | null = null;
  if (input.applyStage && rec.stage && m.opportunityId && ctx.actor.type === 'HUMAN') {
    try {
      await changeStage(db, ctx, m.opportunityId, rec.stage, `After the ${m.meetingType.name.toLowerCase()}: ${rec.why}`);
      await db.meetingOutcome.update({ where: { meetingId: m.id }, data: { stageApplied: true } });
      stageApplied = true;
    } catch (err) {
      stageError = describeError(err);
    }
  }
  return { outcome: input.outcome, recommendedStage: rec.stage, why: rec.why, stageApplied, stageError, noShows, risk: noShowRisk(noShows) };
}

/** Accept the recommended stage later (from the meeting page). */
export async function applyRecommendedStage(db: PrismaClient, ctx: ServiceContext, meetingId: string) {
  const m = await loadMeeting(db, ctx.workspaceId, meetingId);
  const o = await db.meetingOutcome.findUnique({ where: { meetingId: m.id } });
  if (!o?.recommendedStage || !m.opportunityId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'There is no recommended stage');
  if (o.stageApplied) return { ok: true };
  await changeStage(db, ctx, m.opportunityId, o.recommendedStage, `After the ${m.meetingType.name.toLowerCase()}`);
  await db.meetingOutcome.update({ where: { meetingId: m.id }, data: { stageApplied: true } });
  return { ok: true };
}

// ───────────────────────────── brief ─────────────────────────────

/** Builds the pre-meeting brief from current data and stores it as a new version. */
export async function generateBriefTx(tx: Tx, workspaceId: string, meetingId: string, now = new Date()) {
  const m = await tx.meeting.findFirst({ where: { id: meetingId, workspaceId }, include: { meetingType: true, attendees: true } });
  if (!m) throw new NotFoundError('Meeting not found');
  const company = await tx.company.findUniqueOrThrow({ where: { id: m.companyId } });
  const conv = m.conversationId ? await tx.conversation.findFirst({ where: { id: m.conversationId } }) : null;
  const opp = m.opportunityId ? await tx.opportunity.findFirst({ where: { id: m.opportunityId }, include: { stage: true } }) : null;
  const knowledge = await dealKnowledge(tx, opp?.id ?? null, conv?.context);
  const readings = conv ? await tx.messageClassification.findMany({ where: { conversationId: conv.id }, orderBy: { createdAt: 'desc' }, take: 10, select: { questions: true, objections: true } }) : [];
  const stakeholders = opp ? await tx.opportunityStakeholder.findMany({ where: { opportunityId: opp.id }, select: { name: true, role: true, status: true, personId: true } }) : [];
  const hypotheses = await tx.opportunityHypothesis.findMany({ where: { workspaceId, companyId: m.companyId, status: 'ACTIVE' }, orderBy: { confidence: 'desc' }, take: 4, select: { hypothesis: true, confidence: true } });
  const previous = await tx.meeting.findMany({ where: { workspaceId, companyId: m.companyId, id: { not: m.id }, status: { in: ['COMPLETED', 'NO_SHOW', 'CANCELLED', 'BOOKED'] } }, orderBy: { createdAt: 'desc' }, take: 5, include: { outcome: true } });
  const research = await tx.researchRun.findFirst({ where: { workspaceId, companyId: m.companyId, status: { in: ['COMPLETED', 'PARTIAL'] } }, orderBy: { completedAt: 'desc' }, select: { completedAt: true } });
  const titles = new Map<string, string | null>();
  for (const a of m.attendees.filter((x) => x.personId)) {
    const job = await tx.employment.findFirst({ where: { workspaceId, personId: a.personId!, companyId: m.companyId, isCurrent: true }, select: { title: true } });
    titles.set(a.personId!, job?.title ?? null);
  }
  const input: BriefInput = {
    meeting: { typeKey: m.meetingType.key, typeName: m.meetingType.name, startAt: m.startAt, timezone: m.timezone, timezoneConfidence: m.timezoneConfidence, locationType: m.locationType, meetingUrl: m.meetingUrl },
    company: { name: company.displayName, industry: company.industry, city: company.city, region: company.region, website: company.websiteDomain },
    people: m.attendees.map((a) => ({ name: a.name, title: a.personId ? (titles.get(a.personId) ?? null) : null, side: a.side === 'INTERNAL' ? ('INTERNAL' as const) : ('EXTERNAL' as const), role: a.role })),
    deal: opp ? { name: opp.name, stage: opp.stage.semantic as StageSemantic, service: opp.service, originReason: opp.originReason, originQuote: opp.originQuote } : null,
    known: knowledge.answers,
    questionsAsked: [...new Set(readings.flatMap((r) => r.questions))],
    objections: readings.flatMap((r) => r.objections as { type: string; text: string }[]),
    stakeholders: stakeholders.filter((s) => !m.attendees.some((a) => a.personId && a.personId === s.personId)).map((s) => ({ name: s.name, role: s.role, status: s.status })),
    hypotheses: hypotheses.map((h) => ({ label: h.hypothesis, confidence: h.confidence })),
    previousMeetings: previous.map((p) => ({ title: p.title, at: p.startAt, status: p.status, outcome: p.outcome?.outcome ?? null, nextStep: p.outcome?.nextStep ?? null })),
    conversationSummary: conv?.summary ?? null,
    lastResearchAt: research?.completedAt ?? null,
    now,
  };
  const { content, gaps } = buildBrief(input);
  const last = await tx.meetingBrief.findFirst({ where: { meetingId: m.id }, orderBy: { version: 'desc' }, select: { version: true } });
  const version = (last?.version ?? 0) + 1;
  const brief = await tx.meetingBrief.create({ data: { workspaceId, meetingId: m.id, version, content: content as unknown as Prisma.InputJsonValue, gaps } });
  await recordEvent(tx, system(workspaceId), 'MeetingBriefGenerated', m.id, { meetingId: m.id, version, gaps: gaps.length });
  return brief;
}

export async function generateBrief(db: PrismaClient, ctx: ServiceContext, meetingId: string) {
  await loadMeeting(db, ctx.workspaceId, meetingId);
  return db.$transaction((tx) => generateBriefTx(tx, ctx.workspaceId, meetingId), TX);
}

// ───────────────────────────── from the conversation ─────────────────────────────

export type SchedulingOutcome = 'BOOKING_REQUESTED' | 'PROPOSED' | 'UPDATED' | null;

/**
 * The Scheduling Agent's part of reading a message (screen #8 §3): if times were offered and the prospect picked
 * exactly one, ask to book it (the Policy Engine decides — L3, or a person approves); if they asked to meet, find
 * genuinely free times for what they asked. Anything unclear is left to a person; never a guessed time.
 */
export async function scheduleFromMessage(deps: OutreachDeps, job: { workspaceId: string; conversationId: string; messageId: string; intents: string[]; text: string }): Promise<SchedulingOutcome> {
  const { db } = deps;
  const conv = await db.conversation.findFirst({ where: { id: job.conversationId, workspaceId: job.workspaceId } });
  if (!conv || conv.stage === 'SUPPRESSED' || conv.stage === 'CLOSED') return null;
  const ctx = schedulingAgent(job.workspaceId);
  const active = await db.meeting.findFirst({ where: { workspaceId: job.workspaceId, conversationId: conv.id, status: { in: SCHEDULING } } });
  if (active?.offeredAt && !active.pendingStartAt && conv.mode !== 'HUMAN') {
    const slot = matchChosenSlot(job.text, slotsOf(active), active.timezone);
    if (slot) {
      try {
        await requestBooking(deps, ctx, active.id, { start: slot.start, agent: true });
        // Their message is understood: it picked a time. Unless it also raised something a person must handle (a risk
        // or a question), it doesn't need a person — the booking (or its approval) is the next step.
        const cls = await db.messageClassification.findUnique({ where: { messageId: job.messageId }, select: { riskFlags: true, questions: true } });
        if (cls && !cls.riskFlags.length && !cls.questions.length) {
          await db.$transaction(async (tx) => {
            const c = await tx.conversation.findUniqueOrThrow({ where: { id: conv.id } });
            const state = { stage: 'MEETING_REQUESTED' as const, mode: c.mode, waitingOn: 'NOBODY' as const, needsHuman: false, primaryIntent: c.primaryIntent, snoozedUntil: c.snoozedUntil, resolvedAt: c.resolvedAt };
            const { priority, reasons } = priorityOf({ primaryIntent: 'MEETING_REQUEST', needsHuman: false, riskFlags: [], waitingOn: 'NOBODY', stage: state.stage });
            await tx.conversation.update({ where: { id: c.id }, data: { ...state, category: categorize(state), escalationReason: null, priority, priorityReasons: reasons, version: { increment: 1 } } });
          }, TX);
        }
        return 'BOOKING_REQUESTED';
      } catch (err) {
        await db.$transaction((tx) => escalateConversationTx(tx, system(job.workspaceId), conv.id, `They picked ${formatSlot(slot.start, active.timezone)} but it could not be booked (${describeError(err).slice(0, 120)})`), TX);
        return null;
      }
    }
  }
  if (!job.intents.includes('MEETING_REQUEST')) return null;
  if (active) {
    if (active.pendingStartAt) return null;
    await refreshSlots(deps, ctx, active.id, { requestText: job.text, requestMessageId: job.messageId });
    return 'UPDATED';
  }
  // A meeting already booked: a new request is probably about moving it — a person handles that.
  const booked = await db.meeting.findFirst({ where: { workspaceId: job.workspaceId, conversationId: conv.id, status: { in: HOLDS_TIME }, startAt: { gt: new Date() } }, select: { id: true } });
  if (booked) return null;
  await proposeMeeting(deps, ctx, { conversationId: conv.id, requestText: job.text, requestMessageId: job.messageId });
  return 'PROPOSED';
}

// ───────────────────────────── execution guard ─────────────────────────────

/**
 * Meeting checks right before the calendar is called: a booking runs only while the meeting still waits for exactly
 * that time (not cancelled, not re-arranged), a move only while it is being moved to that time. Then the Policy Engine
 * decides as for any action.
 */
export function withMeetingGuard(inner: Revalidator): Revalidator {
  return async (view, db) => {
    if (view.actionType === 'calendar.book' || view.actionType === 'calendar.update') {
      const p = view.payload as { meetingId?: string; start?: string };
      const m = p.meetingId ? await db.meeting.findFirst({ where: { id: p.meetingId, workspaceId: view.workspaceId }, select: { status: true, pendingStartAt: true } }) : null;
      const want = view.actionType === 'calendar.book' ? 'PENDING_CONFIRMATION' : 'RESCHEDULING';
      if (!m) return { ok: false, status: 'CANCELLED', reason: 'The meeting no longer exists' };
      if (m.status !== want || !m.pendingStartAt || !p.start || m.pendingStartAt.getTime() !== Date.parse(p.start)) return { ok: false, status: 'CANCELLED', reason: 'The meeting changed — this time is no longer wanted' };
    }
    return inner(view, db);
  };
}

// ───────────────────────────── sweep ─────────────────────────────

/**
 * Periodic (job meeting.sweep): reconcile booked meetings with the calendar (an event deleted or moved there is not
 * shown as confirmed forever — docs/12 §34-36), and prepare briefs shortly before meetings start.
 */
export async function meetingSweep(deps: OutreachDeps, opts: { limit?: number; meetingId?: string } = {}): Promise<{ reconciled: number; changed: number; briefs: number }> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const limit = opts.limit ?? 50;
  let reconciled = 0;
  let changed = 0;
  const due = await db.meeting.findMany({
    where: {
      status: 'BOOKED',
      bookedVia: 'PROVIDER',
      providerEventId: { not: null },
      ...(opts.meetingId
        ? { id: opts.meetingId }
        : { startAt: { gt: new Date(now.getTime() - DAY_MS), lt: new Date(now.getTime() + 60 * DAY_MS) }, OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: new Date(now.getTime() - 10 * 60_000) } }] }),
    },
    orderBy: { lastSyncedAt: { sort: 'asc', nulls: 'first' } },
    take: limit,
    include: { meetingType: true },
  });
  for (const m of due) {
    let event;
    try {
      ({ value: event } = await deps.providers.call({ workspaceId: m.workspaceId, capability: 'CALENDAR_READ', operation: 'get_event', integrationId: m.calendarIntegrationId ?? undefined }, (cal, options) => cal.getEvent(m.calendarId ?? 'primary', m.providerEventId!, options)));
    } catch {
      continue; // the calendar can't be asked right now — try on the next sweep
    }
    reconciled++;
    const ctx = system(m.workspaceId);
    if (!event || event.status === 'CANCELLED') {
      await cancelMeeting(db, ctx, m.id, { reason: 'Removed from the calendar — the event no longer exists there', source: 'PROVIDER' });
      changed++;
      continue;
    }
    const moved = m.startAt && (event.start !== m.startAt.toISOString() || event.end !== m.endAt?.toISOString());
    await db.$transaction(async (tx) => {
      if (moved) {
        await tx.meeting.update({ where: { id: m.id }, data: { startAt: new Date(event.start), endAt: new Date(event.end), providerEtag: event.etag, lastSyncedAt: now, version: { increment: 1 } } });
        await change(tx, ctx, m.id, 'CALENDAR_CHANGED', 'PROVIDER', { fromStartAt: m.startAt, toStartAt: new Date(event.start), toEndAt: new Date(event.end), reason: 'Moved in the calendar' });
        await recordEvent(tx, ctx, 'MeetingRescheduled', m.id, { meetingId: m.id, from: m.startAt!.toISOString(), to: event.start, source: 'PROVIDER' });
      } else {
        await tx.meeting.update({ where: { id: m.id }, data: { lastSyncedAt: now, providerEtag: event.etag, ...(event.meetingUrl && !m.meetingUrl ? { meetingUrl: event.meetingUrl } : {}) } });
      }
    }, TX);
    if (moved) changed++;
  }

  // Briefs 3 hours ahead, refreshed when older than 6 hours (screen #8 §20: not 3-month-old research).
  let briefs = 0;
  if (opts.meetingId) return { reconciled, changed, briefs };
  const soon = await db.meeting.findMany({ where: { status: 'BOOKED', startAt: { gt: now, lt: new Date(now.getTime() + 3 * 3_600_000) }, meetingType: { briefEnabled: true } }, select: { id: true, workspaceId: true }, take: limit });
  for (const s of soon) {
    const last = await db.meetingBrief.findFirst({ where: { meetingId: s.id }, orderBy: { version: 'desc' }, select: { generatedAt: true } });
    if (last && now.getTime() - last.generatedAt.getTime() < 6 * 3_600_000) continue;
    await db.$transaction((tx) => generateBriefTx(tx, s.workspaceId, s.id, now), TX);
    briefs++;
  }
  return { reconciled, changed, briefs };
}
