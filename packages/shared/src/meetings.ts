/**
 * Calendar + meetings (docs/17 §93-98, screen #8). Browser-safe: labels, timezone handling, reading a prospect's time
 * preference ("Thursday afternoon"), finding genuinely free slots from calendar busy blocks and the owner's rules, and
 * recognising which offered slot they picked. All deterministic — the AI never invents a time.
 */

export const MEETING_STATUSES = ['PROPOSED', 'PENDING_CONFIRMATION', 'BOOKED', 'RESCHEDULING', 'COMPLETED', 'NO_SHOW', 'CANCELLED'] as const;
export type MeetingStatusKey = (typeof MEETING_STATUSES)[number];
export const MEETING_STATUS_INFO: Record<MeetingStatusKey, { label: string; description: string }> = {
  PROPOSED: { label: 'Being scheduled', description: 'They want to meet — free times found, nothing offered or booked yet' },
  PENDING_CONFIRMATION: { label: 'Waiting', description: 'Times offered, or a booking waiting for the calendar or an approval' },
  BOOKED: { label: 'Booked', description: 'Confirmed by the calendar (or recorded by a person)' },
  RESCHEDULING: { label: 'Moving', description: 'A new time is waiting for the calendar — the old time still stands' },
  COMPLETED: { label: 'Completed', description: 'It happened — outcome recorded' },
  NO_SHOW: { label: 'No-show', description: 'They did not attend — not a lost deal' },
  CANCELLED: { label: 'Cancelled', description: 'Cancelled, with who and why — not a lost deal' },
};

export const MEETING_OUTCOMES = ['ADVANCED', 'NO_CHANGE', 'FOLLOW_UP', 'NURTURE', 'DISQUALIFIED', 'LOST', 'NO_SHOW'] as const;
export type MeetingOutcomeKey = (typeof MEETING_OUTCOMES)[number];
export const MEETING_OUTCOME_INFO: Record<MeetingOutcomeKey, { label: string; description: string }> = {
  ADVANCED: { label: 'Advanced', description: 'The deal moved forward' },
  NO_CHANGE: { label: 'No change', description: 'Useful, but nothing moved' },
  FOLLOW_UP: { label: 'Needs follow-up', description: 'Something to send or another meeting' },
  NURTURE: { label: 'Nurture', description: 'Not now — come back later' },
  DISQUALIFIED: { label: 'Disqualified', description: 'Not a fit' },
  LOST: { label: 'Lost', description: 'They decided against it' },
  NO_SHOW: { label: 'No-show', description: 'They did not attend' },
};

export const MEETING_QUALIFICATION_RULES = ['NONE', 'NEED', 'QUALIFIED'] as const;
export type MeetingQualificationRuleKey = (typeof MEETING_QUALIFICATION_RULES)[number];
export const MEETING_QUALIFICATION_INFO: Record<MeetingQualificationRuleKey, string> = {
  NONE: 'Anyone who asks',
  NEED: 'A stated need',
  QUALIFIED: 'A qualified deal',
};

export const MEETING_LOCATIONS = ['VIDEO', 'PHONE', 'IN_PERSON'] as const;
export type MeetingLocation = (typeof MEETING_LOCATIONS)[number];
export const MEETING_LOCATION_INFO: Record<MeetingLocation, string> = { VIDEO: 'Video call', PHONE: 'Phone call', IN_PERSON: 'In person' };

export const CANCEL_SOURCES = ['PROSPECT', 'TEAM', 'SYSTEM', 'PROVIDER', 'MANUAL'] as const;
export type CancelSource = (typeof CANCEL_SOURCES)[number];

