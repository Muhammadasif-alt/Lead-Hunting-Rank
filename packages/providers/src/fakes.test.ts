import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { z } from 'zod';
import { isConnectable, PROVIDER_CATALOG } from './catalog.js';
import { CAPABILITIES } from './core/capabilities.js';
import { ProviderCallError } from './core/errors.js';
import { FakeCalendarProvider } from './fakes/calendar.js';
import { FakeEmailProvider } from './fakes/email.js';
import { FakeLeadProvider } from './fakes/leads.js';
import { FakeLLMProvider } from './fakes/llm.js';
import { FakeNotificationProvider } from './fakes/notification.js';
import { FakeVerificationProvider } from './fakes/verification.js';
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
});

describe('FakeLeadProvider', () => {
  const input = { location: { country: 'US', region: 'TX', city: 'Austin' }, industry: 'landscaping' };
  test('same query → same market; paginates to exhaustion', async () => {
    const leads = new FakeLeadProvider();
    const all = [];
    let cursor: string | null = null;
    do {
      const page = await leads.searchCompanies({ ...input, cursor, pageSize: 25 }, o());
      all.push(...page.observations);
      cursor = page.nextCursor;
    } while (cursor);
    const again = await new FakeLeadProvider().searchCompanies({ ...input, pageSize: 5 }, o());
    assert.deepEqual(again.observations.map((x) => x.name), all.slice(0, 5).map((x) => x.name));
    assert.ok(all.length >= 40);
    assert.ok(all.some((x) => x.domain === null), 'some businesses have no website');
    const phones = all.map((x) => x.phone);
    assert.ok(new Set(phones).size < phones.length, 'contains duplicate listings for entity resolution');
    assert.equal(all[0]!.raw.business_title, all[0]!.name, 'vendor naming kept in raw, canonical name outside');
  });
  test('rejects uncovered countries', async () => {
    await assert.rejects(new FakeLeadProvider().searchCompanies({ ...input, location: { country: 'ZZ' } }, o()), (e) => e instanceof ProviderCallError && e.kind === 'INVALID_REQUEST');
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
