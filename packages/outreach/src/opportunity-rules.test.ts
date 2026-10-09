import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commercialSignal, dealHealth, mentionedStakeholder, nextBestAction, qualificationKeyFor, stageRequirements, suggestLossReason, type HealthInput } from './opportunity-rules.js';

const NOW = new Date('2026-10-09T12:00:00.000Z');
const deal = (over: Partial<HealthInput> = {}): HealthInput => ({
  semantic: 'NEW',
  status: 'OPEN',
  known: new Set(),
  hasPrimaryContact: true,
  service: 'Website',
  amountMinor: null,
  reached: new Set(['NEW']),
  stakeholders: [],
  conversation: { waitingOn: 'PROSPECT', lastInboundAt: new Date(NOW.getTime() - 86_400_000), lastOutboundAt: NOW },
  stageEnteredAt: NOW,
  lastActivityAt: NOW,
  contactName: 'Ann',
  revisitAt: null,
  nextActionOverride: null,
  ...over,
});

test('commercial evidence: interest is not a deal; need + timing is strong', () => {
  assert.equal(commercialSignal({}, 'QUESTION'), null);
  assert.equal(commercialSignal({ NEED: { value: 'x', quote: 'x' } }, 'QUESTION')?.strength, 'MODERATE');
  assert.equal(commercialSignal({ NEED: { value: 'x', quote: 'x' }, TIMELINE: { value: 'y', quote: 'y' } }, null)?.strength, 'STRONG');
  assert.equal(commercialSignal({}, 'PRICING')?.strength, 'MODERATE');
});

test('stage requirements: qualified needs need + (authority or timeline); negotiation needs a proposal first', () => {
  assert.deepEqual(stageRequirements('QUALIFIED', deal()), ['Need is unknown', 'Who decides or the timeline must be known']);
  assert.deepEqual(stageRequirements('QUALIFIED', deal({ known: new Set(['NEED', 'TIMELINE']) })), []);
  assert.ok(stageRequirements('PROPOSAL', deal({ known: new Set(['NEED']), service: null })).some((m) => /deliver/.test(m)));
  assert.ok(stageRequirements('NEGOTIATION', deal({ known: new Set(['NEED']) })).some((m) => /proposal/.test(m)));
});

test('health: evidence, not probability — waiting on us is a high risk, long silence is stalled', () => {
  assert.equal(dealHealth(deal({ known: new Set(['NEED']) }), NOW).health, 'HEALTHY');
  const waiting = dealHealth(deal({ conversation: { waitingOn: 'US', lastInboundAt: new Date(NOW.getTime() - 3 * 86_400_000), lastOutboundAt: null } }), NOW);
  assert.equal(waiting.health, 'AT_RISK');
  const quiet = new Date(NOW.getTime() - 20 * 86_400_000);
  assert.equal(dealHealth(deal({ semantic: 'PROPOSAL', conversation: { waitingOn: 'PROSPECT', lastInboundAt: quiet, lastOutboundAt: quiet } }), NOW).health, 'STALLED');
  assert.equal(dealHealth(deal({ status: 'WON' }), NOW).health, 'CLOSED');
});

test('next action: one, with why — reply first, then the missing need, a stalled proposal gets a specific nudge', () => {
  assert.match(nextBestAction(deal({ conversation: { waitingOn: 'US', lastInboundAt: NOW, lastOutboundAt: null } }), NOW).action, /Reply to Ann/);
  assert.match(nextBestAction(deal(), NOW).action, /Confirm what they need/);
  assert.match(nextBestAction(deal({ known: new Set(['NEED', 'TIMELINE']) }), NOW).action, /Move to Qualified/);
  const quiet = new Date(NOW.getTime() - 20 * 86_400_000);
  const stalled = nextBestAction(deal({ semantic: 'PROPOSAL', known: new Set(['NEED', 'AUTHORITY']), conversation: { waitingOn: 'PROSPECT', lastInboundAt: quiet, lastOutboundAt: quiet } }), NOW);
  assert.match(stalled.why, /not a generic/);
  assert.equal(nextBestAction(deal({ nextActionOverride: 'Call Ann on Friday' }), NOW).why, 'Set by a person');
});

test('decision process, mentioned stakeholders and loss reasons come from their words', () => {
  assert.equal(qualificationKeyFor('AUTHORITY', 'I need to check with my partner'), 'DECISION_PROCESS');
  assert.equal(qualificationKeyFor('AUTHORITY', "I'm the owner"), 'AUTHORITY');
  assert.deepEqual(mentionedStakeholder('I need to check with my partner first'), { name: 'Partner (name unknown)', role: 'DECISION_MAKER' });
  assert.equal(mentionedStakeholder('Sounds good'), null);
  assert.equal(suggestLossReason([{ primaryIntent: 'OBJECTION', objections: [{ type: 'NO_BUDGET', text: 'No budget this year' }], text: '' }])?.code, 'NO_BUDGET');
  assert.equal(suggestLossReason([{ primaryIntent: 'NOT_NOW', objections: [], text: 'Maybe next year' }])?.code, 'TIMING');
});

test('a short service label from the campaign offer', async () => {
  const { shortOffer } = await import('./opportunities.js');
  assert.equal(shortOffer('We set up online booking for local businesses in a week.'), 'Online booking');
  assert.equal(shortOffer('websites with online booking'), 'Websites with online booking');
  assert.equal(shortOffer(''), null);
});
