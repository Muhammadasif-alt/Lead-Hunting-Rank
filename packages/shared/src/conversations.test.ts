import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseContactLater, parseReturnDate, quotedIn, readMessage } from './conversations.js';

const NOW = new Date('2026-10-07T10:00:00.000Z'); // a Wednesday

describe('readMessage — the deterministic reading behind the Inbox Agent', () => {
  test('multi-intent: a question about price is PRICING with QUESTION secondary, and goes to a person', () => {
    const r = readMessage({ text: 'Sounds interesting! How much does it cost per month?' }, NOW);
    assert.equal(r.primaryIntent, 'PRICING');
    assert.ok(r.secondaryIntents.includes('QUESTION'));
    assert.ok(r.secondaryIntents.includes('POSITIVE'));
    assert.deepEqual(r.questions, ['How much does it cost per month?']);
    assert.equal(r.needsHuman, true);
    assert.equal(r.sentiment, 'POSITIVE');
  });

  test('unsubscribe wins over everything and is never sent to a person for persuasion', () => {
    const r = readMessage({ text: 'Not interested. Please remove me from your list. How did you get my email?' }, NOW);
    assert.equal(r.primaryIntent, 'UNSUBSCRIBE');
    assert.equal(r.sentiment, 'NEGATIVE');
  });

  test('objection with its sentence, current solution with the exact words', () => {
    const r = readMessage({ text: 'We already work with a local agency for our website. Thanks anyway.' }, NOW);
    assert.equal(r.primaryIntent, 'OBJECTION');
    assert.equal(r.objections[0]?.type, 'ALREADY_HAS_SOLUTION');
    const cur = r.extracted.find((x) => x.field === 'CURRENT_SOLUTION');
    assert.ok(cur && quotedIn(cur.quote, 'We already work with a local agency for our website. Thanks anyway.'));
  });

  test('not now → contact-later date; referral; meeting; risk words escalate', () => {
    const later = readMessage({ text: 'Not a priority right now — reach out in 3 months.' }, NOW);
    assert.equal(later.primaryIntent, 'NOT_NOW');
    assert.equal(later.extracted.find((x) => x.field === 'CONTACT_LATER')?.value, '2027-01-05');
    const ref = readMessage({ text: "I'm not the right person. You should contact jane@acme.example, she handles marketing." }, NOW);
    assert.equal(ref.primaryIntent, 'REFERRAL');
    assert.equal(ref.extracted.find((x) => x.field === 'REFERRAL')?.value, 'jane@acme.example');
    const meet = readMessage({ text: 'Happy to chat. Could we do a call on Thursday afternoon?' }, NOW);
    assert.equal(meet.primaryIntent, 'MEETING_REQUEST');
    assert.ok(meet.extracted.some((x) => x.field === 'MEETING_PREFERENCE'));
    const legal = readMessage({ text: 'Can you send the contract? Is there any discount?' }, NOW);
    assert.ok(legal.riskFlags.includes('LEGAL') && legal.riskFlags.includes('DISCOUNT'));
    assert.equal(legal.needsHuman, true);
  });

  test('away messages: not a person, return date parsed (never guessed)', () => {
    const r = readMessage({ subject: 'Automatic reply: hello', text: 'I am out of the office until October 14th with limited access to email.' }, NOW);
    assert.equal(r.primaryIntent, 'OUT_OF_OFFICE');
    assert.equal(r.returnDate, '2026-10-14');
    assert.equal(r.needsHuman, false);
    assert.equal(parseReturnDate('Back on Monday', NOW), '2026-10-12');
    assert.equal(parseReturnDate('back on 14/10', NOW), '2026-10-14');
    assert.equal(parseReturnDate('I am away for a while', NOW), null);
    assert.equal(parseContactLater('maybe next year', NOW), '2027-01-15');
  });

  test('a message we cannot read is UNKNOWN and goes to a person', () => {
    const r = readMessage({ text: 'Hmm.' }, NOW);
    assert.equal(r.primaryIntent, 'UNKNOWN');
    assert.equal(r.needsHuman, true);
    assert.equal(r.confidence, 'LOW');
  });
});
