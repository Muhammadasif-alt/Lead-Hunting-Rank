import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { answerQuestion, brainRules, chunkKnowledge, keywordScore, moneyAmountsIn, prohibitedClaimIn, questionKey, renderKnowledgeText, testEmbedding, cosine, validateKnowledge, type ApprovedKnowledge, type Candidate, type KnowledgeType } from './knowledge.js';

let n = 0;
function item(type: KnowledgeType, content: Record<string, unknown>, extra: Partial<ApprovedKnowledge> = {}): ApprovedKnowledge {
  const { content: c, errors } = validateKnowledge(type, content);
  assert.deepEqual(errors, [], `${type} content invalid: ${errors.join(', ')}`);
  n++;
  const title = String(c.name ?? c.question ?? c.claim ?? `${type} ${n}`);
  return { itemId: `i${n}`, revisionId: `r${n}`, code: `KB-${type}-${n}`, type, title, version: 1, content: c, text: renderKnowledgeText(type, c), stale: false, conflicted: false, serviceItemId: null, authorityLevel: type === 'POLICY' ? 1 : 2, ...extra };
}
const cands = (...items: ApprovedKnowledge[]): Candidate[] => items.map((k) => ({ k, semantic: null }));

const setupFaq = item('FAQ', { question: 'How long does setup take?', answer: 'Most setups are live within two weeks once we have access to your website.', category: 'IMPLEMENTATION' });
const starter = item('PRICING', { name: 'Website Starter', currency: 'USD', priceType: 'FIXED', price: 1500, billing: 'ONE_TIME', aiMayQuote: true, quantityUnit: 'locations', includedQuantity: 5, perExtraUnit: 200, maxQuantity: 7 });
const automation = item('PRICING', { name: 'AI Automation', currency: 'USD', priceType: 'STARTING_FROM', price: 400, billing: 'MONTHLY', aiMayQuote: false });
const jobber = item('INTEGRATION', { name: 'Jobber', status: 'SUPPORTED_WITH_CONDITIONS', conditions: ['you are on a Jobber plan with API access'], capabilities: ['Lead sync', 'Job creation'] });
const hubspot = item('INTEGRATION', { name: 'HubSpot', status: 'PLANNED' });
const refunds = item('POLICY', { topic: 'REFUND', statement: 'Setup fees are refundable within 14 days if work has not started.' });

