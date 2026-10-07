import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAudience } from './audience.js';
import { messageKey, parseMessageKey } from './engine.js';
import { classifyInbound, ownText } from './inbound.js';

const msg = (from: string, subject: string, text: string) => ({ from, subject, text });

test('inbound classification: genuine reply, unsubscribe, auto-reply, bounce — no AI', () => {
  assert.equal(classifyInbound(msg('ann@x.example', 'Re: Online booking', 'Sounds good, call me Tuesday?')), 'REPLY');
  assert.equal(classifyInbound(msg('ann@x.example', 'Re: hi', 'Please remove me from your list.')), 'UNSUBSCRIBE');
  assert.equal(classifyInbound(msg('ann@x.example', 'unsubscribe', '')), 'UNSUBSCRIBE');
  assert.equal(classifyInbound(msg('ann@x.example', 'Automatic reply: Online booking', 'I am away')), 'AUTO_REPLY');
  assert.equal(classifyInbound(msg('ann@x.example', 'Out of Office', 'Back Monday')), 'AUTO_REPLY');
  assert.equal(classifyInbound(msg('mailer-daemon@googlemail.com', 'Delivery Status Notification (Failure)', '...')), 'BOUNCE');
  assert.equal(classifyInbound(msg('postmaster@x.example', 'Undeliverable: hi', '...')), 'BOUNCE');
  // Our own footer quoted back ("reply unsubscribe") is not the person asking to unsubscribe.
  assert.equal(classifyInbound(msg('ann@x.example', 'Re: hi', 'Yes, interested!\n\nOn Mon, Sam wrote:\n> If you’d rather not hear from me, just reply “unsubscribe”.')), 'REPLY');
});

test('ownText cuts quoted history', () => {
  assert.equal(ownText('Thanks!\n\nOn Tue, 6 Jan 2026 at 10:00 Sam <s@x.example> wrote:\n> earlier'), 'Thanks!');
  assert.equal(ownText('Hi\n> quoted\nmore'), 'Hi');
});

test('message keys round-trip; anything else is not a campaign key', () => {
  const c = '00000000-0000-4000-8000-000000000001';
  const e = '00000000-0000-4000-8000-000000000002';
  assert.deepEqual(parseMessageKey(messageKey(c, e, 2)), { campaignId: c, enrollmentId: e, position: 2 });
  assert.equal(parseMessageKey('diagnostics:ping:1'), null);
});

test('audience filter parsing ignores junk', () => {
  assert.deepEqual(parseAudience({ industries: ['plumb', '', 3], priorities: ['HIGH', 'NOPE'], marketId: 7 }), { marketId: null, industries: ['plumb'], opportunityKeys: undefined, priorities: ['HIGH'] });
});
