import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classifyWebsiteChange } from '@revenue-os/shared';
import { offerFor, trustOf } from './context.js';
import { ctasFromFindings, expansionCluster, isComeBackRequest, negativeAboutSolution, pageStateOf } from './detect-rules.js';
import { ruleInterpretation } from './interpret.js';
import { queueOrder } from './queries.js';
import { parseSignalSearch } from './search.js';

const NOW = new Date('2026-10-15T12:00:00.000Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('detection rules', () => {
  test('page state from a snapshot + audit', () => {
    const findings = [{ key: 'cta', observed: true, detail: 'Buttons/links ask visitors to: get a quote, book now.' }];
    assert.deepEqual(ctasFromFindings(findings), ['get a quote', 'book now']);
    const s = pageStateOf({ title: 'Evergreen', textExcerpt: 'Lawn care in Austin', metadata: { description: 'Lawn care' } }, { hasBooking: false, hasChat: null, hasContactForm: true, technologySummary: ['WordPress'], copyrightYear: 2025, findings });
    assert.equal(s.description, 'Lawn care');
    assert.equal(s.booking, false);
    assert.deepEqual(s.technologies, ['WordPress']);
    assert.equal(pageStateOf({ title: null, textExcerpt: null, metadata: null }, null).booking, null);
  });

  test('a new service is a HIGH change; the copyright year alone is LOW with no signal', () => {
    const base = 'Evergreen Lawn Care offers Lawn Mowing Services and Hedge Trimming for homes across Austin. Call for a free estimate today.';
    const audit = { hasBooking: false, hasChat: false, hasContactForm: true, technologySummary: [], copyrightYear: 2025, findings: [] };
    const prev = pageStateOf({ title: 'Evergreen', textExcerpt: base, metadata: {} }, audit);
    const added = classifyWebsiteChange(prev, pageStateOf({ title: 'Evergreen', textExcerpt: `${base} New: Commercial Irrigation Installation.`, metadata: {} }, audit));
    assert.ok(added.changes.some((c) => c.signal === 'NEW_SERVICE'));
    const copyright = classifyWebsiteChange(prev, pageStateOf({ title: 'Evergreen', textExcerpt: base, metadata: {} }, { ...audit, copyrightYear: 2026 }));
    assert.equal(copyright.level, 'LOW');
    assert.ok(copyright.changes.every((c) => c.signal === null));
  });

  test('wording checks', () => {
    assert.ok(negativeAboutSolution('Honestly our current agency is too slow and we are frustrated'));
    assert.ok(!negativeAboutSolution('We use Acme for our website'));
    assert.ok(isComeBackRequest('Please contact us again after the busy season'));
    assert.ok(isComeBackRequest('Follow up in January'));
    assert.ok(!isComeBackRequest('Send the signed contract'));
  });

  test('expansion needs 3 different growth/digital types within 90 days', () => {
    const s = (type: string, category: string, d: number) => ({ type, category, detectedAt: daysAgo(d) });
    assert.deepEqual(expansionCluster([s('NEW_SERVICE', 'GROWTH', 3), s('TECH_CHANGE', 'DIGITAL', 10)], NOW), []);
    assert.equal(expansionCluster([s('NEW_SERVICE', 'GROWTH', 3), s('TECH_CHANGE', 'DIGITAL', 10), s('WEBSITE_CHANGE', 'DIGITAL', 20)], NOW).length, 3);
    // Old, negative and the cluster itself don't count.
    assert.deepEqual(expansionCluster([s('NEW_SERVICE', 'GROWTH', 3), s('TECH_CHANGE', 'DIGITAL', 120), s('WEBSITE_DOWN', 'DIGITAL', 2), s('EXPANSION', 'GROWTH', 1)], NOW), []);
  });
});

describe('relevance inputs', () => {
  test('trust by source', () => {
    assert.equal(trustOf('CONVERSATION'), 'FIRST_PARTY');
    assert.equal(trustOf('WEBSITE'), 'OFFICIAL_WEBSITE');
    assert.equal(trustOf('LEAD_SOURCE'), 'LEAD_SOURCE');
    assert.equal(trustOf('somewhere'), 'OTHER');
  });

  test('offer: only approved services that fit the type are named', () => {
    const services = [{ name: 'Local SEO', themes: ['SEO' as const] }, { name: 'Chatbot', themes: ['CHAT' as const] }];
    const o = offerFor('NEW_SERVICE', services);
    assert.deepEqual(o.offerNames, ['Local SEO']);
    assert.deepEqual(o.offerThemes.sort(), ['CHAT', 'SEO']);
    assert.deepEqual(offerFor('PRICING_ASKED', services).offerNames, []);
    assert.deepEqual(offerFor('NEW_SERVICE', []).offerThemes, []);
  });
});

describe('interpretation', () => {
  test('every rule interpretation is hedged', () => {
    for (const t of ['NEW_SERVICE', 'WEBSITE_DOWN', 'WEBSITE_BACK', 'NEW_TO_DATASET', 'CONTACT_LATER_DUE', 'PRICING_ASKED', 'EXPANSION', 'SOMETHING_ELSE']) {
      assert.match(ruleInterpretation(t, { matchedServices: ['Local SEO'], commercialRelevance: 'HIGH' }), /\b(may|might|could)\b/, t);
    }
  });
});

describe('queue + search', () => {
  test('priority, then first-party, then strength, then freshness', () => {
    const s = (o: Partial<{ priority: boolean; category: string; relationship: string; strength: string; d: number }>) => ({ priority: o.priority ?? false, category: o.category ?? 'GROWTH', relationship: o.relationship ?? 'COLD', strength: (o.strength ?? 'MEDIUM') as 'MEDIUM', detectedAt: daysAgo(o.d ?? 1) });
    const list = [s({ strength: 'STRONG' }), s({ category: 'CONVERSATION' }), s({ priority: true, strength: 'WEAK' }), s({ d: 0 })].sort(queueOrder);
    assert.equal(list[0]!.priority, true);
    assert.equal(list[1]!.category, 'CONVERSATION');
    assert.equal(list[2]!.strength, 'STRONG');
  });

  test('plain-language search → filters with explanation', () => {
    const markets = [{ id: 'm1', name: 'Austin landscapers', city: 'Austin' }];
    const r = parseSignalSearch('Austin landscapers that added a new service recently', markets);
    assert.equal(r.filters.type, 'NEW_SERVICE');
    assert.equal(r.filters.days, 14);
    assert.equal(r.filters.marketId, 'm1');
    assert.ok(r.explanation.some((e) => e.includes('Market')));
    const f = parseSignalSearch('strong follow-ups for old prospects this week', markets);
    assert.equal(f.filters.type, 'CONTACT_LATER_DUE');
    assert.equal(f.filters.strength, 'STRONG');
    assert.equal(f.filters.relationship, 'DORMANT');
    assert.equal(f.filters.days, 7);
    assert.equal(parseSignalSearch('lost deal revisits', markets).filters.relationship, undefined);
    const text = parseSignalSearch('Evergreen', markets);
    assert.equal(text.filters.q, 'Evergreen');
  });
});