describe('Answer Engine — approved truth or a person', () => {
  test('a differently worded question still finds the approved FAQ (and answers verbatim)', () => {
    const a = answerQuestion('How soon could we get this running?', cands(setupFaq, starter, jobber));
    assert.equal(a.decision, 'ANSWER');
    assert.equal(a.answer, setupFaq.content.answer);
    assert.equal(a.used[0]!.code, setupFaq.code);
  });

  test('pricing: quoted from the structured record, computed only by an approved rule, custom above the range', () => {
    const plain = answerQuestion('How much is the Website Starter?', cands(starter, automation));
    assert.equal(plain.decision, 'ANSWER');
    assert.match(plain.answer!, /\$1,500/);
    assert.deepEqual(plain.amounts.includes(1500), true);
    const seven = answerQuestion('What would the Website Starter cost for 7 locations?', cands(starter));
    assert.equal(seven.decision, 'ANSWER');
    assert.match(seven.answer!, /\$1,900/); // 1500 + 2 × 200
    const eight = answerQuestion('How much for 8 locations?', cands(starter));
    assert.equal(eight.decision, 'ESCALATE');
    assert.match(eight.reason, /above the approved range/);
  });

  test('pricing the AI may not quote, a stale price, a conflict, or pricing turned off → a person', () => {
    assert.match(answerQuestion('How much is AI Automation?', cands(automation)).reason, /may not quote/);
    assert.match(answerQuestion('How much is the Website Starter?', cands({ ...starter, stale: true })).reason, /review date/);
    const c = answerQuestion('How much is the Website Starter?', cands({ ...starter, conflicted: true }));
    assert.equal(c.decision, 'ESCALATE');
    assert.equal(c.conflicts.length, 1);
    assert.match(answerQuestion('How much is the Website Starter?', cands(starter), { pricingAnswers: false, technicalClaims: true }).reason, /turned off/);
  });

  test('integrations: supported with conditions, planned ≠ supported, unknown system is a gap', () => {
    const j = answerQuestion('Does it integrate with Jobber?', cands(jobber, hubspot));
    assert.equal(j.decision, 'ANSWER');
    assert.match(j.answer!, /as long as you are on a Jobber plan/);
    assert.match(answerQuestion('Can you connect to HubSpot?', cands(jobber, hubspot)).answer!, /planned but not available/);
    const x = answerQuestion('Does it work with XYZPro v9?', cands(jobber, hubspot));
    assert.equal(x.decision, 'ESCALATE');
    assert.equal(x.gap, true);
  });

  test('discounts, legal changes and delivery promises always go to a person; policy explained; nothing known = gap', () => {
    assert.equal(answerQuestion('Can you do it for $1,000 instead?', cands(starter)).decision, 'ESCALATE');
    assert.equal(answerQuestion('Any discount if we sign this week?', cands(starter)).decision, 'ESCALATE');
    assert.equal(answerQuestion('Can you change the liability clause in the contract?', cands(refunds)).topic, 'LEGAL');
    assert.equal(answerQuestion('Can you have it finished by Friday?', cands(setupFaq)).decision, 'ESCALATE');
    const r = answerQuestion('What is your refund policy?', cands(refunds));
    assert.equal(r.decision, 'ANSWER');
    assert.match(r.answer!, /14 days/);
    assert.equal(answerQuestion('Can I make an exception to the refund policy?', cands(refunds)).decision, 'ESCALATE');
    const none = answerQuestion('Do you build mobile apps?', cands(setupFaq));
    assert.equal(none.decision, 'ESCALATE');
    assert.equal(none.gap, true);
  });

  test('an approved discount the AI may mention is the only one it names', () => {
    const annual = item('PRICING', { name: 'SEO Retainer', currency: 'USD', priceType: 'FIXED', price: 900, billing: 'MONTHLY', aiMayQuote: true, discounts: [{ name: 'Annual payment', percent: 10, condition: 'paid yearly upfront', aiMayMention: true }] });
    const a = answerQuestion('Do you offer any discounts?', cands(annual));
    assert.equal(a.decision, 'ANSWER');
    assert.match(a.answer!, /10% off SEO Retainer/);
  });
});

describe('Business Brain checks and building blocks', () => {
  test('prohibited claims from the KB and built-in compliance claims are caught; money amounts read', () => {
    const svc = item('SERVICE', { name: 'Lead Automation', description: 'Automated follow-up', prohibitedClaims: ['Guaranteed 3x revenue'] });
    const rules = brainRules([svc]);
    assert.equal(prohibitedClaimIn('We deliver guaranteed 3x revenue for clients.', rules), 'Guaranteed 3x revenue');
    assert.ok(prohibitedClaimIn('Our platform is SOC 2 certified.', rules));
    assert.equal(prohibitedClaimIn('Most setups are live within two weeks.', rules), null);
    assert.deepEqual(moneyAmountsIn('It is $1,500 one-time, or USD 400 per month, about 2k total? no: $2k'), [1500, 400, 2000]);
  });

  test('validation, text, chunks, gap keys and test vectors', () => {
    assert.ok(validateKnowledge('PRICING', { name: 'X', currency: 'USD', priceType: 'RANGE', price: 10 }).errors.some((e) => /range/.test(e)));
    assert.ok(validateKnowledge('CLAIM', { kind: 'APPROVED', claim: '120+ projects' }).errors.some((e) => /evidence/.test(e)));
    assert.match(renderKnowledgeText('PRICING', starter.content), /Price \(or minimum\): \$1,500/);
    const svc = item('SERVICE', { name: 'Websites', description: 'Fast sites', capabilities: ['Design'], limitations: ['No guaranteed rankings'] });
    assert.equal(chunkKnowledge('SERVICE', svc.title, svc.content).length, 3);
    assert.equal(chunkKnowledge('FAQ', setupFaq.title, setupFaq.content).length, 1);
    assert.equal(questionKey('How long does setup take?'), questionKey('how long does the set up take'));
    assert.ok(keywordScore('How soon could we get this running?', 'How long does setup take?') >= 0.99);
    assert.ok(cosine(testEmbedding('How soon could we get this running?'), testEmbedding('How long does setup take?')) > cosine(testEmbedding('How soon could we get this running?'), testEmbedding('What is your refund policy?')));
  });
});
