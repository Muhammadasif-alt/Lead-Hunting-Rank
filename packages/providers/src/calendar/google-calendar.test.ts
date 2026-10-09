import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ProviderCallError } from '../core/errors.js';
import { GoogleCalendarProvider, googleEventIdFor } from './google-calendar.js';

const o = () => ({ signal: AbortSignal.timeout(5000) });
type Call = { url: string; init?: RequestInit };

function fakeFetch(routes: [RegExp, (call: Call) => Response][]) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    const route = routes.find(([re]) => re.test(`${init?.method ?? 'GET'} ${call.url}`));
    return route ? route[1](call) : new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { fn, calls };
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const event = (id: string, extra: Record<string, unknown> = {}) => ({ id, status: 'confirmed', summary: 'Discovery call', etag: '"1"', start: { dateTime: '2026-10-08T20:00:00Z' }, end: { dateTime: '2026-10-08T20:30:00Z' }, attendees: [{ email: 'Grace@Evergreen.example' }], ...extra });

test('free/busy is read fresh; a calendar we can not read is an error, not "free"', async () => {
  const { fn, calls } = fakeFetch([[/POST .*\/freeBusy$/, () => json({ calendars: { primary: { busy: [{ start: '2026-10-08T18:30:00Z', end: '2026-10-08T19:30:00Z' }] } } })]]);
  const cal = new GoogleCalendarProvider({ getAccessToken: async () => 'tok', fetch: fn });
  const busy = await cal.getBusy('primary', { start: '2026-10-08T00:00:00Z', end: '2026-10-09T00:00:00Z' }, o());
  assert.deepEqual(busy, [{ start: '2026-10-08T18:30:00.000Z', end: '2026-10-08T19:30:00.000Z' }]);
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)).items, [{ id: 'primary' }]);

  const denied = fakeFetch([[/freeBusy/, () => json({ calendars: { 'x@y.example': { errors: [{ reason: 'notFound' }] } } })]]);
  await assert.rejects(new GoogleCalendarProvider({ getAccessToken: async () => 'tok', fetch: denied.fn }).getBusy('x@y.example', { start: '2026-10-08T00:00:00Z', end: '2026-10-09T00:00:00Z' }, o()), (e) => e instanceof ProviderCallError && e.kind === 'NOT_FOUND');
});

test('create: deterministic event id, invites + Meet link; a retry (409) returns the same event instead of a second one', async () => {
  const id = googleEventIdFor('meeting:1:book:x');
  assert.match(id, /^[0-9a-v]{5,1024}$/, 'Google event ids are base32hex');
  let posts = 0;
  const { fn, calls } = fakeFetch([
    [/POST .*\/calendars\/primary\/events\?sendUpdates=all&conferenceDataVersion=1$/, () => (++posts === 1 ? json(event(id, { hangoutLink: 'https://meet.google.com/abc' })) : json({ error: { message: 'duplicate', errors: [{ reason: 'duplicate' }] } }, 409))],
    [new RegExp(`GET .*/events/${id}$`), () => json(event(id, { hangoutLink: 'https://meet.google.com/abc' }))],
  ]);
  const cal = new GoogleCalendarProvider({ getAccessToken: async () => 'tok', fetch: fn });
  const input = { calendarId: 'primary', title: 'Discovery call', start: '2026-10-08T20:00:00Z', end: '2026-10-08T20:30:00Z', timezone: 'America/Chicago', attendees: ['grace@evergreen.example'], videoLink: true, idempotencyKey: 'meeting:1:book:x' };
  const a = await cal.createEvent(input, o());
  const b = await cal.createEvent(input, o());
  assert.equal(a.eventId, id);
  assert.equal(b.eventId, id);
  assert.equal(a.meetingUrl, 'https://meet.google.com/abc');
  assert.deepEqual(a.attendees, ['grace@evergreen.example']);
  const body = JSON.parse(String(calls[0]!.init!.body));
  assert.equal(body.id, id);
  assert.equal(body.start.timeZone, 'America/Chicago');
  assert.equal(body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet');
});

test('a deleted event reads as gone; cancelling an already-deleted event is fine; a 5xx on a write is "outcome unknown"', async () => {
  const { fn } = fakeFetch([
    [/GET .*\/events\/gone$/, () => json({ error: { message: 'Resource has been deleted' } }, 410)],
    [/DELETE .*\/events\/gone/, () => json({ error: { message: 'gone' } }, 410)],
    [/PATCH .*\/events\/e1/, () => json({ error: { message: 'backend' } }, 503)],
  ]);
  const cal = new GoogleCalendarProvider({ getAccessToken: async () => 'tok', fetch: fn });
  assert.equal(await cal.getEvent('primary', 'gone', o()), null);
  assert.equal((await cal.cancelEvent('primary', 'gone', o())).status, 'CANCELLED');
  await assert.rejects(cal.updateEvent('primary', 'e1', { start: '2026-10-09T15:00:00Z', end: '2026-10-09T15:30:00Z' }, o()), (e) => e instanceof ProviderCallError && e.kind === 'UNKNOWN_OUTCOME');
});
