import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { attributeDeal, buildFunnel, compareKpi, detectAnomalies, FUNNEL_STAGES, freshnessState, median, resolvePeriod, type FunnelStageKey, type TouchLike } from './analytics.js';

const NOW = new Date('2026-10-15T13:30:00.000Z');

describe('resolvePeriod', () => {
  test('30d ends at the end of today (exclusive) and the previous period is equally long', () => {
    const { current, previous } = resolvePeriod('30d', NOW);
    assert.equal(current.to, '2026-10-16T00:00:00.000Z');
    assert.equal(current.from, '2026-09-16T00:00:00.000Z');
    assert.equal(previous.to, current.from);
    assert.equal(new Date(previous.to).getTime() - new Date(previous.from).getTime(), 30 * 86_400_000);
  });
  test('month / quarter / year to date start on the calendar boundary', () => {
    assert.equal(resolvePeriod('mtd', NOW).current.from, '2026-10-01T00:00:00.000Z');
    assert.equal(resolvePeriod('qtd', NOW).current.from, '2026-10-01T00:00:00.000Z');
    assert.equal(resolvePeriod('ytd', NOW).current.from, '2026-01-01T00:00:00.000Z');
  });
  test('custom includes the end day', () => {
    const { current, previous } = resolvePeriod('custom', NOW, { from: '2026-09-01', to: '2026-09-10' });
    assert.equal(current.from, '2026-09-01T00:00:00.000Z');
    assert.equal(current.to, '2026-09-11T00:00:00.000Z');
    assert.equal(previous.from, '2026-08-22T00:00:00.000Z');
  });
});

describe('compareKpi', () => {
  test('few observations are flagged low-sample; direction follows the change', () => {
    const k = compareKpi('meetingsBooked', 4, 2);
    assert.equal(k.lowSample, true);
    assert.equal(k.direction, 'BETTER');
    assert.equal(k.delta, 2);
    assert.equal(k.deltaPct, 100);
  });
  test('cost metrics: lower is better', () => {
    const k = compareKpi('providerCost', 500, 1000, 50);
    assert.equal(k.direction, 'BETTER');
    assert.equal(k.lowSample, false);
    assert.equal(compareKpi('providerCost', 1500, 1000, 50).direction, 'WORSE');
  });
  test('unknown values are never compared; a previous zero has no percentage', () => {
    const k = compareKpi('winRate', null, 40);
    assert.equal(k.direction, null);
    assert.equal(k.delta, null);
    assert.equal(compareKpi('replies', 12, 0).deltaPct, null);
  });
  test('small changes are flat', () => {
    assert.equal(compareKpi('replies', 102, 100).direction, 'FLAT');
  });
});

describe('attributeDeal', () => {
  const touches: TouchLike[] = [
    { touchType: 'CAMPAIGN', sourceId: 'c', label: 'Campaign', occurredAt: '2026-09-03T00:00:00Z' },
    { touchType: 'MARKET', sourceId: 'm', label: 'Market', occurredAt: '2026-09-01T00:00:00Z' },
    { touchType: 'MEETING', sourceId: 'x', label: 'Meeting', occurredAt: '2026-09-09T00:00:00Z' },
  ];
  test('LINEAR splits into integers that add up to the amount', () => {
    const out = attributeDeal(touches, 100_001, 'LINEAR');
    assert.equal(out.reduce((a, c) => a + c.creditMinor, 0), 100_001);
    assert.deepEqual(out.map((c) => c.touch.touchType), ['MARKET', 'CAMPAIGN', 'MEETING']);
  });
  test('first / last touch and full credit', () => {
    assert.equal(attributeDeal(touches, 900, 'FIRST_TOUCH').find((c) => c.creditMinor > 0)!.touch.touchType, 'MARKET');
    assert.equal(attributeDeal(touches, 900, 'LAST_TOUCH').find((c) => c.creditMinor > 0)!.touch.touchType, 'MEETING');
    assert.ok(attributeDeal(touches, 900, 'FULL').every((c) => c.creditMinor === 900));
    assert.deepEqual(attributeDeal([], 900, 'LINEAR'), []);
  });
});

describe('buildFunnel', () => {
  const counts = (vals: number[]) => Object.fromEntries(FUNNEL_STAGES.map((k, i) => [k, vals[i] ?? 0])) as Record<FunnelStageKey, number>;
  test('the leak is the stage whose conversion worsened most vs the previous period', () => {
    const cur = counts([100, 80, 60, 50, 10, 5, 4, 3, 2, 1]);
    const prev = counts([100, 80, 60, 50, 25, 12, 4, 3, 2, 1]);
    const f = buildFunnel(cur, prev);
    assert.equal(f.filter((s) => s.leak).length, 1);
    assert.equal(f.find((s) => s.leak)!.key, 'replied');
    assert.equal(f[0]!.conversion, null);
    assert.equal(f[1]!.conversion, 80);
  });
  test('without a previous period the lowest conversion with enough volume is the leak', () => {
    const f = buildFunnel(counts([100, 90, 80, 70, 7, 6, 5, 4, 3, 2]));
    assert.equal(f.find((s) => s.leak)!.key, 'replied');
  });
  test('an empty funnel names no leak', () => {
    assert.equal(buildFunnel(counts([])).some((s) => s.leak), false);
  });
});

describe('detectAnomalies', () => {
  const series = (vals: number[]) => vals.map((value, i) => ({ day: `2026-09-${String(i + 1).padStart(2, '0')}`, value }));
  test('a quiet series never alarms', () => {
    assert.deepEqual(detectAnomalies('replies', series([0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 9])), []);
  });
  test('a spike far above a steady baseline is reported', () => {
    const out = detectAnomalies('replies', series([10, 11, 9, 10, 12, 10, 9, 11, 10, 10, 11, 9, 10, 10, 40]));
    assert.equal(out.length, 1);
    assert.equal(out[0]!.direction, 'SPIKE');
    assert.equal(out[0]!.day, '2026-09-15');
  });
  test('median', () => {
    assert.equal(median([]), null);
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
  });
});

describe('freshnessState', () => {
  test('current within cadence, delayed up to 3×, stale beyond; not connected wins', () => {
    assert.equal(freshnessState(new Date(NOW.getTime() - 5 * 60_000), 10, NOW), 'CURRENT');
    assert.equal(freshnessState(new Date(NOW.getTime() - 25 * 60_000), 10, NOW), 'DELAYED');
    assert.equal(freshnessState(new Date(NOW.getTime() - 31 * 60_000), 10, NOW), 'STALE');
    assert.equal(freshnessState(null, 10, NOW), 'STALE');
    assert.equal(freshnessState(NOW, 10, NOW, false), 'NOT_CONNECTED');
  });
});
