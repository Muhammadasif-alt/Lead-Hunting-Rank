import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { readMessage } from './conversations.js';
import { candidateDecision, dueFrom, memoryFromReading, memoryTiming, promisesIn, sameMemoryValue } from './memory.js';

const NOW = new Date('2026-10-07T10:00:00.000Z'); // Wednesday

describe('memory proposals — right record, their words', () => {
  test('a deal budget goes to the opportunity, the role to the person, the tool to the company', () => {
    const text = "I'm the owner. We use Jobber for scheduling. Our budget is around $5k for this website project. I prefer email.";
    const r = readMessage({ text }, NOW);
    const p = memoryFromReading({ text, ...r }, { hasOpportunity: true, hasPerson: true });
    const by = (k: string) => p.find((x) => x.key === k);
    assert.equal(by('BUDGET')?.scope, 'OPPORTUNITY');
    assert.equal(by('ROLE')?.scope, 'PERSON');
    assert.equal(by('ROLE')?.value, 'Owner');
    assert.equal(by('CURRENT_SOLUTION')?.scope, 'COMPANY');
    assert.equal(by('PREFERRED_CHANNEL')?.value, 'Email');
    assert.ok(by('BUDGET')!.quote.includes('$5k'));
    // Without a deal the budget stays with the conversation — never a company-wide truth.
    assert.equal(memoryFromReading({ text, ...r }, { hasOpportunity: false, hasPerson: true }).find((x) => x.key === 'BUDGET')?.scope, 'CONVERSATION');
  });

  test('"Thanks!" and an unsubscribe propose nothing; budget waits for a person; notes are accepted', () => {
    const thanks = readMessage({ text: 'Thanks!' }, NOW);
    assert.deepEqual(memoryFromReading({ text: 'Thanks!', ...thanks }, { hasOpportunity: false, hasPerson: false }), []);
    const unsub = readMessage({ text: 'Please unsubscribe me, we use Jobber.' }, NOW);
    assert.deepEqual(memoryFromReading({ text: 'x', ...unsub }, { hasOpportunity: false, hasPerson: false }), []);
    assert.equal(candidateDecision('BUDGET', 'HIGH', 'DIRECT_STATEMENT').accept, false);
    assert.equal(candidateDecision('CURRENT_SOLUTION', 'MEDIUM', 'DIRECT_STATEMENT').accept, true);
    assert.equal(candidateDecision('CURRENT_SOLUTION', 'LOW', 'DIRECT_STATEMENT').accept, false);
    assert.equal(candidateDecision('BUDGET', 'LOW', 'HUMAN_NOTE').accept, true);
  });

  test('time awareness and sameness', () => {
    const t = memoryTiming('CONTACT_LATER', NOW, '2027-01-15');
    assert.equal(t.validUntil?.toISOString().slice(0, 10), '2027-02-14');
    assert.ok(memoryTiming('CURRENT_SOLUTION', NOW).recheckAfter);
    assert.ok(sameMemoryValue('Jobber', 'We use Jobber'));
    assert.ok(!sameMemoryValue('HubSpot', 'Jobber'));
  });
});

describe('promises — ours and theirs', () => {
  test('ours with a due date, theirs from their side, questions are not promises', () => {
    const ours = promisesIn("Thanks Grace. I'll send you the pricing sheet tomorrow. Would Thursday work?", 'OURS', NOW);
    assert.equal(ours.length, 1);
    assert.equal(ours[0]!.title, 'Send them the pricing sheet tomorrow');
    assert.equal(ours[0]!.dueAt?.toISOString(), '2026-10-08T17:00:00.000Z');
    const theirs = promisesIn("I'll talk to my partner and get back to you by Friday.", 'THEIRS', NOW);
    assert.equal(theirs[0]!.title, 'Talk to my partner and get back to us by Friday');
    assert.equal(theirs[0]!.dueAt?.toISOString(), '2026-10-09T17:00:00.000Z');
    assert.deepEqual(promisesIn('Will you send the pricing?', 'THEIRS', NOW), []);
    assert.equal(dueFrom('end of the month', NOW)?.toISOString(), '2026-10-31T17:00:00.000Z');
  });
});
