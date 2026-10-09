import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { findSlots, inferTimezone, matchChosenSlot, offerMessage, parseMeetingPreference, zonedParts, type AvailabilityRules } from './meetings.js';

const NOW = new Date('2026-10-07T10:00:00.000Z'); // Wednesday, 5 AM in Austin
const CHICAGO = 'America/Chicago';
const RULES: AvailabilityRules = {
  timezone: CHICAGO,
  workingDays: [1, 2, 3, 4, 5],
  meetingStartMinute: 10 * 60,
  meetingEndMinute: 16 * 60,
  lunchStartMinute: 12 * 60 + 30,
  lunchEndMinute: 13 * 60 + 30,
  bufferMinutes: 15,
  maxMeetingsPerDay: 5,
  minNoticeMinutes: 240,
};
const base = { rules: RULES, durationMinutes: 30, bufferMinutes: 15, from: NOW, to: new Date(NOW.getTime() + 14 * 86_400_000), busy: [], bookedPerDay: {}, prospectTimezone: CHICAGO, now: NOW };

describe('timezone — never a silent guess', () => {
  test('business location gives the zone; a two-zone state is only MEDIUM; unknown falls back at LOW', () => {
    assert.deepEqual(
      { tz: inferTimezone({ region: 'TX', city: 'Austin' }, 'UTC').timezone, c: inferTimezone({ region: 'TX', city: 'Austin' }, 'UTC').confidence },
      { tz: CHICAGO, c: 'MEDIUM' },
    );
    assert.equal(inferTimezone({ region: 'California', country: 'US' }, 'UTC').confidence, 'HIGH');
    assert.equal(inferTimezone({ region: 'California', country: 'US' }, 'UTC').timezone, 'America/Los_Angeles');
    const unknown = inferTimezone({}, 'Europe/London');
    assert.equal(unknown.source, 'WORKSPACE_DEFAULT');
    assert.equal(unknown.confidence, 'LOW');
    assert.equal(inferTimezone({ personTimezone: 'America/Denver', region: 'TX' }, 'UTC').source, 'PERSON');
    assert.equal(inferTimezone({ region: 'SA', country: 'AU', city: 'Birdwood' }, 'UTC').timezone, 'Australia/Adelaide');
  });
  test('hours that never meet their business day are said plainly — no 3 AM offers', () => {
    const r = findSlots({ ...base, prospectTimezone: 'Australia/Adelaide' });
    assert.equal(r.slots.length, 0);
    assert.match(r.reason ?? '', /never fall inside their business day/);
  });
});

describe('what they asked for', () => {
  test('"Thursday afternoon works for me"', () => {
    const p = parseMeetingPreference('Thursday afternoon works for me.', NOW, CHICAGO);
    assert.deepEqual(p?.days, [4]);
    assert.equal(p?.part, 'AFTERNOON');
    assert.equal(p?.label, 'Thursday afternoon');
  });
  test('"tomorrow after 2" and nothing at all', () => {
    const p = parseMeetingPreference('Could we talk tomorrow after 2?', NOW, CHICAGO);
    assert.deepEqual(p?.dates, ['2026-10-08']);
    assert.equal(p?.afterMinute, 14 * 60);
    assert.equal(parseMeetingPreference('Sure, happy to have a call.', NOW, CHICAGO), null);
  });
});

