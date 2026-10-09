import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { ProviderCallError } from '../core/errors.js';
import type { CalendarEvent, CalendarEventInput, CalendarProvider, CallOptions, CapabilityCheck, TimeRange } from '../core/interfaces.js';
import { FailureQueue, seededRandom, type FakeFailure } from './failures.js';

const HOUR = 3_600_000;

type StoredEvent = CalendarEvent & { idempotencyKey: string };

/** Where the test calendar keeps its events: memory for tests, Redis in dev so the API and the worker see one calendar. */
export interface FakeCalendarStore {
  save(event: StoredEvent): Promise<void>;
  get(eventId: string): Promise<StoredEvent | null>;
  byKey(idempotencyKey: string): Promise<StoredEvent | null>;
  all(): Promise<StoredEvent[]>;
}

export class MemoryCalendarStore implements FakeCalendarStore {
  private readonly events = new Map<string, StoredEvent>();
  async save(event: StoredEvent) {
    this.events.set(event.eventId, { ...event });
  }
  async get(eventId: string) {
    const e = this.events.get(eventId);
    return e ? { ...e } : null;
  }
  async byKey(key: string) {
    for (const e of this.events.values()) if (e.idempotencyKey === key) return { ...e };
    return null;
  }
  async all() {
    return [...this.events.values()].map((e) => ({ ...e }));
  }
}

export class RedisCalendarStore implements FakeCalendarStore {
  constructor(
    private readonly redis: Redis,
    /** e.g. `${queuePrefix}:fake-calendar:${integrationId}` */
    private readonly prefix: string,
  ) {}
  async save(event: StoredEvent) {
    await this.redis.multi().hset(`${this.prefix}:events`, event.eventId, JSON.stringify(event)).hset(`${this.prefix}:keys`, event.idempotencyKey, event.eventId).exec();
  }
  async get(eventId: string) {
    const raw = await this.redis.hget(`${this.prefix}:events`, eventId);
    return raw ? (JSON.parse(raw) as StoredEvent) : null;
  }
  async byKey(key: string) {
    const id = await this.redis.hget(`${this.prefix}:keys`, key);
    return id ? this.get(id) : null;
  }
  async all() {
    return Object.values(await this.redis.hgetall(`${this.prefix}:events`)).map((raw) => JSON.parse(raw) as StoredEvent);
  }
}

/**
 * A calendar with repeatable "existing meetings": on weekdays two one-hour busy blocks between 09:00 and 17:00 UTC,
 * chosen from the calendar id and date. Created events count as busy. A booking or move onto busy time is refused —
 * like a real calendar re-check right before booking (docs/12 §33). Nobody is invited; nothing leaves.
 */
export class FakeCalendarProvider implements CalendarProvider {
  readonly key = 'fake_calendar';
  private readonly failures = new FailureQueue();
  creates = 0;

