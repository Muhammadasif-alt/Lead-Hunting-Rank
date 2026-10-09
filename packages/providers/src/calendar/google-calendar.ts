import { createHash } from 'node:crypto';
import { ProviderCallError } from '../core/errors.js';
import type { CalendarEvent, CalendarEventInput, CalendarProvider, CallOptions, CapabilityCheck, TimeRange } from '../core/interfaces.js';

const API = 'https://www.googleapis.com/calendar/v3';
const TOKENINFO = 'https://oauth2.googleapis.com/tokeninfo';

/**
 * Minimum Calendar scopes (docs/12 §32-36): see free/busy time, and create / move / cancel the events we book. No
 * access to calendar settings, other people's calendars or deleting calendars.
 */
export const GOOGLE_CALENDAR_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.freebusy'];

export interface GoogleCalendarOptions {
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
}

/**
 * The event id we ask Google to use, derived from the idempotency key (base32hex: 0-9, a-v). Google refuses a second
 * event with the same id (409), so a retried booking can never create two events — and a lost response is reconciled
 * by simply reading this id.
 */
export function googleEventIdFor(idempotencyKey: string): string {
  return `ros${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 40)}`;
}

interface GEvent {
  id: string;
  status?: string;
  summary?: string;
  etag?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: { email: string }[];
  hangoutLink?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}

function toEvent(calendarId: string, e: GEvent): CalendarEvent {
  const video = e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ?? null;
  return {
    eventId: e.id,
    calendarId,
    title: e.summary ?? '',
    attendees: (e.attendees ?? []).map((a) => a.email.toLowerCase()),
    start: new Date(e.start?.dateTime ?? `${e.start?.date}T00:00:00Z`).toISOString(),
    end: new Date(e.end?.dateTime ?? `${e.end?.date}T00:00:00Z`).toISOString(),
    status: e.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED',
    etag: e.etag ?? '',
    meetingUrl: video,
  };
}

/**
 * Google Calendar through its REST API (docs/12 §32-36). Availability is read fresh (freeBusy) every time; events are
 * created with a deterministic id (idempotent), moved with PATCH and cancelled with DELETE — invitations are sent by
 * Google (sendUpdates=all). Vendor errors map onto the normalized taxonomy; a 5xx on a write is "outcome unknown".
 */