export const MEETING_CHANGE_INFO: Record<string, string> = {
  PROPOSED: 'Meeting requested — free times found',
  OFFERED: 'Times offered',
  BOOKING_REQUESTED: 'Booking requested',
  BOOKED: 'Booked',
  BOOKING_FAILED: 'Booking not confirmed',
  RESCHEDULE_REQUESTED: 'New time requested',
  RESCHEDULED: 'Moved',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  NO_SHOW: 'No-show',
  CALENDAR_CHANGED: 'Changed in the calendar',
  CALENDAR_DELETED: 'Removed from the calendar',
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

// ───────────────────────────── timezones ─────────────────────────────

export function isTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** [timezone, single zone?] — states that span two zones get the main one at MEDIUM confidence. */
const US_STATES: Record<string, [string, boolean, string]> = {
  AL: ['America/Chicago', true, 'alabama'], AK: ['America/Anchorage', true, 'alaska'], AZ: ['America/Phoenix', true, 'arizona'], AR: ['America/Chicago', true, 'arkansas'],
  CA: ['America/Los_Angeles', true, 'california'], CO: ['America/Denver', true, 'colorado'], CT: ['America/New_York', true, 'connecticut'], DE: ['America/New_York', true, 'delaware'],
  DC: ['America/New_York', true, 'district of columbia'], FL: ['America/New_York', false, 'florida'], GA: ['America/New_York', true, 'georgia'], HI: ['Pacific/Honolulu', true, 'hawaii'],
  ID: ['America/Boise', false, 'idaho'], IL: ['America/Chicago', true, 'illinois'], IN: ['America/Indiana/Indianapolis', false, 'indiana'], IA: ['America/Chicago', true, 'iowa'],
  KS: ['America/Chicago', false, 'kansas'], KY: ['America/New_York', false, 'kentucky'], LA: ['America/Chicago', true, 'louisiana'], ME: ['America/New_York', true, 'maine'],
  MD: ['America/New_York', true, 'maryland'], MA: ['America/New_York', true, 'massachusetts'], MI: ['America/Detroit', false, 'michigan'], MN: ['America/Chicago', true, 'minnesota'],
  MS: ['America/Chicago', true, 'mississippi'], MO: ['America/Chicago', true, 'missouri'], MT: ['America/Denver', true, 'montana'], NE: ['America/Chicago', false, 'nebraska'],
  NV: ['America/Los_Angeles', true, 'nevada'], NH: ['America/New_York', true, 'new hampshire'], NJ: ['America/New_York', true, 'new jersey'], NM: ['America/Denver', true, 'new mexico'],
  NY: ['America/New_York', true, 'new york'], NC: ['America/New_York', true, 'north carolina'], ND: ['America/Chicago', false, 'north dakota'], OH: ['America/New_York', true, 'ohio'],
  OK: ['America/Chicago', true, 'oklahoma'], OR: ['America/Los_Angeles', false, 'oregon'], PA: ['America/New_York', true, 'pennsylvania'], RI: ['America/New_York', true, 'rhode island'],
  SC: ['America/New_York', true, 'south carolina'], SD: ['America/Chicago', false, 'south dakota'], TN: ['America/Chicago', false, 'tennessee'], TX: ['America/Chicago', false, 'texas'],
  UT: ['America/Denver', true, 'utah'], VT: ['America/New_York', true, 'vermont'], VA: ['America/New_York', true, 'virginia'], WA: ['America/Los_Angeles', true, 'washington'],
  WV: ['America/New_York', true, 'west virginia'], WI: ['America/Chicago', true, 'wisconsin'], WY: ['America/Denver', true, 'wyoming'],
};
const CA_PROVINCES: Record<string, [string, boolean, string]> = {
  ON: ['America/Toronto', true, 'ontario'], QC: ['America/Toronto', true, 'quebec'], BC: ['America/Vancouver', true, 'british columbia'], AB: ['America/Edmonton', true, 'alberta'],
  MB: ['America/Winnipeg', true, 'manitoba'], SK: ['America/Regina', true, 'saskatchewan'], NS: ['America/Halifax', true, 'nova scotia'], NB: ['America/Moncton', true, 'new brunswick'],
  NL: ['America/St_Johns', true, 'newfoundland and labrador'], PE: ['America/Halifax', true, 'prince edward island'],
};
const AU_STATES: Record<string, [string, boolean, string]> = {
  NSW: ['Australia/Sydney', true, 'new south wales'], VIC: ['Australia/Melbourne', true, 'victoria'], QLD: ['Australia/Brisbane', true, 'queensland'], SA: ['Australia/Adelaide', true, 'south australia'],
  WA: ['Australia/Perth', true, 'western australia'], TAS: ['Australia/Hobart', true, 'tasmania'], NT: ['Australia/Darwin', true, 'northern territory'], ACT: ['Australia/Sydney', true, 'australian capital territory'],
};
const COUNTRIES: Record<string, [string, boolean]> = {
  GB: ['Europe/London', true], IE: ['Europe/Dublin', true], DE: ['Europe/Berlin', true], FR: ['Europe/Paris', true], ES: ['Europe/Madrid', false], IT: ['Europe/Rome', true],
  NL: ['Europe/Amsterdam', true], BE: ['Europe/Brussels', true], PT: ['Europe/Lisbon', false], SE: ['Europe/Stockholm', true], NO: ['Europe/Oslo', true], DK: ['Europe/Copenhagen', true],
  FI: ['Europe/Helsinki', true], PL: ['Europe/Warsaw', true], CH: ['Europe/Zurich', true], AT: ['Europe/Vienna', true], AU: ['Australia/Sydney', false], NZ: ['Pacific/Auckland', true],
  IN: ['Asia/Kolkata', true], PK: ['Asia/Karachi', true], AE: ['Asia/Dubai', true], SA: ['Asia/Riyadh', true], SG: ['Asia/Singapore', true], ZA: ['Africa/Johannesburg', true],
  US: ['America/New_York', false], CA: ['America/Toronto', false], MX: ['America/Mexico_City', false], BR: ['America/Sao_Paulo', false],
};

function lookupRegion(table: Record<string, [string, boolean, string]>, region: string): [string, boolean] | null {
  const r = region.trim().toLowerCase();
  const byCode = table[r.toUpperCase()];
  if (byCode) return [byCode[0], byCode[1]];
  const byName = Object.values(table).find((v) => v[2] === r);
  return byName ? [byName[0], byName[1]] : null;
}

export interface TimezoneGuess {
  timezone: string;
  /** PERSON (stored on the contact) / BUSINESS_LOCATION / WORKSPACE_DEFAULT */
  source: 'PERSON' | 'BUSINESS_LOCATION' | 'WORKSPACE_DEFAULT';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
}

/**
 * The prospect's timezone (screen #8 §4): a stored timezone on the contact wins; otherwise the business location
 * (Austin, Texas → America/Chicago); otherwise the workspace default at LOW confidence — then the offer asks them to
 * confirm instead of assuming.
 */
export function inferTimezone(input: { personTimezone?: string | null; region?: string | null; country?: string | null; city?: string | null }, fallback: string): TimezoneGuess {
  if (isTimezone(input.personTimezone)) return { timezone: input.personTimezone, source: 'PERSON', confidence: 'HIGH', reason: 'Saved on the contact' };
  const country = (input.country ?? '').trim().toUpperCase();
  const place = [input.city, input.region].filter(Boolean).join(', ');
  if (input.region && (!country || country === 'US' || country === 'CA')) {
    const hit = (country !== 'CA' && lookupRegion(US_STATES, input.region)) || ((country === 'CA' || !country) && lookupRegion(CA_PROVINCES, input.region));
    if (hit) return { timezone: hit[0], source: 'BUSINESS_LOCATION', confidence: hit[1] ? 'HIGH' : 'MEDIUM', reason: `Business location: ${place}${hit[1] ? '' : ' (the region spans more than one time zone)'}` };
  }
  if (input.region && country === 'AU') {
    const hit = lookupRegion(AU_STATES, input.region);
    if (hit) return { timezone: hit[0], source: 'BUSINESS_LOCATION', confidence: 'HIGH', reason: `Business location: ${place}` };
  }
  const c = COUNTRIES[country];
  if (c) return { timezone: c[0], source: 'BUSINESS_LOCATION', confidence: c[1] ? 'HIGH' : 'LOW', reason: `Business country: ${country}${c[1] ? '' : ' (more than one time zone)'}` };
  const tz = isTimezone(fallback) ? fallback : 'UTC';
  return { timezone: tz, source: 'WORKSPACE_DEFAULT', confidence: 'LOW', reason: 'Location unknown — using the workspace time zone; ask them to confirm' };
}

const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local date (YYYY-MM-DD), weekday (0 = Sunday) and minute of the day in `tz`. */
export function zonedParts(d: Date, tz: string): { date: string; weekday: number; minute: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, weekday: WD[p.weekday!]!, minute: Number(p.hour) * 60 + Number(p.minute) };
}

