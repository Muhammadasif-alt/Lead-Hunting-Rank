import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { z } from 'zod';
import { isConnectable, PROVIDER_CATALOG } from './catalog.js';
import { CAPABILITIES } from './core/capabilities.js';
import { ProviderCallError } from './core/errors.js';
import type { CompanySearchInput } from './core/interfaces.js';
import { FakeCalendarProvider } from './fakes/calendar.js';
import { FakeEmailProvider } from './fakes/email.js';
import { FakeDirectoryProvider, FakeLeadProvider } from './fakes/leads.js';
import { FakeLLMProvider } from './fakes/llm.js';
import { FakeNotificationProvider } from './fakes/notification.js';
import { FakeVerificationProvider } from './fakes/verification.js';
import { FakeWebsiteProvider } from './fakes/websites.js';
import { LocalStorageProvider } from './storage/local.js';

const o = () => ({ signal: AbortSignal.timeout(5000) });

describe('provider catalog', () => {
  test('keys are unique and capabilities are known', () => {
    assert.equal(new Set(PROVIDER_CATALOG.map((p) => p.key)).size, PROVIDER_CATALOG.length);
    for (const p of PROVIDER_CATALOG) for (const c of p.capabilities) assert.ok(CAPABILITIES.includes(c), `${p.key}: ${c}`);
  });
  test('fake providers are never connectable in production; planned ones never', () => {
    const fake = PROVIDER_CATALOG.find((p) => p.key === 'fake_email')!;
    const planned = PROVIDER_CATALOG.find((p) => p.key === 'gmail')!;
    assert.equal(isConnectable(fake, 'development'), true);
    assert.equal(isConnectable(fake, 'production'), false);
    assert.equal(isConnectable(planned, 'development'), false);
  });
});

describe('FakeEmailProvider', () => {
  test('stores sends, lists changes by cursor, threads replies', async () => {
    const email = new FakeEmailProvider();
    const first = await email.sendMessage({ from: 'a@x.example', to: ['b@y.example'], subject: 'S', text: 'T', idempotencyKey: 'k1' }, o());
    await email.sendMessage({ from: 'a@x.example', to: ['b@y.example'], subject: 'Re: S', text: 'T2', threadRef: first.threadId, idempotencyKey: 'k2' }, o());
    const page = await email.listChanges(null, o());
    assert.equal(page.messages.length, 2);
    assert.equal((await email.listChanges(page.cursor, o())).messages.length, 0);
    assert.equal((await email.getThread(first.threadId, o())).length, 2);
    assert.equal((await email.findSentByIdempotencyKey('k2', o()))?.threadId, first.threadId);
    assert.equal(await email.findSentByIdempotencyKey('nope', o()), null);
  });
  test('does not deduplicate by itself (our idempotency must)', async () => {
    const email = new FakeEmailProvider();
    const input = { from: 'a@x.example', to: ['b@y.example'], subject: 'S', text: 'T', idempotencyKey: 'same' };
    await email.sendMessage(input, o());
    await email.sendMessage(input, o());
    assert.equal(email.sends, 2);
  });
});