describe('findSlots — only genuinely free time', () => {
  test('Thursday afternoon: avoids the busy block + buffer and lunch, all inside the request', () => {
    // Busy 1:30–2:30 PM Thursday (18:30–19:30Z).
    const r = findSlots({ ...base, busy: [{ start: '2026-10-08T18:30:00.000Z', end: '2026-10-08T19:30:00.000Z' }], preference: parseMeetingPreference('Thursday afternoon', NOW, CHICAGO) });
    assert.equal(r.preferenceMatched, true);
    assert.ok(r.slots.length >= 1);
    for (const s of r.slots) {
      const p = zonedParts(new Date(s.start), CHICAGO);
      assert.equal(p.weekday, 4);
      assert.ok(p.minute >= 12 * 60);
      const start = Date.parse(s.start);
      assert.ok(start + 30 * 60_000 + 15 * 60_000 <= Date.parse('2026-10-08T18:30:00.000Z') || start - 15 * 60_000 >= Date.parse('2026-10-08T19:30:00.000Z'), `slot ${s.start} too close to the busy block`);
      assert.ok(!(p.minute < 13 * 60 + 30 && p.minute + 30 > 12 * 60 + 30), `slot ${s.start} is over lunch`);
    }
  });

  test('a full day (daily cap) offers nothing that day; nothing matching → nearest free times, said so', () => {
    const full = findSlots({ ...base, bookedPerDay: { '2026-10-08': 5, '2026-10-15': 5 }, preference: parseMeetingPreference('Thursday', NOW, CHICAGO) });
    assert.equal(full.preferenceMatched, false);
    assert.ok(full.slots.every((s) => zonedParts(new Date(s.start), CHICAGO).weekday !== 4));
    assert.match(full.reason ?? '', /Nothing free/);
    const sunday = findSlots({ ...base, preference: parseMeetingPreference('Sunday morning', NOW, CHICAGO) });
    assert.equal(sunday.preferenceMatched, false);
    assert.ok(sunday.slots.length > 0);
  });

  test('minimum notice, spread over days, and a sensible hour for a prospect in another zone', () => {
    const r = findSlots({ ...base, rules: { ...RULES, timezone: 'America/Los_Angeles' }, prospectTimezone: 'America/New_York' });
    assert.equal(r.slots.length, 3);
    for (const s of r.slots) {
      assert.ok(Date.parse(s.start) >= NOW.getTime() + 240 * 60_000);
      const p = zonedParts(new Date(s.end), 'America/New_York');
      assert.ok(p.minute <= 18 * 60, `ends ${p.minute} — after 6 PM for the prospect`);
    }
    const perDay = new Map<string, number>();
    for (const s of r.slots) perDay.set(zonedParts(new Date(s.start), 'America/Los_Angeles').date, (perDay.get(zonedParts(new Date(s.start), 'America/Los_Angeles').date) ?? 0) + 1);
    assert.ok([...perDay.values()].every((n) => n <= 2));
  });
});

describe('matchChosenSlot — exactly one, or nobody guesses', () => {
  const slots = [
    { start: '2026-10-08T17:00:00.000Z', end: '2026-10-08T17:30:00.000Z' }, // Thu 12:00 CDT
    { start: '2026-10-08T20:00:00.000Z', end: '2026-10-08T20:30:00.000Z' }, // Thu 3:00 PM
    { start: '2026-10-09T15:00:00.000Z', end: '2026-10-09T15:30:00.000Z' }, // Fri 10:00 AM
  ];
  test('by day + time, by order, and not when unclear or declined', () => {
    assert.equal(matchChosenSlot('Thursday at 3pm works great', slots, CHICAGO), slots[1]);
    assert.equal(matchChosenSlot('Let’s do the first one.', slots, CHICAGO), slots[0]);
    assert.equal(matchChosenSlot('Friday at 10 is perfect', slots, CHICAGO), slots[2]);
    assert.equal(matchChosenSlot('Thursday works', slots, CHICAGO), null); // two Thursday slots
    assert.equal(matchChosenSlot('2:30 works for me', slots, CHICAGO), null);
    assert.equal(matchChosenSlot('None of those work, sorry — Thursday at 3pm is taken', slots, CHICAGO), null);
  });

  test('the offer lists the times and asks to confirm the zone when unsure', () => {
    const text = offerMessage(slots, CHICAGO, { firstName: 'Grace', meetingName: 'Discovery call', durationMinutes: 30, confirmTimezone: true });
    assert.match(text, /Hi Grace/);
    assert.match(text, /Thursday, October 8 at 3:00 PM/);
    assert.match(text, /tell me your time zone/);
  });
});
