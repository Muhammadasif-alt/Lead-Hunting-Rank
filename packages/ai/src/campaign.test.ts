import assert from 'node:assert/strict';
import { test } from 'node:test';
import { campaignAgent, checkMessage, wordCount, type DraftContext, type DraftOutput } from './agents/campaign.js';
import { EVAL_CASES } from './eval/cases.js';
import { blockingFailures } from './validators.js';

const draftCtx = (name: string, step: Partial<DraftContext['step']> = {}, previous: DraftContext['previous'] = []): DraftContext => ({
  ...EVAL_CASES.find((c) => c.name.startsWith(name))!.ctx,
  campaign: { name: 'Austin landscapers', objective: 'BOOK_MEETINGS', offer: 'online booking for local service businesses', cta: null, tone: null, avoid: [], senderName: 'Sam' },
  recipient: { firstName: 'Maria', name: 'Maria Lopez', title: 'Founder', email: 'maria@lonestar.example' },
  step: { position: 1, kind: 'FIRST_TOUCH', angle: 'FIRST_TOUCH', total: 3, ...step },
  previous,
});
const draft = (ctx: DraftContext) => campaignAgent.simulate(campaignAgent.input(ctx), ctx);
const failures = (out: DraftOutput, ctx: DraftContext) => blockingFailures(checkMessage(out, ctx)).map((f) => f.validator);

test('the rule-based draft passes every message rule for each synthetic company and step', () => {
  for (const c of EVAL_CASES) {
    for (const step of [
      { position: 1, kind: 'FIRST_TOUCH' as const, angle: 'FIRST_TOUCH' },
      { position: 2, kind: 'FOLLOW_UP' as const, angle: 'CLARIFY_VALUE' },
      { position: 3, kind: 'FOLLOW_UP' as const, angle: 'CLOSE_THE_LOOP' },
    ]) {
      const ctx = draftCtx(c.name, step, step.position > 1 ? [{ position: 1, subject: 'Online booking at X', body: 'Hi' }] : []);
      const out = draft(ctx);
      assert.deepEqual(failures(out, ctx), [], `${c.name} / ${step.angle}: ${out.body}`);
      for (const f of c.forbidden) assert.ok(!(out.body + out.subject).includes(f), `${c.name}: leaked "${f}"`);
    }
  }
});

test('a first email names an observation only with evidence, and greets the right person', () => {
  const ctx = draftCtx('well-built');
  const out = draft(ctx);
  assert.match(out.body, /^Hi Maria,/);
  assert.match(out.body, /book online/);
  assert.deepEqual(out.claims[0]?.evidenceIds.length ? 'cited' : 'none', 'cited');
  assert.ok(wordCount(out.body) <= 90);
  assert.equal((out.body.match(/\?/g) ?? []).length, 1);
  // No evidence → no observation, just a neutral opener.
  const bare = draftCtx('no website');
  bare.hypotheses = [];
  assert.equal(draft(bare).claims.length, 0);
  assert.doesNotMatch(draft(bare).body, /I (noticed|couldn't)/);
});

test('red team: rule-breaking drafts are rejected', () => {
  const ctx = draftCtx('well-built');
  const good = draft(ctx);
  const cases: [Partial<DraftOutput>, string][] = [
    [{ body: `${good.body} See https://example.com/offer` }, 'no_links'],
    [{ body: good.body.replace('?', '? Or next month?') }, 'one_question'],
    [{ body: `${good.body} ${'word '.repeat(80)}` }, 'length'],
    [{ subject: 'RE: our chat' }, 'honest_subject'],
    [{ body: good.body.replace('Hi Maria,', 'Hi Maria, I hope this finds you well.') }, 'guardrails'],
    [{ body: good.body.replace('Hi Maria,', 'Hi John,') }, 'right_person'],
    [{ body: `${good.body} Only $499 this month.` }, 'no_pricing'],
    [{ body: `${good.body} Email boss@evil-competitor.example.` }, 'contact_validity'],
    [{ body: 'Hi Maria,\n\nI noticed your website loads slowly.\n\nWorth a chat?', claims: [] }, 'grounding'],
    [{ claims: [{ text: 'made up', evidenceIds: ['e-does-not-exist'] }] }, 'grounding'],
    [{ body: `${good.body} 🚀` }, 'no_emoji'],
    [{ body: 'Hi {{first_name}}, quick idea for you. Worth a chat?' }, 'no_placeholders'],
  ];
  for (const [patch, validator] of cases) {
    assert.ok(failures({ ...good, ...patch }, ctx).includes(validator), `expected ${validator} to reject: ${JSON.stringify(patch).slice(0, 80)}`);
  }
});

test('stale evidence cannot back a personalization claim', () => {
  const ctx = draftCtx('well-built');
  ctx.evidence = ctx.evidence.map((e) => ({ ...e, freshness: 'STALE' as const }));
  const out = { ...draft(draftCtx('well-built')) };
  assert.ok(failures(out, ctx).includes('grounding'));
  // …and the rule-based draft simply doesn't make the observation.
  assert.equal(draft(ctx).claims.length, 0);
});
