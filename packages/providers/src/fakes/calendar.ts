import { randomUUID } from 'node:crypto';
import { ProviderCallError } from '../core/errors.js';
import type { CalendarEvent, CalendarEventInput, CalendarProvider, CallOptions, CapabilityCheck, TimeRange } from '../core/interfaces.js';
import { FailureQueue, seededRandom, type FakeFailure } from './failures.js';

const HOUR = 3_600_000;

/**
 * A calendar with repeatable "existing meetings": on weekdays two one-hour busy blocks between 09:00 and 17:00 UTC,
 * chosen from the calendar id and date. Created events are kept in memory and count as busy. A booking that overlaps
 * a busy block is refused — like a real calendar re-check right before booking (docs/12 §33).
 */
export class FakeCalendarProvider implements CalendarProvider {
  readonly key = 'fake_calendar';
  private readonly failures = new FailureQueue();
  private readonly events = new Map<string, CalendarEvent & { idempotencyKey: string }>();
  creates = 0;

  failNext(...failures: FakeFailure[]): this {
    this.failures.push(...failures);
    return this;
  }

  async healthCheck(): Promise<CapabilityCheck[]> {
    return [
      { capability: 'CALENDAR_READ', ok: true, detail: 'Availability readable (test calendar)' },
      { capability: 'CALENDAR_WRITE', ok: true, detail: 'Event creation granted (test calendar)' },
    ];
  }

  async getBusy(calendarId: string, range: TimeRange, { signal }: CallOptions): Promise<TimeRange[]> {
    await this.failures.before(signal);
    const start = parse(range.start);
    const end = parse(range.end);
    if (end <= start || end - start > 62 * 24 * HOUR) throw new ProviderCallError('INVALID_REQUEST', 'Fake calendar: range must be positive and at most 62 days');
    return this.busy(calendarId, start, end).map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() }));
  }

  async createEvent(input: CalendarEventInput, { signal }: CallOptions): Promise<CalendarEvent> {
    const after = await this.failures.before(signal);
    const start = parse(input.start);
    const end = parse(input.end);
    if (end <= start) throw new ProviderCallError('INVALID_REQUEST', 'Fake calendar: event must end after it starts');
    if (this.busy(input.calendarId, start, end).length > 0) throw new ProviderCallError('INVALID_REQUEST', 'Fake calendar: that time is no longer free');
    const event = { ...input, eventId: `fake-evt-${randomUUID()}`, status: 'CONFIRMED' as const, etag: '1' };
    this.events.set(event.eventId, event);
    this.creates++;
    if (after === 'lost-response') FailureQueue.lost();
    return strip(event);
  }

  async cancelEvent(calendarId: string, eventId: string, { signal }: CallOptions): Promise<CalendarEvent> {
    await this.failures.before(signal);
    const event = this.events.get(eventId);
    if (!event || event.calendarId !== calendarId) throw new ProviderCallError('NOT_FOUND', `Fake calendar: event ${eventId} not found`);
    event.status = 'CANCELLED';
    event.etag = String(Number(event.etag) + 1);
    return strip(event);
  }

  async getEvent(calendarId: string, eventId: string, _options?: CallOptions) {
    const event = this.events.get(eventId);
    return event && event.calendarId === calendarId ? strip(event) : null;
  }

  async findEventByIdempotencyKey(idempotencyKey: string, _options?: CallOptions) {
    for (const event of this.events.values()) if (event.idempotencyKey === idempotencyKey) return strip(event);
    return null;
  }

  private busy(calendarId: string, start: number, end: number): [number, number][] {
    const blocks: [number, number][] = [];
    for (let day = Math.floor(start / (24 * HOUR)) * 24 * HOUR; day < end; day += 24 * HOUR) {
      const weekday = new Date(day).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const rand = seededRandom(`${calendarId}:${new Date(day).toISOString().slice(0, 10)}`);
      const first = 9 + Math.floor(rand() * 4); // 09–12
      const second = 13 + Math.floor(rand() * 4); // 13–16
      blocks.push([day + first * HOUR, day + (first + 1) * HOUR], [day + second * HOUR, day + (second + 1) * HOUR]);
    }
    for (const e of this.events.values()) {
      if (e.calendarId === calendarId && e.status === 'CONFIRMED') blocks.push([parse(e.start), parse(e.end)]);
    }
    return blocks.filter(([s, e]) => s < end && e > start).sort((a, b) => a[0] - b[0]);
  }
}

function parse(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new ProviderCallError('INVALID_REQUEST', `Fake calendar: invalid timestamp ${iso}`);
  return t;
}

function strip({ idempotencyKey: _key, description: _d, ...event }: CalendarEvent & { idempotencyKey: string; description?: string }): CalendarEvent {
  return event;
}