/** "Central Time" (or the IANA name when the runtime can't name it). */
export function timezoneLabel(tz: string, at = new Date()): string {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value;
    return name ?? tz;
  } catch {
    return tz;
  }
}

/** "Thursday, October 15 at 1:00 PM" in `tz` (with " CDT" when `withZone`). */
export function formatSlot(iso: string | Date, tz: string, withZone = false): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', ...(withZone ? { timeZoneName: 'short' } : {}) }).format(d);
  return `${day} at ${time}`;
}

// ───────────────────────────── what they asked for ─────────────────────────────

export type DayPart = 'MORNING' | 'AFTERNOON' | 'EVENING';
const PARTS: Record<DayPart, [number, number]> = { MORNING: [8 * 60, 12 * 60], AFTERNOON: [12 * 60, 17 * 60], EVENING: [17 * 60, 20 * 60] };

export interface MeetingPreference {
  /** Weekdays they named (0 = Sunday). */
  days: number[];
  /** Local dates (YYYY-MM-DD, prospect timezone) for "today" / "tomorrow". */
  dates: string[];
  part: DayPart | null;
  week: 'THIS' | 'NEXT' | null;
  /** "after 2" / "before 11" — minutes of the day in their timezone. */
  afterMinute: number | null;
  beforeMinute: number | null;
  label: string;
}

