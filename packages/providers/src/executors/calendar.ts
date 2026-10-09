import type { ActionExecutor, ExternalActionView, ReconcileResult } from '@revenue-os/events';
import { ValidationError } from '@revenue-os/shared';
import { z } from 'zod';
import type { CalendarEvent } from '../core/interfaces.js';
import type { ProviderGateway } from '../gateway/gateway.js';

/** ExternalAction types for meetings (Phase 14). Each goes through the Policy Engine like an email. */
export const CALENDAR_BOOK_ACTION = 'calendar.book';
export const CALENDAR_UPDATE_ACTION = 'calendar.update';
export const CALENDAR_CANCEL_ACTION = 'calendar.cancel';
export const CALENDAR_ACTIONS = [CALENDAR_BOOK_ACTION, CALENDAR_UPDATE_ACTION, CALENDAR_CANCEL_ACTION] as const;

const Iso = z.iso.datetime({ offset: true });
/** The frozen payload of a calendar.book action — the invite as approved. */
export const CalendarBookPayload = z.strictObject({
  meetingId: z.uuid(),
  calendarId: z.string().min(1).max(300),
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  start: Iso,
  end: Iso,
  timezone: z.string().max(100),
  attendees: z.array(z.email()).min(1).max(20),
  videoLink: z.boolean(),
});
export const CalendarUpdatePayload = z.strictObject({
  meetingId: z.uuid(),
  calendarId: z.string().min(1).max(300),
  eventId: z.string().min(1).max(1024),
  start: Iso,
  end: Iso,
  attendees: z.array(z.email()).max(20),
});
export const CalendarCancelPayload = z.strictObject({
  meetingId: z.uuid(),
  calendarId: z.string().min(1).max(300),
  eventId: z.string().min(1).max(1024),
  reason: z.string().max(500).optional(),
});

