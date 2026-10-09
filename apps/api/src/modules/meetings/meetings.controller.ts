import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { MEETING_LOCATIONS, MEETING_OUTCOMES, MEETING_QUALIFICATION_RULES, ForbiddenError } from '@revenue-os/shared';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { AccessService, type Access } from '../auth/access.service.js';
import { CurrentAccess, RequirePermission } from '../auth/auth.decorators.js';
import { MeetingsQuery } from './meetings.query.js';
import { MeetingsService } from './meetings.service.js';

const Iso = z.iso.datetime({ offset: true });
const ListQuery = z.strictObject({ from: Iso.optional(), to: Iso.optional(), mine: z.enum(['true', 'false']).optional() });
const ProposeInput = z.strictObject({
  conversationId: z.uuid().nullable().optional(),
  opportunityId: z.uuid().nullable().optional(),
  companyId: z.uuid().nullable().optional(),
  personId: z.uuid().nullable().optional(),
  meetingTypeId: z.uuid().nullable().optional(),
  ownerUserId: z.uuid().nullable().optional(),
  requestText: z.string().trim().max(500).nullable().optional(),
});
const SlotsInput = z.strictObject({ requestText: z.string().trim().max(500).nullable().optional(), ownerUserId: z.uuid().nullable().optional(), meetingTypeId: z.uuid().nullable().optional() });
const BookInput = z.strictObject({ start: Iso });
const ManualInput = z.strictObject({ start: Iso, end: Iso.nullable().optional(), note: z.string().trim().min(1).max(500), meetingUrl: z.url().max(500).nullable().optional() });
const RescheduleInput = z.strictObject({ start: Iso, reason: z.string().trim().min(1).max(500) });
const CancelInput = z.strictObject({ reason: z.string().trim().min(1).max(500), source: z.enum(['PROSPECT', 'TEAM']).default('TEAM') });
const OutcomeInput = z.strictObject({
  outcome: z.enum(MEETING_OUTCOMES),
  summary: z.string().trim().max(1000).nullable().optional(),
  notes: z.string().trim().max(20_000).nullable().optional(),
  nextStep: z.string().trim().max(300).nullable().optional(),
  attendance: z.array(z.strictObject({ attendeeId: z.uuid(), attended: z.boolean().nullable() })).max(30).optional(),
  applyStage: z.boolean().optional(),
});
const TypeInput = z.strictObject({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  durationMinutes: z.number().int().min(5).max(480).optional(),
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  requiredQualification: z.enum(MEETING_QUALIFICATION_RULES).optional(),
  aiBookingAllowed: z.boolean().optional(),
  briefEnabled: z.boolean().optional(),
  locationType: z.enum(MEETING_LOCATIONS).optional(),
  active: z.boolean().optional(),
});
const Minute = z.number().int().min(0).max(1440);
const ProfileInput = z.strictObject({
  timezone: z.string().trim().min(1).max(100).optional(),
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  meetingStartMinute: Minute.optional(),
  meetingEndMinute: Minute.optional(),
  lunchStartMinute: Minute.nullable().optional(),
  lunchEndMinute: Minute.nullable().optional(),
  bufferMinutes: z.number().int().min(0).max(240).optional(),
  maxMeetingsPerDay: z.number().int().min(1).max(30).optional(),
  minNoticeMinutes: z.number().int().min(0).max(20_160).optional(),
  calendarIntegrationId: z.uuid().nullable().optional(),
  calendarId: z.string().trim().min(1).max(300).optional(),
  acceptsMeetings: z.boolean().optional(),
  unavailableUntil: Iso.nullable().optional(),
});
const profileInput = ({ unavailableUntil, ...rest }: z.output<typeof ProfileInput>) => ({ ...rest, ...(unavailableUntil !== undefined ? { unavailableUntil: unavailableUntil ? new Date(unavailableUntil) : null } : {}) });
const AvailabilityInput = z.strictObject({ ownerUserId: z.uuid().optional(), meetingTypeId: z.uuid().nullable().optional(), timezone: z.string().trim().max(100).nullable().optional(), requestText: z.string().trim().max(500).nullable().optional() });
const SimulateInput = z.strictObject({ action: z.enum(['cancel', 'move']), start: Iso.nullable().optional() });

/**
 * Calendar + meetings (screen #8). Reading: opportunity.read (every role). Arranging, booking, moving, cancelling and
 * recording outcomes: meeting.book. Meeting types: policy.manage (they decide what the AI may book). Someone else's
 * availability: member.manage.
 */
