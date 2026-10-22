import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { ASK_INTENTS, routeQuestion } from './ask.js';
import { lineageGaps, orderTouches, personaOf } from './attribution.js';
import { netRevenue } from './revenue.js';

describe('orderTouches', () => {
  test('time order, ties follow the chain order, positions from 1', () => {
    const at = new Date('2026-09-01T00:00:00Z');
    const out = orderTouches([
      { touchType: 'CAMPAIGN', sourceId: 'c', occurredAt: new Date('2026-09-03T00:00:00Z') },
      { touchType: 'DISCOVERY', sourceId: 'd', occurredAt: at },
      { touchType: 'MARKET', sourceId: 'm', occurredAt: at },
    ]);
    assert.deepEqual(out.map((t) => [t.touchType, t.position]), [['MARKET', 1], ['DISCOVERY', 2], ['CAMPAIGN', 3]]);
  });
});

describe('personaOf', () => {
  test('buckets titles; unknown stays unknown', () => {
    assert.equal(personaOf('Owner'), 'Owner / decision maker');
    assert.equal(personaOf('Office Manager'), 'Manager / director');
    assert.equal(personaOf('Technician'), 'Other role');
    assert.equal(personaOf(null), 'Unknown role');
  });
});

describe('lineageGaps', () => {
  test('a hand-added company and a won deal without a value are named, not filled in', () => {
    const gaps = lineageGaps(new Set(['HUMAN']), { status: 'WON', wonAmountMinor: null, amountMinor: null }, 0);
    assert.ok(gaps.includes('No discovery source on record — the company was added by hand'));
    assert.ok(gaps.includes('Won without a value — no revenue recorded'));
  });
  test('a full chain has no gaps', () => {
    assert.deepEqual(lineageGaps(new Set(['MARKET', 'DISCOVERY', 'CAMPAIGN', 'MEETING']), { status: 'WON', wonAmountMinor: 100, amountMinor: 100 }, 1), []);
  });
});

describe('netRevenue', () => {
  test('refunds subtract', () => {
    assert.equal(netRevenue([{ type: 'WON', amountMinor: 1000 }, { type: 'PAYMENT', amountMinor: 200 }, { type: 'EXPANSION', amountMinor: 300 }, { type: 'REFUND', amountMinor: 400 }]), 1100);
  });
});

describe('routeQuestion', () => {
  const cases: [string, string][] = [
    ['revenue kahan se aa raha hai?', 'REVENUE_SOURCES'],
    ['Where is our revenue coming from?', 'REVENUE_SOURCES'],
    ['compare Austin vs Dallas', 'COMPARE_MARKETS'],
    ['deals kyun haar rahe hain', 'LOST_REASONS'],
    ['Why are we losing deals?', 'LOST_REASONS'],
    ['which signals work?', 'SIGNAL_PERFORMANCE'],
    ['where is the bottleneck', 'BOTTLENECK'],
    ['kitna kharch ho raha hai, cost kahan waste hai', 'COST_WASTE'],
    ['how many companies are contactable', 'CONTACTABILITY'],
    ['meetings down kyun hain?', 'MEETINGS_TREND'],
    ['what is the weather', 'UNKNOWN'],
  ];
  for (const [q, intent] of cases) test(`"${q}" → ${intent}`, () => assert.equal(routeQuestion(q), intent));
  test('every routed intent is a known analysis', () => {
    for (const [q] of cases) {
      const i = routeQuestion(q);
      assert.ok(i === 'UNKNOWN' || (ASK_INTENTS as readonly string[]).includes(i));
    }
  });
});