const DAY_WORDS: [RegExp, number][] = [
  [/\bsun(day)?s?\b/i, 0],
  [/\bmon(day)?s?\b/i, 1],
  [/\btue(s|sday)?s?\b/i, 2],
  [/\bwed(nesday)?s?\b/i, 3],
  [/\bthu(rs|rsday)?s?\b/i, 4],
  [/\bfri(day)?s?\b/i, 5],
  [/\bsat(urday)?s?\b/i, 6],
];

function hourOf(h: string, ampm: string | undefined): number {
  let hour = Number(h) % 12;
  if (ampm?.toLowerCase().startsWith('p')) hour += 12;
  else if (!ampm && hour >= 1 && hour <= 7) hour += 12; // "after 2" during business hours means 2 PM
  return hour;
}

/**
 * Reads when they would like to meet: "Thursday afternoon works", "tomorrow morning", "next week after 2pm". Null when
 * they named no time at all — then any free time is offered.
 */
export function parseMeetingPreference(text: string, now: Date, tz: string): MeetingPreference | null {
  const t = text.toLowerCase();
  const days = DAY_WORDS.filter(([re]) => re.test(t)).map(([, d]) => d);
  const dates: string[] = [];
  if (/\btoday\b/.test(t)) dates.push(zonedParts(now, tz).date);
  if (/\btomorrow\b/.test(t)) dates.push(zonedParts(new Date(now.getTime() + 86_400_000), tz).date);
  const part: DayPart | null = /\bmornings?\b/.test(t) ? 'MORNING' : /\bafternoons?\b/.test(t) ? 'AFTERNOON' : /\bevenings?\b/.test(t) ? 'EVENING' : null;
  const week = /\bnext week\b/.test(t) ? 'NEXT' : /\bthis week\b/.test(t) ? 'THIS' : null;
  const after = /\bafter (\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/.exec(t);
  const before = /\bbefore (\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/.exec(t);
  const afterMinute = after ? hourOf(after[1]!, after[3]) * 60 + Number(after[2] ?? 0) : null;
  const beforeMinute = before ? hourOf(before[1]!, before[3]) * 60 + Number(before[2] ?? 0) : null;
  if (!days.length && !dates.length && !part && !week && afterMinute === null && beforeMinute === null) return null;
  const bits = [
    dates.length ? (/\btomorrow\b/.test(t) ? 'tomorrow' : 'today') : '',
    days.map((d) => WEEKDAYS[d]).join(' or '),
    part ? part.toLowerCase() : '',
    week === 'NEXT' ? 'next week' : week === 'THIS' ? 'this week' : '',
    afterMinute !== null ? `after ${fmtMinute(afterMinute)}` : '',
    beforeMinute !== null ? `before ${fmtMinute(beforeMinute)}` : '',
  ].filter(Boolean);
  return { days, dates, part, week, afterMinute, beforeMinute, label: bits.join(' ') };
}

function fmtMinute(m: number): string {
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${h % 12 || 12}${min ? `:${String(min).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ───────────────────────────── free slots ─────────────────────────────

export interface AvailabilityRules {
  /** The owner's timezone — working hours are theirs. */
  timezone: string;
  workingDays: number[];
  meetingStartMinute: number;
  meetingEndMinute: number;
  lunchStartMinute: number | null;
  lunchEndMinute: number | null;
  bufferMinutes: number;
  maxMeetingsPerDay: number;
  minNoticeMinutes: number;
  unavailableUntil?: string | Date | null;
}

export interface TimeSlot {
  start: string;
  end: string;
}

export interface SlotQuery {
  rules: AvailabilityRules;
  durationMinutes: number;
  /** The meeting type's buffer; the larger of it and the owner's applies. */
  bufferMinutes: number;
  from: Date;
  to: Date;
  /** Busy time from the calendar (fresh) plus our own booked meetings. */
  busy: TimeSlot[];
  /** Meetings already booked per owner-local date. */
  bookedPerDay: Record<string, number>;
  prospectTimezone: string;
  preference?: MeetingPreference | null;
  now: Date;
  limit?: number;
}

export interface SlotResult {
  slots: TimeSlot[];
  /** False when nothing matched what they asked for and other free times are offered instead. */
  preferenceMatched: boolean;
  /** Why nothing could be offered, in plain words. */
  reason: string | null;
}

const STEP = 15 * 60_000;
/** Never offer a prospect a time outside 8 AM – 6 PM their time (screen #8 §4 — no 6 AM calls by accident). */
const PROSPECT_DAY: [number, number] = [8 * 60, 18 * 60];

function matchesPreference(start: Date, end: Date, tz: string, p: MeetingPreference, now: Date): boolean {
  const s = zonedParts(start, tz);
  const e = zonedParts(end, tz);
  if (p.dates.length && !p.dates.includes(s.date)) return false;
  if (p.days.length && !p.days.includes(s.weekday)) return false;
  if (p.part) {
    const [a, b] = PARTS[p.part];
    if (s.minute < a || e.minute > b) return false;
  }
  if (p.afterMinute !== null && s.minute < p.afterMinute) return false;
  if (p.beforeMinute !== null && e.minute > p.beforeMinute) return false;
  if (p.week) {
    const today = zonedParts(now, tz);
    const daysAhead = Math.round((Date.parse(`${s.date}T00:00:00Z`) - Date.parse(`${today.date}T00:00:00Z`)) / 86_400_000);
    const toWeekEnd = 7 - (today.weekday === 0 ? 7 : today.weekday); // days left until Sunday
    if (p.week === 'THIS' && daysAhead > toWeekEnd) return false;
    if (p.week === 'NEXT' && (daysAhead <= toWeekEnd || daysAhead > toWeekEnd + 7)) return false;
  }
  return true;
}

/**
 * Genuinely free slots (screen #8 §3, §5, §12): inside the owner's working days and meeting hours, not over lunch, not
 * within the buffer of anything busy, under the daily meeting cap, after the minimum notice, inside a sensible part of
 * the prospect's day — and, when possible, matching what they asked for. Slots are spread out (at most two a day
 * unless they asked for a specific day). Pure: the caller fetches busy time fresh from the calendar.
 */
export function findSlots(q: SlotQuery): SlotResult {
  const r = q.rules;
  const limit = q.limit ?? 3;
  const buffer = Math.max(q.bufferMinutes, r.bufferMinutes) * 60_000;
  const duration = q.durationMinutes * 60_000;
  const away = r.unavailableUntil ? new Date(r.unavailableUntil).getTime() : 0;
  const earliest = Math.max(q.from.getTime(), q.now.getTime() + r.minNoticeMinutes * 60_000, away);
  const busy = q.busy.map((b) => [Date.parse(b.start) - buffer, Date.parse(b.end) + buffer] as const);
  const candidates: { start: Date; end: Date; ownerDate: string }[] = [];
  let outsideTheirDay = 0;
  for (let t = Math.ceil(earliest / STEP) * STEP; t + duration <= q.to.getTime() && candidates.length < 400; t += STEP) {
    const start = new Date(t);
    const end = new Date(t + duration);
    const o = zonedParts(start, r.timezone);
    if (o.minute % 30 !== 0 || !r.workingDays.includes(o.weekday)) continue;
    const oe = zonedParts(end, r.timezone);
    if (oe.date !== o.date || o.minute < r.meetingStartMinute || oe.minute > r.meetingEndMinute) continue;
    if (r.lunchStartMinute !== null && r.lunchEndMinute !== null && o.minute < r.lunchEndMinute && oe.minute > r.lunchStartMinute) continue;
    if ((q.bookedPerDay[o.date] ?? 0) >= r.maxMeetingsPerDay) continue;
    if (busy.some(([bs, be]) => t < be && t + duration > bs)) continue;
    const p = zonedParts(start, q.prospectTimezone);
    const pe = zonedParts(end, q.prospectTimezone);
    if (p.minute < PROSPECT_DAY[0] || pe.minute > PROSPECT_DAY[1] || pe.date !== p.date) {
      outsideTheirDay++;
      continue;
    }
    candidates.push({ start, end, ownerDate: o.date });
  }
  if (!candidates.length) {
    return {
      slots: [],
      preferenceMatched: false,
      reason: outsideTheirDay
        ? 'The meeting hours never fall inside their business day (8 AM–6 PM their time) — widen the hours, ask a colleague in a closer time zone, or agree a time with them directly'
        : 'No free time in the next two weeks inside the working hours and rules',
    };
  }

  const pick = (pool: typeof candidates, perDay: number) => {
    const chosen: typeof candidates = [];
    for (const c of pool) {
      const sameDay = chosen.filter((x) => x.ownerDate === c.ownerDate);
      if (sameDay.length >= perDay || sameDay.some((x) => Math.abs(x.start.getTime() - c.start.getTime()) < 60 * 60_000)) continue;
      chosen.push(c);
      if (chosen.length >= limit) break;
    }
    return chosen.map((c) => ({ start: c.start.toISOString(), end: c.end.toISOString() }));
  };
  const p = q.preference;
  if (p) {
    const matching = candidates.filter((c) => matchesPreference(c.start, c.end, q.prospectTimezone, p, q.now));
    if (matching.length) return { slots: pick(matching, p.days.length === 1 || p.dates.length === 1 ? limit : 2), preferenceMatched: true, reason: null };
  }
  return { slots: pick(candidates, 2), preferenceMatched: !p, reason: p ? `Nothing free for “${p.label}” — offering the nearest free times instead` : null };
}

// ───────────────────────────── which slot they picked ─────────────────────────────

const DECLINE = /\b(none of (those|these|them)|neither|(don'?t|doesn'?t|do not|does not|won'?t) work|can'?t (do|make)|not available|busy then|other times?)\b/i;

/**
 * Which offered slot they chose ("Thursday at 2:30 works", "the first one", "2pm is good"). Returns the slot only when
 * exactly one fits — otherwise null and a person (or another round of times) takes over. Never guesses.
 */
export function matchChosenSlot(text: string, slots: TimeSlot[], tz: string): TimeSlot | null {
  if (!slots.length || DECLINE.test(text)) return null;
  const t = text.toLowerCase();
  const ordinal = /\b(first|1st|second|2nd|third|3rd|last) (one|option|slot|time)\b/.exec(t) ?? /\boption (1|2|3|one|two|three)\b/.exec(t);
  if (ordinal) {
    const w = ordinal[1]!;
    const i = /first|1st|^1$|one/.test(w) ? 0 : /second|2nd|^2$|two/.test(w) ? 1 : /third|3rd|^3$|three/.test(w) ? 2 : slots.length - 1;
    return slots[i] ?? null;
  }
  const days = DAY_WORDS.filter(([re]) => re.test(t)).map(([, d]) => d);
  const times = [...t.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?(?=\b|\s|$)/g)]
    .filter((m) => m[2] !== undefined || m[3] !== undefined || /\bat\s*$/.test(t.slice(0, m.index)))
    .map((m) => hourOf(m[1]!, m[3]) * 60 + Number(m[2] ?? 0));
  if (!days.length && !times.length) return null;
  const fits = slots.filter((s) => {
    const p = zonedParts(new Date(s.start), tz);
    if (days.length && !days.includes(p.weekday)) return false;
    if (times.length && !times.includes(p.minute)) return false;
    return true;
  });
  return fits.length === 1 ? fits[0]! : null;
}

/** The message that offers times (a person sends it — or edits it first). */
export function offerMessage(slots: TimeSlot[], tz: string, opts: { firstName?: string | null; meetingName: string; durationMinutes: number; confirmTimezone: boolean }): string {
  const zone = timezoneLabel(tz, slots[0] ? new Date(slots[0].start) : new Date());
  const lines = slots.map((s) => `• ${formatSlot(s.start, tz)}`);
  return [
    `${opts.firstName ? `Hi ${opts.firstName},` : 'Hi,'}`,
    '',
    `Happy to set up a ${opts.durationMinutes}-minute ${opts.meetingName.toLowerCase()}. These times are free on our side (${zone}):`,
    ...lines,
    '',
    `Just reply with the one that suits you and I'll send a calendar invite.${opts.confirmTimezone ? ` If you're not on ${zone}, tell me your time zone and I'll adjust.` : ''}`,
  ].join('\n');
}
