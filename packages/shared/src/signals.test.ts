import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { assessRelevance, classifyWebsiteChange, decideStatus, parseRuleConditions, recommendAction, ruleMatches, serviceThemes, signalDedupeKey, signalExpiry, whyNow, type PageState } from './signals.js';

const page = (over: Partial<PageState> = {}): PageState => ({
  title: 'GreenScape Landscaping',
  description: null,
  text: 'GreenScape Landscaping Residential Landscaping Lawn Care Irrigation serving Austin families since 2010 call us today for a free quote',
  ctas: ['Get a Free Quote'],
  booking: false,
  chat: false,
  contactForm: true,
  technologies: ['wordpress'],
  copyrightYear: 2024,
  ...over,
});

describe('signals — relevance, why now, status', () => {
  const now = new Date('2026-10-13T10:00:00Z');
  const base = { now, sources: [{ trust: 'OFFICIAL_WEBSITE' as const, source: 'website' }], icp: 'HIGH' as const, offerThemes: ['SEO', 'LEADS', 'WEBSITE'] as ('SEO' | 'LEADS' | 'WEBSITE')[], offerNames: ['Local SEO'], relationship: 'COLD' as const };

  test('a fresh new service with a matching offer and a good ICP is strong and actionable, with a why-now', () => {
    const r = assessRelevance({ ...base, type: 'NEW_SERVICE', detectedAt: now });
    assert.equal(r.strength, 'STRONG');
    assert.equal(r.commercialRelevance, 'HIGH');
    const why = whyNow({ type: 'NEW_SERVICE', companyName: 'GreenScape', fact: 'A "Commercial Landscaping" page appeared', relevance: r, relationship: 'COLD', detectedAt: now, now });
    assert.ok(why && why.includes('Local SEO'));
    assert.equal(decideStatus(r, why, false), 'ACTIONABLE');
    assert.equal(recommendAction({ type: 'NEW_SERVICE', relationship: 'COLD', relevance: r, researchFresh: false }), 'RESEARCH');
    assert.equal(recommendAction({ type: 'NEW_SERVICE', relationship: 'COLD', relevance: r, researchFresh: true }), 'CAMPAIGN_CANDIDATE');
  });

  test('nothing approved to sell → weak, no why-now, monitor (screen #9 §45)', () => {
    const r = assessRelevance({ ...base, offerThemes: [], offerNames: [], type: 'NEW_LOCATION', detectedAt: now });
    assert.equal(r.commercialRelevance, 'LOW');
    assert.equal(r.strength, 'WEAK');
    assert.equal(whyNow({ type: 'NEW_LOCATION', companyName: 'X', fact: 'f', relevance: r, relationship: 'COLD', detectedAt: now, now }), null);
    assert.equal(decideStatus(r, null, false), 'MONITOR');
  });

  test('an old signal decays to weak', () => {
    const r = assessRelevance({ ...base, type: 'WEBSITE_CHANGE', detectedAt: new Date(now.getTime() - 50 * 86_400_000) });
    assert.equal(r.freshness, 'LOW');
    assert.equal(r.strength, 'WEAK');
  });

  test('a negative signal is never a reason to contact', () => {
    const r = assessRelevance({ ...base, type: 'WEBSITE_DOWN', detectedAt: now });
    assert.equal(r.strength, 'WEAK');
    assert.equal(decideStatus(r, null, true), 'MONITOR');
    assert.equal(recommendAction({ type: 'WEBSITE_DOWN', relationship: 'COLD', relevance: r, researchFresh: true }), 'RECHECK');
  });

  test('first-party relationship signals outrank external ones and route to the owner / re-engagement', () => {
    const r = assessRelevance({ ...base, type: 'CONTACT_LATER_DUE', sources: [{ trust: 'FIRST_PARTY', source: 'conversation' }], relationship: 'DORMANT', detectedAt: now });
    assert.equal(r.strength, 'STRONG');
    assert.equal(recommendAction({ type: 'CONTACT_LATER_DUE', relationship: 'DORMANT', relevance: r, researchFresh: true }), 'RE_ENGAGE');
    const deal = assessRelevance({ ...base, type: 'NEW_SERVICE', relationship: 'OPEN_DEAL', detectedAt: now });
    assert.equal(recommendAction({ type: 'NEW_SERVICE', relationship: 'OPEN_DEAL', relevance: deal, researchFresh: true }), 'ATTACH_TO_DEAL');
    const customer = assessRelevance({ ...base, type: 'NEW_LOCATION', relationship: 'CUSTOMER', detectedAt: now });
    assert.equal(recommendAction({ type: 'NEW_LOCATION', relationship: 'CUSTOMER', relevance: customer, researchFresh: true }), 'NOTIFY_OWNER');
  });

  test('an untrusted source stays DETECTED (needs verification)', () => {
    const r = assessRelevance({ ...base, type: 'NEW_LOCATION', sources: [{ trust: 'OTHER', source: 'rumour' }], detectedAt: now });
    assert.equal(r.sourceReliability, 'LOW');
    assert.equal(decideStatus(r, 'why', false), 'DETECTED');
  });

  test('expiry is bounded by the type lifetime; dedupe key is stable per day', () => {
    const at = new Date('2026-10-13T08:00:00Z');
    assert.equal(signalExpiry('MEETING_ASKED', at, 60).getTime(), at.getTime() + 7 * 86_400_000);
    assert.equal(signalExpiry('NEW_SERVICE', at, 3).getTime(), at.getTime() + 3 * 86_400_000);
    assert.equal(signalDedupeKey('c1', 'NEW_SERVICE', 'Commercial Landscaping', at), 'c1:NEW_SERVICE:commercial-landscaping:2026-10-13');
  });
});