function parse<T>(schema: z.ZodType<T>, action: ExternalActionView): T {
  const r = schema.safeParse(action.payload);
  if (!r.success) throw new ValidationError(`Invalid ${action.actionType} payload: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  return r.data;
}

function meta(e: CalendarEvent): Record<string, string> {
  const m: Record<string, string> = { eventId: e.eventId, calendarId: e.calendarId, etag: e.etag, start: e.start, end: e.end, status: e.status };
  if (e.meetingUrl) m.meetingUrl = e.meetingUrl;
  return m;
}

/**
 * Bridges calendar ExternalActions to CALENDAR_WRITE through the gateway, pinned to the calendar the action was prepared
 * for. Right before booking or moving, availability is read again (docs/11 §66-72 execution-time availability check):
 * a slot taken meanwhile fails the action — never a double booking, never a fake confirmation. A lost response is
 * reconciled by looking the event up (by idempotency key, or by its current time).
 */
export function createCalendarExecutor(gateway: ProviderGateway): ActionExecutor {
  const request = (action: ExternalActionView, operation: string, capability: 'CALENDAR_READ' | 'CALENDAR_WRITE') => ({
    workspaceId: action.workspaceId,
    capability,
    operation,
    integrationId: action.providerAccountId ?? undefined,
    entity: { type: action.entityType, id: action.entityId },
  });

  const stillFree = async (action: ExternalActionView, calendarId: string, start: string, end: string, ignore?: { start: string; end: string }) => {
    const { value: busy } = await gateway.call(request(action, 'recheck_availability', 'CALENDAR_READ'), (cal, options) => cal.getBusy(calendarId, { start, end }, options));
    const s = Date.parse(start);
    const e = Date.parse(end);
    const clash = busy.filter((b) => Date.parse(b.start) < e && Date.parse(b.end) > s && !(ignore && b.start === ignore.start && b.end === ignore.end));
    if (clash.length) throw new ValidationError('That time is no longer free in the calendar — pick another slot');
  };

  return {
    async execute(action) {
      switch (action.actionType) {
        case CALENDAR_BOOK_ACTION: {
          const p = parse(CalendarBookPayload, action);
          // A retry after a lost response must not trip over its own event: look for it first.
          const { value: existing } = await gateway.call(request(action, 'find_event', 'CALENDAR_READ'), (cal, options) => cal.findEventByIdempotencyKey(action.idempotencyKey, options, p.calendarId));
          if (existing && existing.status === 'CONFIRMED') return { providerRef: existing.eventId, meta: meta(existing) };
          await stillFree(action, p.calendarId, p.start, p.end);
          const { value } = await gateway.call(request(action, 'create_event', 'CALENDAR_WRITE'), (cal, options) =>
            cal.createEvent({ calendarId: p.calendarId, title: p.title, description: p.description, start: p.start, end: p.end, timezone: p.timezone, attendees: p.attendees, videoLink: p.videoLink, idempotencyKey: action.idempotencyKey }, options),
          );
          return { providerRef: value.eventId, meta: meta(value) };
        }
        case CALENDAR_UPDATE_ACTION: {
          const p = parse(CalendarUpdatePayload, action);
          const { value: current } = await gateway.call(request(action, 'get_event', 'CALENDAR_READ'), (cal, options) => cal.getEvent(p.calendarId, p.eventId, options));
          if (!current || current.status === 'CANCELLED') throw new ValidationError('The calendar event no longer exists — book a new time instead');
          if (current.start === new Date(p.start).toISOString() && current.end === new Date(p.end).toISOString()) return { providerRef: current.eventId, meta: meta(current) };
          await stillFree(action, p.calendarId, p.start, p.end, { start: current.start, end: current.end });
          const { value } = await gateway.call(request(action, 'update_event', 'CALENDAR_WRITE'), (cal, options) => cal.updateEvent(p.calendarId, p.eventId, { start: p.start, end: p.end }, options));
          return { providerRef: value.eventId, meta: meta(value) };
        }
        case CALENDAR_CANCEL_ACTION: {
          const p = parse(CalendarCancelPayload, action);
          try {
            const { value } = await gateway.call(request(action, 'cancel_event', 'CALENDAR_WRITE'), (cal, options) => cal.cancelEvent(p.calendarId, p.eventId, options));
            return { providerRef: value.eventId, meta: meta(value) };
          } catch (err) {
            // Already removed in the calendar: the cancellation we wanted has happened.
            if ((err as { providerErrorKind?: string }).providerErrorKind === 'NOT_FOUND') return { providerRef: p.eventId, meta: { eventId: p.eventId, status: 'CANCELLED' } };
            throw err;
          }
        }
        default:
          throw new ValidationError(`Unknown calendar action ${action.actionType}`);
      }
    },

    async reconcile(action): Promise<ReconcileResult> {
      try {
        if (action.actionType === CALENDAR_BOOK_ACTION) {
          const p = action.payload as { calendarId?: string };
          const { value } = await gateway.call(request(action, 'find_event', 'CALENDAR_READ'), (cal, options) => cal.findEventByIdempotencyKey(action.idempotencyKey, options, p.calendarId));
          return value && value.status === 'CONFIRMED' ? { status: 'SUCCEEDED', providerRef: value.eventId } : { status: 'NOT_FOUND' };
        }
        const p = action.payload as { calendarId: string; eventId: string; start?: string };
        const { value } = await gateway.call(request(action, 'get_event', 'CALENDAR_READ'), (cal, options) => cal.getEvent(p.calendarId, p.eventId, options));
        if (action.actionType === CALENDAR_CANCEL_ACTION) return !value || value.status === 'CANCELLED' ? { status: 'SUCCEEDED', providerRef: p.eventId } : { status: 'NOT_FOUND' };
        return value && p.start && value.start === new Date(p.start).toISOString() ? { status: 'SUCCEEDED', providerRef: value.eventId } : { status: 'NOT_FOUND' };
      } catch {
        return { status: 'UNDETERMINED' };
      }
    },
  };
}
