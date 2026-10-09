import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { executeExternalAction } from '@revenue-os/events';
import {
  cancelMeeting,
  checkCampaign,
  confirmManually,
  createCampaign,
  launchCampaign,
  meetingSweep,
  offerSlots,
  prepareStep,
  processConversationMessage,
  proposeMeeting,
  recordOutcome,
  requestBooking,
  rescheduleMeeting,
  saveSchedulingProfile,
  settleCampaignAction,
  settleMeetingAction,
  sweepCampaigns,
  syncMailbox,
  withCampaignGuard,
  withMeetingGuard,
  type OutreachDeps,
} from '@revenue-os/outreach';
import { createPolicyRevalidator, decideApproval, setOutboundState, updatePolicy } from '@revenue-os/policy';
import { createCalendarExecutor, createEmailSendExecutor, FakeCalendarProvider, FakeEmailProvider } from '@revenue-os/providers';
import { createProviderRuntime, type ProviderRuntime } from '@revenue-os/providers/runtime';
import { BusinessRuleError, ConflictError, DEFAULT_POLICY_SETTINGS, formatSlot, normalizeCompanyName, WEEKDAYS, zonedParts, type TimeSlot } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import type { PrismaService } from '../../infra/prisma.service.js';
import { SYSTEM_ACTOR, setupTestDatabase, uniqueSlug } from '../../testing/test-db.js';
import { WorkspaceService } from '../identity/workspace.service.js';
import { MeetingsQuery } from './meetings.query.js';

const CHICAGO = 'America/Chicago';

/**
 * Phase 14 (docs/17 §93-98): a prospect can request a meeting and the system safely moves from the conversation to a
 * provider-confirmed calendar event. Never BOOKED before the calendar confirms; a taken slot is never double-booked;
 * moves keep the old time until confirmed; a calendar-side deletion is noticed; a cancellation or no-show is not a
 * lost deal.
 */