describe('signals — website change intelligence', () => {
  test('a copyright year change is low value, not a signal', () => {
    const { level, changes } = classifyWebsiteChange(page(), page({ copyrightYear: 2026 }));
    assert.equal(level, 'LOW');
    assert.ok(changes.every((c) => c.signal === null));
  });

  test('a new service page and a booking tool are high-value signals with previous/current evidence', () => {
    const { level, changes } = classifyWebsiteChange(page(), page({ text: page().text + ' Commercial Landscaping for offices and HOAs Request a Commercial Quote', ctas: ['Get a Free Quote', 'Request a Commercial Quote'], booking: true }));
    assert.equal(level, 'HIGH');
    const svc = changes.find((c) => c.signal === 'NEW_SERVICE');
    assert.ok(svc && svc.subject === 'Commercial Landscaping');
    assert.ok(Array.isArray(svc.previous) && !svc.previous.includes('Commercial Landscaping'));
    assert.ok(changes.some((c) => c.signal === 'TECH_CHANGE' && c.subject === 'booking'));
    assert.ok(changes.some((c) => c.signal === 'WEBSITE_CHANGE' && c.subject === 'cta'));
  });

  test('identical pages → no change', () => {
    assert.equal(classifyWebsiteChange(page(), page()).level, 'NONE');
  });
});

describe('signals — rules and themes', () => {
  test('rules AND their conditions; empty matches everything', () => {
    const c = parseRuleConditions({ types: ['NEW_LOCATION'], minStrength: 'MEDIUM', industries: ['landscap'] });
    const subject = { type: 'NEW_LOCATION', category: 'GROWTH', strength: 'STRONG' as const, icp: 'HIGH' as const, industry: 'Landscaping', marketIds: [], relationship: 'COLD' as const };
    assert.equal(ruleMatches(c, subject), true);
    assert.equal(ruleMatches(c, { ...subject, strength: 'WEAK' }), false);
    assert.equal(ruleMatches(c, { ...subject, industry: 'Roofing' }), false);
    assert.equal(ruleMatches(parseRuleConditions({}), subject), true);
  });

  test('service themes come from the words of an approved service', () => {
    assert.deepEqual(serviceThemes('Local SEO: rank higher in Google Maps and local search; citations; review strategy'), ['SEO', 'REVIEWS']);
    assert.deepEqual(serviceThemes('Bespoke consulting'), ['GENERAL']);
  });
});