export class GoogleCalendarProvider implements CalendarProvider {
  readonly key = 'google_calendar';
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: GoogleCalendarOptions) {
    this.fetchFn = options.fetch ?? fetch;
  }

  private async request<T>(path: string, { signal }: CallOptions, init: RequestInit = {}, sideEffect = false): Promise<T | null> {
    const token = await this.options.getAccessToken();
    const res = await this.fetchFn(path.startsWith('http') ? path : `${API}${path}`, {
      ...init,
      signal,
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
    });
    if (res.status === 204) return null;
    if (res.ok) return (await res.json()) as T;
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
    const reason = body.error?.errors?.[0]?.reason ?? '';
    const detail = `Google Calendar ${res.status}${reason ? ` ${reason}` : ''}: ${body.error?.message ?? res.statusText}`.slice(0, 300);
    const retryAfter = Number(res.headers.get('retry-after'));
    const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
    if (res.status === 401) throw new ProviderCallError('AUTH_REQUIRED', detail);
    if (res.status === 429 || reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') throw new ProviderCallError('RATE_LIMITED', detail, { retryAfterMs });
    if (reason === 'dailyLimitExceeded' || reason === 'quotaExceeded') throw new ProviderCallError('QUOTA_EXCEEDED', detail, { retryAfterMs });
    if (res.status === 403) throw new ProviderCallError('PERMISSION_DENIED', detail);
    if (res.status === 404 || res.status === 410) throw new ProviderCallError('NOT_FOUND', detail);
    if (res.status === 409) throw Object.assign(new ProviderCallError('INVALID_REQUEST', detail), { duplicate: true });
    if (res.status >= 400 && res.status < 500) throw new ProviderCallError('INVALID_REQUEST', detail);
    throw new ProviderCallError(sideEffect ? 'UNKNOWN_OUTCOME' : 'UNAVAILABLE', detail);
  }

  async healthCheck(options: CallOptions): Promise<CapabilityCheck[]> {
    // Reads only: the token's scopes and the primary calendar. A health test never creates an event (docs/12 §118).
    const token = await this.options.getAccessToken();
    const info = await this.fetchFn(`${TOKENINFO}?access_token=${encodeURIComponent(token)}`, { signal: options.signal });
    const scopes = info.ok ? (((await info.json()) as { scope?: string }).scope ?? '') : '';
    const cal = await this.request<{ id: string }>('/users/me/calendarList/primary', options);
    const read = scopes.includes('calendar.freebusy') || /auth\/calendar(\s|$)/.test(scopes);
    const write = scopes.includes('calendar.events') || /auth\/calendar(\s|$)/.test(scopes);
    return [
      { capability: 'CALENDAR_READ', ok: read, detail: read ? `Free/busy readable for ${cal?.id ?? 'the primary calendar'}` : 'Free/busy permission not granted — reconnect' },
      { capability: 'CALENDAR_WRITE', ok: write, detail: write ? 'Event booking granted' : 'Event permission not granted — reconnect' },
    ];
  }

  async getBusy(calendarId: string, range: TimeRange, options: CallOptions): Promise<TimeRange[]> {
    const res = await this.request<{ calendars?: Record<string, { busy?: TimeRange[]; errors?: { reason?: string }[] }> }>('/freeBusy', options, {
      method: 'POST',
      body: JSON.stringify({ timeMin: range.start, timeMax: range.end, items: [{ id: calendarId }] }),
    });
    const cal = res?.calendars?.[calendarId];
    if (cal?.errors?.length) throw new ProviderCallError(cal.errors[0]?.reason === 'notFound' ? 'NOT_FOUND' : 'PERMISSION_DENIED', `Google Calendar can not read ${calendarId}: ${cal.errors[0]?.reason ?? 'error'}`);
    return (cal?.busy ?? []).map((b) => ({ start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString() }));
  }

  async createEvent(input: CalendarEventInput, options: CallOptions): Promise<CalendarEvent> {
    const id = googleEventIdFor(input.idempotencyKey);
    const body = {
      id,
      summary: input.title,
      description: input.description,
      start: { dateTime: input.start, ...(input.timezone ? { timeZone: input.timezone } : {}) },
      end: { dateTime: input.end, ...(input.timezone ? { timeZone: input.timezone } : {}) },
      attendees: input.attendees.map((email) => ({ email })),
      ...(input.videoLink ? { conferenceData: { createRequest: { requestId: id, conferenceSolutionKey: { type: 'hangoutsMeet' } } } } : {}),
    };
    try {
      const e = await this.request<GEvent>(`/calendars/${encodeURIComponent(input.calendarId)}/events?sendUpdates=all&conferenceDataVersion=1`, options, { method: 'POST', body: JSON.stringify(body) }, true);
      return toEvent(input.calendarId, e!);
    } catch (err) {
      // Same id already exists: an earlier attempt succeeded — return that event instead of creating a second one.
      if ((err as { duplicate?: boolean }).duplicate) {
        const existing = await this.getEvent(input.calendarId, id, options);
        if (existing) return existing;
      }
      throw err;
    }
  }

  async updateEvent(calendarId: string, eventId: string, change: TimeRange & { title?: string }, options: CallOptions): Promise<CalendarEvent> {
    const e = await this.request<GEvent>(
      `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      options,
      { method: 'PATCH', body: JSON.stringify({ start: { dateTime: change.start }, end: { dateTime: change.end }, ...(change.title ? { summary: change.title } : {}) }) },
      true,
    );
    return toEvent(calendarId, e!);
  }

  async cancelEvent(calendarId: string, eventId: string, options: CallOptions): Promise<CalendarEvent> {
    try {
      await this.request(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, options, { method: 'DELETE' }, true);
    } catch (err) {
      // Already gone (deleted in Google) is the outcome we wanted.
      if (!(err instanceof ProviderCallError && err.kind === 'NOT_FOUND')) throw err;
    }
    const after = await this.getEvent(calendarId, eventId, options);
    return after ? { ...after, status: 'CANCELLED' } : { eventId, calendarId, title: '', attendees: [], start: new Date(0).toISOString(), end: new Date(0).toISOString(), status: 'CANCELLED', etag: '' };
  }

  async getEvent(calendarId: string, eventId: string, options: CallOptions): Promise<CalendarEvent | null> {
    try {
      const e = await this.request<GEvent>(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, options);
      return e ? toEvent(calendarId, e) : null;
    } catch (err) {
      if (err instanceof ProviderCallError && err.kind === 'NOT_FOUND') return null;
      throw err;
    }
  }

  async findEventByIdempotencyKey(idempotencyKey: string, options: CallOptions, calendarId = 'primary'): Promise<CalendarEvent | null> {
    return this.getEvent(calendarId, googleEventIdFor(idempotencyKey), options);
  }
}