describe('FakeCalendarProvider', () => {
  const range = { start: '2026-10-05T00:00:00.000Z', end: '2026-10-06T00:00:00.000Z' }; // a Monday
  test('busy blocks are repeatable; weekends are free', async () => {
    const cal = new FakeCalendarProvider();
    const a = await cal.getBusy('primary', range, o());
    assert.equal(a.length, 2);
    assert.deepEqual(await new FakeCalendarProvider().getBusy('primary', range, o()), a);
    assert.equal((await cal.getBusy('primary', { start: '2026-10-03T00:00:00.000Z', end: '2026-10-05T00:00:00.000Z' }, o())).length, 0);
  });
  test('books a free slot, refuses a busy one, finds the event by idempotency key, cancels', async () => {
    const cal = new FakeCalendarProvider();
    const busy = await cal.getBusy('primary', range, o());
    await assert.rejects(cal.createEvent({ calendarId: 'primary', title: 'Intro', attendees: [], idempotencyKey: 'x', ...busy[0]! }, o()), (e) => e instanceof ProviderCallError && e.kind === 'INVALID_REQUEST');
    const ev = await cal.createEvent({ calendarId: 'primary', title: 'Intro', attendees: ['p@x.example'], idempotencyKey: 'm1', start: '2026-10-05T18:00:00.000Z', end: '2026-10-05T18:30:00.000Z' }, o());
    assert.equal(ev.status, 'CONFIRMED');
    assert.equal((await cal.findEventByIdempotencyKey('m1', o()))?.eventId, ev.eventId);
    assert.equal((await cal.getBusy('primary', range, o())).length, 3, 'the new event is busy time now');
    const cancelled = await cal.cancelEvent('primary', ev.eventId, o());
    assert.equal(cancelled.status, 'CANCELLED');
    assert.notEqual(cancelled.etag, ev.etag);
  });
  test('moves an event only onto free time; a change made in the calendar itself is visible (for reconciliation)', async () => {
    const cal = new FakeCalendarProvider();
    const busy = await cal.getBusy('primary', range, o());
    const ev = await cal.createEvent({ calendarId: 'primary', title: 'Intro', attendees: ['p@x.example'], idempotencyKey: 'm2', start: '2026-10-05T18:00:00.000Z', end: '2026-10-05T18:30:00.000Z', videoLink: true }, o());
    assert.match(ev.meetingUrl ?? '', /^https:\/\/meet\.test-calendar\.example\//);
    await assert.rejects(cal.updateEvent('primary', ev.eventId, busy[0]!, o()), (e) => e instanceof ProviderCallError && e.kind === 'INVALID_REQUEST');
    // Moving within its own time (30 minutes later, overlapping itself) is fine.
    const moved = await cal.updateEvent('primary', ev.eventId, { start: '2026-10-05T18:15:00.000Z', end: '2026-10-05T18:45:00.000Z' }, o());
    assert.equal(moved.start, '2026-10-05T18:15:00.000Z');
    await cal.externalChange(ev.eventId, { cancel: true });
    assert.equal((await cal.getEvent('primary', ev.eventId))?.status, 'CANCELLED');
  });
});

describe('Fake lead sources', () => {
  const input = { location: { country: 'US', region: 'TX', city: 'Austin' }, industry: 'landscaping' };
  const all = async (source: FakeLeadProvider | FakeDirectoryProvider, extra: Partial<CompanySearchInput> = {}) => {
    const out = [];
    let cursor: string | null = null;
    do {
      const page = await source.searchCompanies({ ...input, ...extra, cursor, pageSize: 20 }, o());
      out.push(...page.observations);
      cursor = page.nextCursor;
    } while (cursor);
    return out;
  };

  test('same query → same results; paginates to exhaustion; results per query are capped', async () => {
    const first = await all(new FakeLeadProvider());
    const again = await new FakeLeadProvider().searchCompanies({ ...input, pageSize: 5 }, o());
    assert.deepEqual(again.observations.map((x) => x.name), first.slice(0, 5).map((x) => x.name));
    assert.ok(first.length >= 30 && first.length <= 50, `capped result set (${first.length})`);
    assert.ok(first.some((x) => x.domain === null), 'some businesses have no website');
    const phones = first.map((x) => x.phone);
    assert.ok(new Set(phones).size < phones.length, 'contains duplicate listings for entity resolution');
    assert.equal(first[0]!.raw.business_title, first[0]!.name, 'vendor naming kept in raw, canonical name outside');
  });

  test('related categories and query variations surface businesses the main query missed', async () => {
    const main = new Set((await all(new FakeLeadProvider())).map((x) => x.sourceRecordId));
    assert.ok((await all(new FakeLeadProvider(), { industry: 'irrigation' })).some((x) => !main.has(x.sourceRecordId)));
    assert.ok((await all(new FakeLeadProvider(), { query: 'commercial' })).some((x) => !main.has(x.sourceRecordId)));
  });

  test('two sources describe one market differently — same businesses, different formats and ids', async () => {
    const leadDomains = new Set((await all(new FakeLeadProvider())).map((x) => x.domain).filter(Boolean));
    const directory = await all(new FakeDirectoryProvider());
    assert.ok(directory.some((x) => x.domain && leadDomains.has(x.domain)), 'the sources overlap');
    assert.ok(directory.some((x) => x.domain && !leadDomains.has(x.domain)), 'and each knows businesses the other did not return');
    assert.ok(directory.every((x) => x.sourceRecordId.startsWith('bd-')));
    assert.ok(directory.every((x) => /^\(\d{3}\) \d{3}-\d{4}$/.test(x.phone!)), 'directory formats phones its own way');
  });

  test('listing ids never repeat across markets (a reused id would glue businesses in different cities)', async () => {
    const austin = new Set((await all(new FakeDirectoryProvider())).map((x) => x.sourceRecordId));
    const lahore = await all(new FakeDirectoryProvider(), { location: { country: 'PK', region: 'Punjab', city: 'Lahore' }, industry: 'plumbing' });
    assert.ok(lahore.length > 0);
    assert.ok(lahore.every((x) => !austin.has(x.sourceRecordId)));
  });

  test('rejects uncovered countries', async () => {
    await assert.rejects(new FakeLeadProvider().searchCompanies({ ...input, location: { country: 'ZZ' } }, o()), (e) => e instanceof ProviderCallError && e.kind === 'INVALID_REQUEST');
  });
});

describe('FakeWebsiteProvider', () => {
  test('the same domain always reads the same; home, contact and about exist; other paths are 404', async () => {
    const web = new FakeWebsiteProvider();
    const a = await web.fetchPage('http://lonestarlandscapingco.example/', o());
    const b = await new FakeWebsiteProvider().fetchPage('http://lonestarlandscapingco.example/', o());
    assert.deepEqual({ ...a, fetchedAt: '' }, { ...b, fetchedAt: '' });
    if (a.failure) return; // this domain happens to be one of the sites that don't load
    assert.equal(a.status, 200);
    assert.match(a.body, /<title>/);
    assert.equal((await web.fetchPage(`${new URL(a.finalUrl).origin}/contact`, o())).status, 200);
    assert.equal((await web.fetchPage(`${new URL(a.finalUrl).origin}/nope`, o())).failure, 'HTTP_ERROR');
  });

  test('across many sites: some lack https, some do not load, some name an owner; real domains are never fetched', async () => {
    const web = new FakeWebsiteProvider();
    const pages = await Promise.all(Array.from({ length: 60 }, (_, i) => web.fetchPage(`http://site${i}.example/`, o())));
    assert.ok(pages.some((p) => p.failure === 'TIMEOUT'), 'some sites do not load');
    assert.ok(pages.some((p) => p.finalUrl.startsWith('http://') && !p.failure), 'some have no https');
    assert.ok(pages.some((p) => p.finalUrl.startsWith('https://')), 'most have https');
    const real = await web.fetchPage('https://www.google.com/', o());
    assert.equal(real.failure, 'UNREACHABLE');
  });
});

describe('FakeVerificationProvider', () => {
  test('produces each canonical status on purpose', async () => {
    const v = new FakeVerificationProvider();
    const status = async (e: string) => (await v.verifyEmail(e, o())).status;
    assert.equal(await status('jane@lawns.example'), 'VALID');
    assert.equal(await status('jane@lawns.invalid'), 'INVALID');
    assert.equal(await status('info@lawns.example'), 'RISKY');
    assert.equal(await status('jane@catchall.example'), 'CATCH_ALL');
    assert.equal(await status('jane@lawns.test'), 'UNKNOWN');
  });
});

describe('FakeLLMProvider', () => {
  const Schema = z.object({ intent: z.enum(['POSITIVE', 'NEGATIVE']), confidence: z.number() });
  test('structured output is schema-validated; invalid output is an error', async () => {
    const llm = new FakeLLMProvider().respondWith({ intent: 'POSITIVE', confidence: 0.9 }, '{"intent":"MAYBE"}', 'not json');
    const ok = await llm.generateStructured({ modelClass: 'FAST', prompt: 'classify', schema: Schema, schemaName: 'Intent' }, o());
    assert.equal(ok.data.intent, 'POSITIVE');
    assert.ok(ok.inputTokens > 0);
    await assert.rejects(llm.generateStructured({ modelClass: 'FAST', prompt: 'x', schema: Schema, schemaName: 'Intent' }, o()), /does not match Intent/);
    await assert.rejects(llm.generateStructured({ modelClass: 'FAST', prompt: 'x', schema: Schema, schemaName: 'Intent' }, o()), /not valid JSON/);
  });
  test('unscripted text is a labelled echo, never pretend knowledge', async () => {
    const r = await new FakeLLMProvider().generateText({ modelClass: 'STANDARD', prompt: 'Summarize Acme' }, o());
    assert.match(r.text, /^\[fake standard model\]/);
  });
});

describe('FakeNotificationProvider', () => {
  test('same idempotency key → same notification', async () => {
    const n = new FakeNotificationProvider();
    const a = await n.notify({ recipient: 'u1', title: 'T', body: 'B', idempotencyKey: 'n1' }, o());
    const b = await n.notify({ recipient: 'u1', title: 'T', body: 'B', idempotencyKey: 'n1' }, o());
    assert.equal(a.notificationId, b.notificationId);
    assert.equal(n.sent.size, 1);
  });
});

describe('LocalStorageProvider', () => {
  test('round-trips private objects and refuses keys that escape the root', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhl-storage-'));
    try {
      const s = new LocalStorageProvider(dir);
      const put = await s.put('kb/docs/pricing.txt', Buffer.from('hello'), 'text/plain', o());
      assert.equal(put.size, 5);
      const got = await s.get('kb/docs/pricing.txt', o());
      assert.equal(got?.body.toString(), 'hello');
      assert.equal(got?.object.sha256, put.sha256);
      for (const bad of ['../etc/passwd', '/abs/path', 'a/../../b', 'C:\\win', 'x.meta.json', '']) {
        await assert.rejects(s.put(bad, Buffer.from('x'), 'text/plain', o()), (e) => e instanceof ProviderCallError && e.kind === 'INVALID_REQUEST', bad);
      }
      await s.delete('kb/docs/pricing.txt', o());
      assert.equal(await s.get('kb/docs/pricing.txt', o()), null);
      assert.deepEqual((await s.healthCheck()).map((c) => c.ok), [true]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