  constructor(readonly store: FakeCalendarStore = new MemoryCalendarStore()) {}

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
    return (await this.busy(calendarId, start, end)).map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() }));
  }

  async createEvent(input: CalendarEventInput, { signal }: CallOptions): Promise<CalendarEvent> {
    const after = await this.failures.before(signal);
    const start = parse(input.start);
    const end = parse(input.end);
    if (end <= start) throw new ProviderCallError('INVALID_REQUEST', 'Fake calendar: event must end after it starts');
    if ((await this.busy(input.calendarId, start, end)).length > 0) throw new ProviderCallError('INVALID_REQUEST', 'Fake calendar: that time is no longer free');
    const eventId = `fake-evt-${randomUUID()}`;
    const event: StoredEvent = {
      eventId,
      calendarId: input.calendarId,
      title: input.title,
      attendees: input.attendees,
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
      status: 'CONFIRMED',
      etag: '1',
      meetingUrl: input.videoLink ? `https://meet.test-calendar.example/${eventId.slice(9, 21)}` : null,
      idempotencyKey: input.idempotencyKey,
    };
    await this.store.save(event);
    this.creates++;
    if (after === 'lost-response') FailureQueue.lost();
    return strip(event);
  }

  async updateEvent(calendarId: string, eventId: string, change: TimeRange & { title?: string }, { signal }: CallOptions): Promise<CalendarEvent> {
    const after = await this.failures.before(signal);
    const event = await this.store.get(eventId);
    if (!event || event.calendarId !== calendarId || event.status === 'CANCELLED') throw new ProviderCallError('NOT_FOUND', `Fake calendar: event ${eventId} not found`);
    const start = parse(change.start);
    const end = parse(change.end);
    if (end <= start) throw new ProviderCallError('INVALID_REQUEST', 'Fake calendar: event must end after it starts');
    if ((await this.busy(calendarId, start, end, eventId)).length > 0) throw new ProviderCallError('INVALID_REQUEST', 'Fake calendar: that time is no longer free');
    const moved: StoredEvent = { ...event, start: new Date(start).toISOString(), end: new Date(end).toISOString(), title: change.title ?? event.title, etag: String(Number(event.etag) + 1) };
    await this.store.save(moved);
    if (after === 'lost-response') FailureQueue.lost();
    return strip(moved);
  }

  async cancelEvent(calendarId: string, eventId: string, { signal }: CallOptions): Promise<CalendarEvent> {
    await this.failures.before(signal);
    const event = await this.store.get(eventId);
    if (!event || event.calendarId !== calendarId) throw new ProviderCallError('NOT_FOUND', `Fake calendar: event ${eventId} not found`);
    const cancelled: StoredEvent = { ...event, status: 'CANCELLED', etag: String(Number(event.etag) + 1) };
    await this.store.save(cancelled);
    return strip(cancelled);
  }

  async getEvent(calendarId: string, eventId: string, _options?: CallOptions) {
    const event = await this.store.get(eventId);
    return event && event.calendarId === calendarId ? strip(event) : null;
  }

  async findEventByIdempotencyKey(idempotencyKey: string, _options?: CallOptions) {
    const event = await this.store.byKey(idempotencyKey);
    return event ? strip(event) : null;
  }

  /** Test calendar only: someone changes the event in the calendar itself — reconciliation must notice. */
  async externalChange(eventId: string, change: { start?: string; end?: string; cancel?: boolean }): Promise<CalendarEvent | null> {
    const event = await this.store.get(eventId);
    if (!event) return null;
    const next: StoredEvent = { ...event, ...(change.start ? { start: change.start } : {}), ...(change.end ? { end: change.end } : {}), ...(change.cancel ? { status: 'CANCELLED' as const } : {}), etag: String(Number(event.etag) + 1) };
    await this.store.save(next);
    return strip(next);
  }

  private async busy(calendarId: string, start: number, end: number, exceptEventId?: string): Promise<[number, number][]> {
    const blocks: [number, number][] = [];
    for (let day = Math.floor(start / (24 * HOUR)) * 24 * HOUR; day < end; day += 24 * HOUR) {
      const weekday = new Date(day).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      const rand = seededRandom(`${calendarId}:${new Date(day).toISOString().slice(0, 10)}`);
      const first = 9 + Math.floor(rand() * 4); // 09–12
      const second = 13 + Math.floor(rand() * 4); // 13–16
      blocks.push([day + first * HOUR, day + (first + 1) * HOUR], [day + second * HOUR, day + (second + 1) * HOUR]);
    }
    for (const e of await this.store.all()) {
      if (e.calendarId === calendarId && e.status === 'CONFIRMED' && e.eventId !== exceptEventId) blocks.push([parse(e.start), parse(e.end)]);
    }
    return blocks.filter(([s, e]) => s < end && e > start).sort((a, b) => a[0] - b[0]);
  }
}

function parse(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new ProviderCallError('INVALID_REQUEST', `Fake calendar: invalid timestamp ${iso}`);
  return t;
}

function strip({ idempotencyKey: _key, ...event }: StoredEvent): CalendarEvent {
  return event;
}