@Controller('meetings')
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly query: MeetingsQuery,
    private readonly access: AccessService,
  ) {}

  @Get()
  @RequirePermission('opportunity.read')
  list(@Query(new ZodValidationPipe(ListQuery)) q: z.output<typeof ListQuery>, @CurrentAccess() access: Access) {
    const from = q.from ? new Date(q.from) : new Date(Date.now() - 86_400_000);
    const to = q.to ? new Date(q.to) : new Date(from.getTime() + 14 * 86_400_000);
    return this.query.list(access.workspaceId, access.userId, { from, to, mine: q.mine === 'true' });
  }

  @Get('setup')
  @RequirePermission('opportunity.read')
  setup(@CurrentAccess() access: Access) {
    return this.query.setup(access.workspaceId, access.userId);
  }

  @Patch('types/:id')
  @RequirePermission('policy.manage')
  updateType(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(TypeInput)) input: z.output<typeof TypeInput>, @CurrentAccess() access: Access) {
    return this.meetings.updateType(this.access.serviceContext(access), id, input);
  }

  /** When I can be booked. */
  @Put('availability/me')
  @RequirePermission('meeting.book')
  saveMine(@Body(new ZodValidationPipe(ProfileInput)) input: z.output<typeof ProfileInput>, @CurrentAccess() access: Access) {
    return this.meetings.saveProfile(this.access.serviceContext(access), access.userId, profileInput(input));
  }

  /** A colleague's availability (e.g. marking someone away). */
  @Put('availability/:userId')
  @RequirePermission('member.manage')
  saveFor(@Param('userId', ParseUUIDPipe) userId: string, @Body(new ZodValidationPipe(ProfileInput)) input: z.output<typeof ProfileInput>, @CurrentAccess() access: Access) {
    return this.meetings.saveProfile(this.access.serviceContext(access), userId, profileInput(input));
  }

  /** Free times for someone, read-only (nothing is created). */
  @Post('availability')
  @HttpCode(200)
  @RequirePermission('meeting.book')
  availability(@Body(new ZodValidationPipe(AvailabilityInput)) input: z.output<typeof AvailabilityInput>, @CurrentAccess() access: Access) {
    return this.meetings.availability(this.access.serviceContext(access), { ...input, ownerUserId: input.ownerUserId ?? access.userId });
  }

  @Post('propose')
  @HttpCode(200)
  @RequirePermission('meeting.book')
  propose(@Body(new ZodValidationPipe(ProposeInput)) input: z.output<typeof ProposeInput>, @CurrentAccess() access: Access) {
    return this.meetings.propose(this.access.serviceContext(access), input);
  }

  @Get(':id')
  @RequirePermission('opportunity.read')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.query.detail(access.workspaceId, id);
  }

  @Post(':id/slots')
  @HttpCode(200)
  @RequirePermission('meeting.book')
  slots(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(SlotsInput)) input: z.output<typeof SlotsInput>, @CurrentAccess() access: Access) {
    return this.meetings.slots(this.access.serviceContext(access), id, input);
  }

  /** The message offering the free times — the inbox puts it into the reply box for a person to send. */
  @Post(':id/offer')
  @HttpCode(200)
  @RequirePermission('meeting.book')
  offer(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.meetings.offer(this.access.serviceContext(access), id);
  }

  /** Book a time: re-checked against the calendar, then a calendar.book action the Policy Engine decides on. */
  @Post(':id/book')
  @HttpCode(200)
  @RequirePermission('meeting.book')
  book(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(BookInput)) input: z.output<typeof BookInput>, @CurrentAccess() access: Access) {
    return this.meetings.book(this.access.serviceContext(access), id, input.start);
  }

  /** A meeting booked elsewhere (phone, their calendar), recorded by a person. */
  @Post(':id/confirm-manual')
  @HttpCode(200)
  @RequirePermission('meeting.book')
  confirmManual(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ManualInput)) input: z.output<typeof ManualInput>, @CurrentAccess() access: Access) {
    return this.meetings.confirmManual(this.access.serviceContext(access), id, { start: new Date(input.start), end: input.end ? new Date(input.end) : null, note: input.note, meetingUrl: input.meetingUrl ?? null });
  }

  @Post(':id/reschedule')
  @HttpCode(200)
  @RequirePermission('meeting.book')
  reschedule(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(RescheduleInput)) input: z.output<typeof RescheduleInput>, @CurrentAccess() access: Access) {
    return this.meetings.reschedule(this.access.serviceContext(access), id, input);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('meeting.book')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(CancelInput)) input: z.output<typeof CancelInput>, @CurrentAccess() access: Access) {
    return this.meetings.cancel(this.access.serviceContext(access), id, input);
  }

  @Post(':id/outcome')
  @HttpCode(200)
  @RequirePermission('meeting.book')
  outcome(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(OutcomeInput)) input: z.output<typeof OutcomeInput>, @CurrentAccess() access: Access) {
    // Moving the deal needs the deal permission too.
    if (input.applyStage && !access.permissions.has('opportunity.update')) throw new ForbiddenError('Moving the deal needs the “edit opportunities” permission');
    return this.meetings.outcome(this.access.serviceContext(access), id, input);
  }

  @Post(':id/apply-stage')
  @HttpCode(200)
  @RequirePermission('opportunity.update')
  applyStage(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.meetings.applyStage(this.access.serviceContext(access), id);
  }

  @Post(':id/brief')
  @HttpCode(200)
  @RequirePermission('meeting.book')
  brief(@Param('id', ParseUUIDPipe) id: string, @CurrentAccess() access: Access) {
    return this.meetings.brief(this.access.serviceContext(access), id);
  }

  /** Test calendar only: the event is moved or deleted in the calendar itself → reconciled like the sweep would. */
  @Post(':id/simulate-calendar')
  @HttpCode(200)
  @RequirePermission('meeting.book')
  simulate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(SimulateInput)) input: z.output<typeof SimulateInput>, @CurrentAccess() access: Access) {
    return this.meetings.simulateCalendar(this.access.serviceContext(access), id, input);
  }
}
