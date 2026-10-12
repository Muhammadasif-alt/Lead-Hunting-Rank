import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractCandidates, parseDocument } from './documents.js';

test('document candidates: Q/A and question-line FAQs, price lines (never quotable by default), the text as reference', async () => {
  const text = [
    'SALES FAQ',
    '',
    'Q: Do you offer refunds?',
    'A: Yes, within 14 days if work has not started.',
    '',
    'How long does setup take?',
    'Most setups are live within two weeks.',
    '',
    'PRICING',
    '- Website Starter: $1,500',
    '- AI Automation — starting at $400/month',
    'Total: $1,900',
  ].join('\n');
  const c = extractCandidates(text, 'Sales.md');
  const faqs = c.filter((x) => x.type === 'FAQ');
  assert.deepEqual(faqs.map((f) => f.content.question), ['Do you offer refunds?', 'How long does setup take?']);
  assert.equal(faqs[1]!.content.answer, 'Most setups are live within two weeks.');
  const prices = c.filter((x) => x.type === 'PRICING');
  assert.deepEqual(prices.map((p) => [p.content.name, p.content.price, p.content.priceType, p.content.billing]), [
    ['Website Starter', 1500, 'FIXED', 'ONE_TIME'],
    ['AI Automation', 400, 'STARTING_FROM', 'MONTHLY'],
  ]);
  assert.ok(prices.every((p) => p.content.aiMayQuote === false));
  assert.equal(c.filter((x) => x.type === 'DOCUMENT').length, 1);
  assert.equal(await parseDocument('text/markdown', Buffer.from('# Hi')), '# Hi');
});
