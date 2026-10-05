import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessCoverage, buildStrategies, findIndustry, interpretMarketRequest, marketKey, planRound, type RoundStats } from './discovery.js';

const AUSTIN = { country: 'US', region: 'TX', city: 'Austin' };

test('understands the roadmap command (Roman Urdu + English)', () => {
  const r = interpretMarketRequest('Austin, Texas ke landscapers Market Exhaust mode mein find karo');
  assert.equal(r.industry, 'landscaping');
  assert.deepEqual(r.location, AUSTIN);
  assert.equal(r.mode, 'MARKET_EXHAUST');
  assert.deepEqual(r.missing, []);

  const q = interpretMarketRequest('quick hunt: plumbers in Dallas without a website');
  assert.equal(q.industry, 'plumbing');
  assert.equal(q.location.city, 'Dallas');
  assert.equal(q.mode, 'QUICK');
  assert.equal(q.websiteFilter, 'WITHOUT');

  assert.equal(interpretMarketRequest('Texas → Austin ke tamam landscapers, website ho ya na ho').websiteFilter, 'ANY');
  assert.equal(interpretMarketRequest('irrigation companies in Austin').industry, 'irrigation');
});

test('an unknown city before a state is kept; missing parts are reported, not guessed', () => {
  const r = interpretMarketRequest('roofers in Pflugerville, TX');
  assert.deepEqual(r.location, { city: 'Pflugerville', region: 'TX', country: 'US' });
  const none = interpretMarketRequest('find me some leads');
  assert.equal(none.industry, null);
  assert.deepEqual(none.missing, ['industry', 'location']);
});

test('categories group under one market; the market key ignores how it was typed', () => {
  assert.equal(findIndustry('lawn care')?.key, 'landscaping');
  assert.equal(marketKey(AUSTIN, 'Landscapers'), marketKey({ country: 'us', region: 'tx', city: 'austin ' }, 'landscaping'));
  assert.notEqual(marketKey(AUSTIN, 'roofing'), marketKey(AUSTIN, 'landscaping'));
});

test('strategies widen with the mode; rounds are bounded batches that never repeat a query on a source', () => {
  assert.equal(buildStrategies('landscaping', AUSTIN, { mode: 'QUICK' }).length, 1);
  const deep = buildStrategies('landscaping', AUSTIN, { mode: 'DEEP' });
  assert.ok(deep.every((s) => s.type === 'PRIMARY_CATEGORY' || s.type === 'RELATED_CATEGORY'));
  const exhaust = buildStrategies('landscaping', AUSTIN, { mode: 'MARKET_EXHAUST' });
  assert.ok(exhaust.length > deep.length);
  assert.equal(new Set(exhaust.map((s) => s.key)).size, exhaust.length);

  const sources = [{ key: 'a' }, { key: 'b' }];
  const used = new Set<string>();
  const r1 = planRound({ strategies: exhaust, sources, used, mode: 'MARKET_EXHAUST', queriesSoFar: 0, maxQueries: 80 });
  assert.equal(r1.length, 8); // 4 per source
  for (const p of r1) used.add(`${p.source.key}|${p.strategy.key}`);
  const r2 = planRound({ strategies: exhaust, sources, used, mode: 'MARKET_EXHAUST', queriesSoFar: 8, maxQueries: 10 });
  assert.equal(r2.length, 2, 'respects the remaining query budget');
  assert.deepEqual(r2.map((p) => p.source.key), ['a', 'b'], 'shared fairly between sources');
  assert.ok(r2.every((p) => !used.has(`${p.source.key}|${p.strategy.key}`)));
  // QUICK only asks the preferred source.
  assert.deepEqual(planRound({ strategies: exhaust, sources, used: new Set(), mode: 'QUICK', queriesSoFar: 0, maxQueries: 1 }).map((p) => p.source.key), ['a']);
});

const rounds = (...news: number[]): RoundStats[] => {
  let total = 0;
  return news.map((n, i) => ({ round: i + 1, queries: 8, observations: n * 2 + 20, newUnique: n, cumulativeUnique: (total += n) }));
};
const base = { mode: 'MARKET_EXHAUST' as const, totalObservations: 600, strategiesRemaining: 10, queriesUsed: 16, maxQueries: 80, callsUsed: 40, maxProviderCalls: 500, sourcesSearched: 2, strategyTypesSearched: 3 };

test('keeps hunting while new businesses keep appearing; stops when the yield dries up (143 → 39 → 11 → 2)', () => {
  assert.equal(assessCoverage({ ...base, rounds: rounds(143) }).decision, 'CONTINUE');
  assert.equal(assessCoverage({ ...base, rounds: rounds(143, 39) }).decision, 'CONTINUE');
  const r3 = assessCoverage({ ...base, rounds: rounds(143, 39, 11) });
  assert.equal(r3.decision, 'CONTINUE');
  const done = assessCoverage({ ...base, rounds: rounds(143, 39, 11, 2) });
  assert.equal(done.decision, 'COMPLETE');
  assert.equal(done.stopReason, 'SATURATED');
  assert.equal(done.confidence, 'HIGH');
  assert.ok(done.marginalYield < 0.02);
});

test('coverage confidence stays honest: one source or an early stop is never HIGH', () => {
  const single = assessCoverage({ ...base, sourcesSearched: 1, rounds: rounds(143, 39, 11, 2) });
  assert.equal(single.stopReason, 'SATURATED');
  assert.equal(single.confidence, 'MEDIUM');
  assert.ok(single.reasons.some((r) => r.includes('one source')));

  const budget = assessCoverage({ ...base, queriesUsed: 80, rounds: rounds(143, 60) });
  assert.equal(budget.stopReason, 'QUERY_BUDGET');
  assert.equal(budget.confidence, 'LOW');

  const quick = assessCoverage({ ...base, mode: 'QUICK', rounds: rounds(40) });
  assert.equal(quick.stopReason, 'ROUND_LIMIT');
  assert.equal(quick.confidence, 'LOW');

  const empty = assessCoverage({ ...base, rounds: rounds(0, 0) });
  assert.equal(empty.decision, 'COMPLETE');
  assert.equal(empty.confidence, 'LOW');
});