describe('Phase 14 — Calendar + meetings', () => {
  let prisma: PrismaService;
  let close: () => Promise<void>;
  let storage: string;
  let runtime: ProviderRuntime;
  let deps: OutreachDeps;
  let query: MeetingsQuery;
  const OPEN = { ...DEFAULT_POLICY_SETTINGS, sendWindow: { ...DEFAULT_POLICY_SETTINGS.sendWindow, enabled: false }, contactCooldownDays: 0, firstTouchApproval: false };

  /** A workspace with a prospect in Austin who replied to the first campaign email, a test calendar and the owner's availability. */
  const setup = async (autonomyLevel: 'L1' | 'L3' = 'L1') => {
    const ws = await new WorkspaceService(prisma).createWorkspace(SYSTEM_ACTOR, { name: 'Meetings Test', slug: uniqueSlug('meet'), owner: { email: `${uniqueSlug('owner')}@example.com`, name: 'Olivia Owner' } });
    const owner: ServiceContext = { workspaceId: ws.workspace.id, actor: { type: 'HUMAN', id: ws.ownerUserId } };
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel: 'L3', settings: OPEN }));
    const mailbox = await prisma.client.integration.create({ data: { workspaceId: owner.workspaceId, provider: 'fake_email', category: 'EMAIL', name: 'Test mailbox', accountRef: `sam@${uniqueSlug('ours')}.example`, capabilities: ['EMAIL_SEND', 'EMAIL_READ'], status: 'ACTIVE', connectedAt: new Date() } });
    await prisma.client.integration.create({ data: { workspaceId: owner.workspaceId, provider: 'fake_llm', category: 'AI', name: 'Test model', capabilities: ['LLM_REASONING', 'LLM_EXTRACTION'], status: 'ACTIVE', connectedAt: new Date() } });
    const calendar = await prisma.client.integration.create({ data: { workspaceId: owner.workspaceId, provider: 'fake_calendar', category: 'CALENDAR', name: 'Test calendar', accountRef: 'default', capabilities: ['CALENDAR_READ', 'CALENDAR_WRITE'], status: 'ACTIVE', connectedAt: new Date() } });
    await saveSchedulingProfile(prisma.client, owner, ws.ownerUserId, { timezone: CHICAGO, meetingStartMinute: 10 * 60, meetingEndMinute: 16 * 60 });

    const domain = `${uniqueSlug('evergreen')}.example`;
    const company = await prisma.client.company.create({ data: { workspaceId: owner.workspaceId, displayName: 'Evergreen Lawn Care', normalizedName: normalizeCompanyName('Evergreen Lawn Care'), websiteDomain: domain, industry: 'Landscaping', city: 'Austin', region: 'TX', country: 'US' } });
    const person = await prisma.client.person.create({ data: { workspaceId: owner.workspaceId, fullName: 'Grace Lee', firstName: 'Grace' } });
    await prisma.client.employment.create({ data: { workspaceId: owner.workspaceId, personId: person.id, companyId: company.id, title: 'Owner', isCurrent: true } });
    const email = `grace@${domain}`;
    const cp = await prisma.client.contactPoint.create({ data: { workspaceId: owner.workspaceId, entityType: 'PERSON', entityId: person.id, type: 'EMAIL', value: email, normalizedValue: email, status: 'VERIFIED' } });
    await prisma.client.contactVerification.create({ data: { workspaceId: owner.workspaceId, contactPointId: cp.id, provider: 'fake_verification', status: 'VALID', verifiedAt: new Date() } });

    const c = await prisma.client.$transaction((tx) => createCampaign(tx, owner, { name: 'Austin landscapers', offer: 'online booking for local businesses', audience: { industries: ['landscap'] }, mailboxIntegrationId: mailbox.id, senderName: 'Sam', cohortSize: 5 }));
    assert.equal((await prisma.client.$transaction((tx) => checkCampaign(tx, owner, c.id))).ready, true);
    await prisma.client.$transaction((tx) => launchCampaign(tx, owner, c.id));
    const jobs: { workspaceId: string; enrollmentId: string; position: number }[] = [];
    await sweepCampaigns(prisma.client, async (j) => void jobs.push(j));
    for (const j of jobs.filter((x) => x.workspaceId === owner.workspaceId)) await prepareStep(deps, j);
    const e = await prisma.client.campaignEnrollment.findFirstOrThrow({ where: { campaignId: c.id } });
    const m1 = await prisma.client.campaignMessage.findFirstOrThrow({ where: { enrollmentId: e.id, position: 1 } });
    await executeExternalAction(prisma.client, { workspaceId: owner.workspaceId, externalActionId: m1.externalActionId! }, { executors: { 'email.send': createEmailSendExecutor(runtime.gateway) }, revalidate: withCampaignGuard(createPolicyRevalidator()) });
    await settleCampaignAction(prisma.client, m1.externalActionId!);
    await prisma.client.$transaction((tx) => updatePolicy(tx, owner, { autonomyLevel }));
    return { owner, ownerUserId: ws.ownerUserId, mailbox, calendar, company, person, email, enrollment: await prisma.client.campaignEnrollment.findUniqueOrThrow({ where: { id: e.id } }) };
  };
  type Setup = Awaited<ReturnType<typeof setup>>;

  const mailboxOf = (id: string) => runtime.factory.forIntegration({ id, workspaceId: '', provider: 'fake_email' }) as FakeEmailProvider;
  const calendarOf = (id: string) => runtime.factory.forIntegration({ id, workspaceId: '', provider: 'fake_calendar' }) as FakeCalendarProvider;
  const writes = async (s: Setup, text: string) => {
    await mailboxOf(s.mailbox.id).receive({ from: s.email, to: [s.mailbox.accountRef], subject: 'Re: Idea for Evergreen Lawn Care', text, threadId: s.enrollment.threadRef! });
    await syncMailbox(prisma.client, runtime.gateway, s.mailbox);
    const msg = await prisma.client.conversationMessage.findFirstOrThrow({ where: { workspaceId: s.owner.workspaceId, direction: 'INBOUND' }, orderBy: { createdAt: 'desc' } });
    const outcome = await processConversationMessage(deps, { workspaceId: s.owner.workspaceId, conversationId: msg.conversationId, messageId: msg.id });
    return { conv: await prisma.client.conversation.findUniqueOrThrow({ where: { id: msg.conversationId } }), outcome };
  };
  const meetingOf = (conversationId: string) => prisma.client.meeting.findFirstOrThrow({ where: { conversationId }, orderBy: { createdAt: 'desc' } });
  const slots = (m: { offeredSlots: unknown }) => m.offeredSlots as TimeSlot[];
  const exec = (s: Setup, externalActionId: string) =>
    executeExternalAction(prisma.client, { workspaceId: s.owner.workspaceId, externalActionId }, { executors: { 'calendar.book': createCalendarExecutor(runtime.gateway), 'calendar.update': createCalendarExecutor(runtime.gateway), 'calendar.cancel': createCalendarExecutor(runtime.gateway) }, revalidate: withMeetingGuard(createPolicyRevalidator()) });
  /** A slot whose weekday + time appears only once, so "Thursday at 1:30 PM" is unambiguous. */
  const unique = (list: TimeSlot[]) => list.find((x) => list.filter((y) => { const a = zonedParts(new Date(x.start), CHICAGO); const b = zonedParts(new Date(y.start), CHICAGO); return a.weekday === b.weekday && a.minute === b.minute; }).length === 1)!;
  /** "Friday at 10:00 AM" — how a prospect picks a time. */
  const pick = (slot: TimeSlot) => `${WEEKDAYS[zonedParts(new Date(slot.start), CHICAGO).weekday]} at ${new Intl.DateTimeFormat('en-US', { timeZone: CHICAGO, hour: 'numeric', minute: '2-digit' }).format(new Date(slot.start))}`;
  /** Asks the prospect for a meeting and offers the times — the common start of most tests. */
  const offered = async (s: Setup) => {
    const { conv } = await writes(s, 'We need online booking for the business. Could we set up a call? Thursday afternoon works for me.');
    const m = await meetingOf(conv.id);
    const offer = await offerSlots(deps, s.owner, m.id);
    return { conv, meeting: offer.meeting, text: offer.text };
  };

  before(async () => {
    process.env.APP_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    ({ prisma, close } = await setupTestDatabase());
    storage = await mkdtemp(join(tmpdir(), 'rhl-phase14-'));
    runtime = createProviderRuntime(prisma.client, { appEnv: 'test', storagePath: storage });
    deps = { db: prisma.client, providers: runtime.gateway, publicUrl: 'http://localhost:3000' };
    query = new MeetingsQuery(prisma);
  });
  after(async () => {
    await close();
    await rm(storage, { recursive: true, force: true });
  });

  test('DoD: meeting request → real free times → offered → they pick one → AI asks to book (L1: approval) → calendar confirms → BOOKED, deal + brief', async () => {
    const s = await setup('L1');
    const { conv: requested } = await writes(s, 'We need online booking for the business. Could we set up a call? Thursday afternoon works for me.');
    assert.equal(requested.stage, 'MEETING_REQUESTED');
    assert.equal(requested.category, 'MEETING');
    const proposed = await meetingOf(requested.id);
    assert.equal(proposed.status, 'PROPOSED');
    assert.equal(proposed.createdByType, 'AI_AGENT', 'the Scheduling Agent found the times');
    assert.equal(proposed.timezone, CHICAGO, 'Austin, TX → Central time');
    assert.equal(proposed.timezoneSource, 'BUSINESS_LOCATION');
    assert.equal(proposed.ownerUserId, s.ownerUserId);
    assert.match(proposed.routingReason ?? '', /Round robin/);
    assert.ok(slots(proposed).length >= 1, 'genuinely free times were found');
    assert.equal((proposed.preference as { label: string }).label, 'Thursday afternoon');
    for (const x of slots(proposed)) assert.ok(Date.parse(x.start) > Date.now(), 'only future times');
    assert.equal(await prisma.client.meetingAttendee.count({ where: { meetingId: proposed.id } }), 2);

    // A second meeting request in the same conversation does not create a second meeting.
    await writes(s, 'Or Friday morning, if that is easier for a call?');
    assert.equal(await prisma.client.meeting.count({ where: { conversationId: requested.id } }), 1);

    const { text, meeting: waiting } = await offerSlots(deps, s.owner, proposed.id);
    assert.equal(waiting.status, 'PENDING_CONFIRMATION');
    assert.match(text, /Hi Grace/);
    const chosen = unique(slots(waiting));
    assert.ok(text.includes(formatSlot(chosen.start, CHICAGO)), 'the message lists the real times');

    // They pick one. The AI asks to book it — at L1 a person approves first. Nothing is booked yet.
    const { outcome } = await writes(s, `${pick(chosen)} works for me.`);
    assert.equal(outcome, 'MEETING_BOOKING', 'the calendar invite is the answer — no reply drafted');
    let m = await meetingOf(requested.id);
    assert.equal(m.status, 'PENDING_CONFIRMATION', 'never BOOKED before the calendar confirms');
    assert.equal(m.pendingStartAt?.toISOString(), chosen.start);
    assert.match(m.statusReason ?? '', /Waiting for approval/);
    const action = await prisma.client.externalAction.findUniqueOrThrow({ where: { id: m.externalActionId! } });
    assert.equal(action.actionType, 'calendar.book');
    assert.equal(action.requestedByAgent, 'SCHEDULING');
    assert.equal(action.status, 'WAITING_APPROVAL');
    assert.deepEqual((action.payload as { attendees: string[] }).attendees, [s.email]);

    assert.equal(await decideApproval(prisma.client, s.owner, action.approvalRequestId!, 'APPROVE'), 'QUEUED');
    const r = await exec(s, action.id);
    assert.equal(r, 'SUCCEEDED');
    await settleMeetingAction(prisma.client, action.id);
    m = await meetingOf(requested.id);
    assert.equal(m.status, 'BOOKED');
    assert.equal(m.bookedVia, 'PROVIDER');
    assert.equal(m.startAt?.toISOString(), chosen.start);
    assert.ok(m.providerEventId?.startsWith('fake-evt-'));
    assert.match(m.meetingUrl ?? '', /meet\.test-calendar\.example/);
    const event = await calendarOf(s.calendar.id).getEvent('primary', m.providerEventId!);
    assert.equal(event?.status, 'CONFIRMED');
    assert.deepEqual(event?.attendees, [s.email]);

    // Replaying the action never creates a second event (idempotency).
    await exec(s, action.id);
    assert.equal(calendarOf(s.calendar.id).creates, 1);

    // What follows from a booking: conversation, deal (created from the evidence and moved to Meeting), brief, events.
    const conv = await prisma.client.conversation.findUniqueOrThrow({ where: { id: requested.id } });
    assert.equal(conv.stage, 'MEETING_BOOKED');
    assert.equal(conv.needsHuman, false);
    const deal = await prisma.client.opportunity.findUniqueOrThrow({ where: { id: m.opportunityId! }, include: { stage: true } });
    assert.equal(deal.stage.semantic, 'MEETING');
    assert.equal(conv.opportunityId, deal.id);
    const brief = await prisma.client.meetingBrief.findFirstOrThrow({ where: { meetingId: m.id } });
    assert.match((brief.content as { need: string }).need, /online booking/);
    assert.ok((brief.content as { dontAskAgain: string[] }).dontAskAgain.some((d) => /Need/.test(d)));
    const types = (await prisma.client.domainEvent.findMany({ where: { aggregateId: m.id }, select: { eventType: true } })).map((e) => e.eventType);
    for (const t of ['MeetingProposed', 'MeetingSlotsOffered', 'MeetingBookingRequested', 'MeetingBooked', 'MeetingBriefGenerated']) assert.ok(types.includes(t), t);
    const journey = (await prisma.client.meetingChange.findMany({ where: { meetingId: m.id }, orderBy: { at: 'asc' } })).map((c) => c.kind);
    assert.deepEqual(journey.filter((k) => k !== 'PROPOSED'), ['OFFERED', 'BOOKING_REQUESTED', 'BOOKED']);

    const view = await query.detail(s.owner.workspaceId, m.id);
    assert.ok(view.allowedActions.includes('reschedule') && view.allowedActions.includes('cancel'));
    assert.ok(!view.allowedActions.includes('book'));
  });

  test('no double booking: a slot taken before booking gets new times; one taken right before the calendar call fails safely', async () => {
    const s = await setup('L1');
    const { meeting } = await offered(s);
    const [first, second] = slots(meeting);
    assert.ok(first && second);
    const cal = calendarOf(s.calendar.id);
    // Someone books `first` directly in the calendar.
    await cal.createEvent({ calendarId: 'primary', title: 'Dentist', attendees: [], idempotencyKey: 'outside-1', start: first.start, end: first.end }, { signal: AbortSignal.timeout(5000) });
    await assert.rejects(() => requestBooking(deps, s.owner, meeting.id, { start: first.start }), (e: unknown) => e instanceof ConflictError && e.code === 'SLOT_UNAVAILABLE');
    const refreshed = await prisma.client.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    assert.equal(refreshed.status, 'PROPOSED', 'new times must be offered again');
    assert.ok(!slots(refreshed).some((x) => x.start === first.start), 'the taken time is not offered again');

    // A person books `second` (meeting.book → ACT): queued, not booked.
    const target = slots(refreshed).find((x) => x.start === second.start) ?? slots(refreshed)[0]!;
    const queued = await requestBooking(deps, s.owner, meeting.id, { start: target.start });
    assert.equal(queued.status, 'PENDING_CONFIRMATION');
    // The same click twice is the same booking.
    assert.equal((await requestBooking(deps, s.owner, meeting.id, { start: target.start })).externalActionId, queued.externalActionId);
    // It gets taken in the calendar before the worker runs: the execution-time check refuses.
    await cal.createEvent({ calendarId: 'primary', title: 'Other call', attendees: [], idempotencyKey: 'outside-2', start: target.start, end: target.end }, { signal: AbortSignal.timeout(5000) });
    assert.equal(await exec(s, queued.externalActionId!), 'FAILED');
    await settleMeetingAction(prisma.client, queued.externalActionId!);
    const failed = await prisma.client.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    assert.equal(failed.status, 'PROPOSED');
    assert.equal(failed.providerEventId, null, 'nothing was confirmed');
    assert.match(failed.statusReason ?? '', /Not booked/);
    const conv = await prisma.client.conversation.findUniqueOrThrow({ where: { id: failed.conversationId! } });
    assert.equal(conv.needsHuman, true);
    assert.match(conv.escalationReason ?? '', /offer new times/);

    // Emergency stop: no invitation goes out.
    await prisma.client.$transaction((tx) => setOutboundState(tx, s.owner, new Set(['outbound.emergency_stop']), 'EMERGENCY_STOP', 'Test'));
    const fresh = slots(await prisma.client.meeting.findUniqueOrThrow({ where: { id: meeting.id } }));
    const blocked = await requestBooking(deps, s.owner, meeting.id, { start: fresh[0]!.start });
    assert.equal(blocked.status, 'PROPOSED');
    assert.match(blocked.statusReason ?? '', /Not booked/);
  });

  test('reschedule keeps the old time until confirmed; a deletion in the calendar is noticed; a cancellation is not a lost deal', async () => {
    const s = await setup('L1');
    const { meeting } = await offered(s);
    const [first] = slots(meeting);
    const booking = await requestBooking(deps, s.owner, meeting.id, { start: first!.start });
    await exec(s, booking.externalActionId!);
    await settleMeetingAction(prisma.client, booking.externalActionId!);
    let m = await prisma.client.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    assert.equal(m.status, 'BOOKED');

    // Move it to the same weekday next week, 20:00 UTC — mid-afternoon in Austin, outside the test calendar's busy blocks.
    const nextDay = new Date(Date.parse(first!.start) + 7 * 86_400_000);
    nextDay.setUTCHours(20, 0, 0, 0);
    const next = nextDay.toISOString();
    const moving = await rescheduleMeeting(deps, s.owner, m.id, { start: next, reason: 'They asked to move it' });
    assert.equal(moving.status, 'RESCHEDULING');
    assert.equal(moving.startAt?.toISOString(), first!.start, 'the old time stands until the calendar confirms');
    await exec(s, moving.externalActionId!);
    await settleMeetingAction(prisma.client, moving.externalActionId!);
    m = await prisma.client.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    assert.equal(m.status, 'BOOKED');
    assert.equal(m.startAt?.toISOString(), next);
    assert.equal((await calendarOf(s.calendar.id).getEvent('primary', m.providerEventId!))?.start, next);
    assert.equal(await prisma.client.meeting.count({ where: { conversationId: m.conversationId } }), 1, 'moved, not duplicated');

    // Someone deletes the event in the calendar → reconciliation cancels it here (source: the calendar).
    await calendarOf(s.calendar.id).externalChange(m.providerEventId!, { cancel: true });
    const r = await meetingSweep(deps, { meetingId: m.id });
    assert.equal(r.changed, 1);
    m = await prisma.client.meeting.findUniqueOrThrow({ where: { id: meeting.id } });
    assert.equal(m.status, 'CANCELLED');
    assert.equal(m.cancelSource, 'PROVIDER');
    const deal = await prisma.client.opportunity.findUniqueOrThrow({ where: { id: m.opportunityId! } });
    assert.equal(deal.status, 'OPEN', 'a cancellation is not a lost deal');
    const conv = await prisma.client.conversation.findUniqueOrThrow({ where: { id: m.conversationId! } });
    assert.equal(conv.needsHuman, true);
    assert.match(conv.escalationReason ?? '', /cancelled/);
    await assert.rejects(() => cancelMeeting(prisma.client, s.owner, m.id, { reason: 'again', source: 'TEAM' }), BusinessRuleError);
  });

  test('qualification protects calendars; a meeting booked by phone is recorded by a person; no-shows are not lost; outcomes recommend the next stage', async () => {
    const s = await setup('L1');
    const { conv } = await writes(s, 'Can we jump on a call next week?');
    const types = await prisma.client.meetingType.findMany({ where: { workspaceId: s.owner.workspaceId } });
    const demo = types.find((t) => t.key === 'TECHNICAL_DEMO')!;
    await assert.rejects(() => proposeMeeting(deps, s.owner, { companyId: s.company.id, meetingTypeId: demo.id }), (e: unknown) => e instanceof BusinessRuleError && /qualified deal/.test(e.message));

    // Booked on the phone: a person records it (BOOKED via MANUAL), here for an hour ago so it can be closed.
    const m = await meetingOf(conv.id);
    await assert.rejects(() => confirmManually(prisma.client, s.owner, m.id, { start: new Date(), note: ' ' }));
    await confirmManually(prisma.client, s.owner, m.id, { start: new Date(Date.now() - 3_600_000), note: 'Booked on the phone' });
    const booked = await prisma.client.meeting.findUniqueOrThrow({ where: { id: m.id } });
    assert.equal(booked.status, 'BOOKED');
    assert.equal(booked.bookedVia, 'MANUAL');

    const r = await recordOutcome(prisma.client, s.owner, m.id, { outcome: 'NO_SHOW' });
    assert.equal(r.noShows, 1);
    const after = await prisma.client.meeting.findUniqueOrThrow({ where: { id: m.id } });
    assert.equal(after.status, 'NO_SHOW');
    const deal = await prisma.client.opportunity.findUniqueOrThrow({ where: { id: after.opportunityId! } });
    assert.equal(deal.status, 'OPEN', 'a no-show is not a lost deal');
    const c = await prisma.client.conversation.findUniqueOrThrow({ where: { id: conv.id } });
    assert.match(c.escalationReason ?? '', /No-show — offer to reschedule/);

    // A second meeting, also missed → the risk shows.
    const again = await proposeMeeting(deps, s.owner, { conversationId: conv.id });
    await confirmManually(prisma.client, s.owner, again.id, { start: new Date(Date.now() - 2 * 3_600_000), note: 'Rebooked by phone' });
    const r2 = await recordOutcome(prisma.client, s.owner, again.id, { outcome: 'NO_SHOW' });
    assert.equal(r2.noShows, 2);
    assert.match(r2.risk ?? '', /confirm before reserving/);

    // Third time they show up: the need and timeline are confirmed → the rules recommend Qualified and the person accepts.
    await writes(s, 'Sorry about that. We need online booking and want it live next month.');
    const third = await proposeMeeting(deps, s.owner, { conversationId: conv.id });
    await confirmManually(prisma.client, s.owner, third.id, { start: new Date(Date.now() - 3_600_000), note: 'Called them back' });
    const attendees = await prisma.client.meetingAttendee.findMany({ where: { meetingId: third.id } });
    const done = await recordOutcome(prisma.client, s.owner, third.id, { outcome: 'ADVANCED', summary: 'Good discovery call', nextStep: 'Send the proposal', attendance: attendees.map((a) => ({ attendeeId: a.id, attended: true })), applyStage: true });
    const stage = (await prisma.client.opportunity.findUniqueOrThrow({ where: { id: deal.id }, include: { stage: true } })).stage.semantic;
    assert.ok(done.recommendedStage === 'QUALIFIED' || done.recommendedStage === 'PROPOSAL', `recommended ${done.recommendedStage} (${done.why})`);
    if (done.stageApplied) assert.equal(stage, done.recommendedStage);
    assert.equal((await prisma.client.opportunity.findUniqueOrThrow({ where: { id: deal.id } })).nextActionOverride, 'Send the proposal');

    const list = await query.list(s.owner.workspaceId, s.ownerUserId, { from: new Date(Date.now() - 86_400_000), to: new Date(Date.now() + 86_400_000), mine: false });
    assert.ok(list.meetings.some((x) => x.id === third.id && x.status === 'COMPLETED'));
    assert.ok(list.needsAction.some((x) => x.status === 'NO_SHOW'));
  });
});
