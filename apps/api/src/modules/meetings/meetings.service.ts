import { Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@revenue-os/config';
import type { MeetingOutcomeType } from '@revenue-os/database';
import {
  applyRecommendedStage,
  cancelMeeting,
  confirmManually,
  findAvailability,
  generateBrief,
  meetingSweep,
  meetingTypes,
  offerSlots,
  proposeMeeting,
  recordOutcome,
  refreshSlots,
  requestBooking,
  rescheduleMeeting,
  saveSchedulingProfile,
  updateMeetingType,
  type MeetingTypeInput,
  type OutcomeInput,
  type ProposeInput,
  type SchedulingProfileInput,
} from '@revenue-os/outreach';
import { FakeCalendarProvider } from '@revenue-os/providers';
import type { ProviderRuntime } from '@revenue-os/providers/runtime';
import { BusinessRuleError, ForbiddenError, NotFoundError, parseMeetingPreference, ValidationError } from '@revenue-os/shared';
import type { ServiceContext } from '../../domain/service-context.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { APP_CONFIG } from '../../infra/tokens.js';
import { PROVIDER_RUNTIME } from '../integrations/provider-runtime.js';

const brief = (m: { id: string; status: string; statusReason: string | null; pendingStartAt: Date | null; startAt: Date | null }) => ({ id: m.id, status: m.status, statusReason: m.statusReason, pendingStartAt: m.pendingStartAt, startAt: m.startAt });

/**
 * Calendar + meetings (Phase 14, screen #8). Commands go through @revenue-os/outreach; bookings, moves and
 * cancellations reach the calendar only as calendar.* external actions the Policy Engine decides on.
 */
@Injectable()
export class MeetingsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROVIDER_RUNTIME) private readonly runtime: ProviderRuntime,
  ) {}

  private deps() {
    return { db: this.prisma.client, providers: this.runtime.gateway, publicUrl: this.config.APP_URL };
  }

  async propose(ctx: ServiceContext, input: ProposeInput) {
    return brief(await proposeMeeting(this.deps(), ctx, input));
  }

  async slots(ctx: ServiceContext, id: string, input: { requestText?: string | null; ownerUserId?: string | null; meetingTypeId?: string | null }) {
    return brief(await refreshSlots(this.deps(), ctx, id, input));
  }

  async offer(ctx: ServiceContext, id: string) {
    const r = await offerSlots(this.deps(), ctx, id);
    return { text: r.text, meeting: brief(r.meeting) };
  }

  async book(ctx: ServiceContext, id: string, start: string) {
    return brief(await requestBooking(this.deps(), ctx, id, { start }));
  }

  confirmManual(ctx: ServiceContext, id: string, input: { start: Date; end?: Date | null; note: string; meetingUrl?: string | null }) {
    return confirmManually(this.prisma.client, ctx, id, input);
  }

  async reschedule(ctx: ServiceContext, id: string, input: { start: string; reason: string }) {
    return brief(await rescheduleMeeting(this.deps(), ctx, id, input));
  }

  async cancel(ctx: ServiceContext, id: string, input: { reason: string; source: 'PROSPECT' | 'TEAM' }) {
    return brief(await cancelMeeting(this.prisma.client, ctx, id, input));
  }

  outcome(ctx: ServiceContext, id: string, input: OutcomeInput & { outcome: MeetingOutcomeType }) {
    return recordOutcome(this.prisma.client, ctx, id, input);
  }

  applyStage(ctx: ServiceContext, id: string) {
    return applyRecommendedStage(this.prisma.client, ctx, id);
  }

  async brief(ctx: ServiceContext, id: string) {
    const b = await generateBrief(this.prisma.client, ctx, id);
    return { id: b.id, version: b.version };
  }

  updateType(ctx: ServiceContext, id: string, input: MeetingTypeInput) {
    return updateMeetingType(this.prisma.client, ctx, id, input);
  }

  async saveProfile(ctx: ServiceContext, userId: string, input: SchedulingProfileInput) {
    const p = await saveSchedulingProfile(this.prisma.client, ctx, userId, input);
    return { id: p.id, userId: p.userId, version: p.version };
  }

  /** "When could X meet?" — a read-only look at free times (nothing is created). */
  async availability(ctx: ServiceContext, input: { ownerUserId: string; meetingTypeId?: string | null; timezone?: string | null; requestText?: string | null }) {
    const types = await meetingTypes(this.prisma.client, ctx.workspaceId);
    const type = (input.meetingTypeId ? types.find((t) => t.id === input.meetingTypeId) : types.find((t) => t.key === 'DISCOVERY')) ?? types[0];
    if (!type) throw new NotFoundError('No meeting types');
    const ws = await this.prisma.client.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { defaultTimezone: true } });
    const tz = input.timezone || ws.defaultTimezone;
    const r = await findAvailability(this.deps(), { workspaceId: ctx.workspaceId, ownerUserId: input.ownerUserId, durationMinutes: type.durationMinutes, bufferMinutes: type.bufferMinutes, prospectTimezone: tz, preference: input.requestText ? parseMeetingPreference(input.requestText, new Date(), tz) : null, limit: 6 });
    return { ...r, timezone: tz, meetingType: { id: type.id, name: type.name, durationMinutes: type.durationMinutes } };
  }

  /**
   * Test calendar only (never production, never a real calendar): someone changes or deletes the event in the calendar
   * itself — then the meeting is reconciled exactly as the periodic sweep would.
   */
  async simulateCalendar(ctx: ServiceContext, id: string, input: { action: 'cancel' | 'move'; start?: string | null }) {
    if (this.config.APP_ENV === 'production') throw new ForbiddenError('Not available in production');
    const m = await this.prisma.client.meeting.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!m) throw new NotFoundError('Meeting not found');
    if (m.status !== 'BOOKED' || !m.providerEventId || !m.calendarIntegrationId) throw new BusinessRuleError('INVALID_STATE_TRANSITION', 'Only a meeting booked in the calendar can be changed there');
    const integration = await this.prisma.client.integration.findFirst({ where: { id: m.calendarIntegrationId, workspaceId: ctx.workspaceId } });
    const adapter = integration ? this.runtime.factory.forIntegration(integration) : null;
    if (!(adapter instanceof FakeCalendarProvider)) throw new ValidationError('Calendar changes can only be simulated on the test calendar');
    if (input.action === 'move') {
      if (!input.start || !m.startAt || !m.endAt) throw new ValidationError('Say the new start time', [{ path: 'start', message: 'Required' }]);
      const start = new Date(input.start);
      await adapter.externalChange(m.providerEventId, { start: start.toISOString(), end: new Date(start.getTime() + (m.endAt.getTime() - m.startAt.getTime())).toISOString() });
    } else {
      await adapter.externalChange(m.providerEventId, { cancel: true });
    }
    return meetingSweep(this.deps(), { meetingId: m.id });
  }
}
