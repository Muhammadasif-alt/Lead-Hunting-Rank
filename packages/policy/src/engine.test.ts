import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_POLICY_SETTINGS } from '@revenue-os/shared';
import { evaluate, requiredAutonomy } from './engine.js';
import { inSendWindow, nextLocalMidnight, nextWindowStart } from './time.js';
import type { PolicyContext, PolicyRequest } from './types.js';

const NOW = '2026-01-06T11:00:00.000Z'; // Tuesday 11:00 UTC — inside the default window

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  now: NOW,
  timezone: 'UTC',
  workspaceStatus: 'ACTIVE',
  outboundState: 'ACTIVE',
  policyVersion: 1,
  settings: DEFAULT_POLICY_SETTINGS,
  autonomy: { workspace: 'L1', agent: null, agentEnabled: null },
  actorPermissions: ['conversation.send', 'company.read'],
  recipients: ['owner@prospect.example'],
  suppressions: [],
  invalidRecipients: [],
  firstTouch: true,
  sentToday: 0,
  lastContactAt: null,
  providerAvailable: null,
  approval: null,
  fingerprint: 'fp',
  ...over,
});

const human: PolicyRequest = {
  stage: 'EXECUTION',
  actionType: 'email.send',
  actor: { type: 'HUMAN', id: 'u1' },
  entity: { type: 'PERSON', id: 'p1' },
  payload: { to: ['owner@prospect.example'] },
};
const ai: PolicyRequest = { ...human, actor: { type: 'AI_AGENT', id: null, agentType: 'CAMPAIGN' } };
const approved = { id: 'a1', status: 'APPROVED' as const, fingerprint: 'fp', expiresAt: '2026-01-07T11:00:00.000Z' };

test('a permitted human send inside the window is ACT', () => {
  assert.equal(evaluate(human, ctx()).decision, 'ACT');
});

// ── Phase 10 Definition of Done (docs/17 §62-66) ──

test('DoD: a suppressed contact cannot be sent to — even approved, at L4', () => {
  const r = evaluate(ai, ctx({ suppressions: [{ id: 's', scope: 'EMAIL', reason: 'UNSUBSCRIBED' }], approval: approved, autonomy: { workspace: 'L4', agent: null, agentEnabled: true } }));
  assert.equal(r.decision, 'BLOCK');
  assert.deepEqual(r.reasonCodes, ['SUPPRESSED_CONTACT']);
  assert.equal(evaluate(human, ctx({ suppressions: [{ id: 's', scope: 'COMPANY', reason: 'DO_NOT_CONTACT' }] })).decision, 'BLOCK');
});

test('DoD: the kill switch stops sending — emergency stop blocks, pause waits', () => {
  assert.deepEqual(evaluate(human, ctx({ outboundState: 'EMERGENCY_STOP' })).reasonCodes, ['GLOBAL_EMERGENCY_STOP']);
  assert.equal(evaluate(ai, ctx({ outboundState: 'EMERGENCY_STOP', approval: approved })).decision, 'BLOCK');
  const paused = evaluate(human, ctx({ outboundState: 'PAUSED' }));
  assert.equal(paused.decision, 'WAIT');
  assert.deepEqual(paused.reasonCodes, ['GLOBAL_OUTBOUND_PAUSED']);
});

test('DoD: unauthorized AI cannot send', () => {
  // An agent without send authority is blocked whatever the autonomy level — a human's permission never transfers.
  const research = evaluate({ ...ai, actor: { type: 'AI_AGENT', id: null, agentType: 'RESEARCH' } }, ctx({ autonomy: { workspace: 'L4', agent: null, agentEnabled: true } }));
  assert.deepEqual([research.decision, research.reasonCodes], ['BLOCK', ['AI_NOT_AUTHORIZED']]);
  // A sending agent below the needed autonomy has to ask.
  const low = evaluate(ai, ctx({ firstTouch: false, autonomy: { workspace: 'L1', agent: null, agentEnabled: true } }));
  assert.deepEqual([low.decision, low.reasonCodes], ['ASK', ['AUTONOMY_TOO_LOW']]);
  // A disabled agent is blocked.
  assert.equal(evaluate(ai, ctx({ autonomy: { workspace: 'L4', agent: null, agentEnabled: false } })).decision, 'BLOCK');
  // An agent can be set lower than the workspace, never higher.
  assert.equal(evaluate(ai, ctx({ firstTouch: false, autonomy: { workspace: 'L1', agent: 'L4', agentEnabled: true } })).decision, 'ASK');
  assert.equal(evaluate(ai, ctx({ firstTouch: false, autonomy: { workspace: 'L4', agent: 'L1', agentEnabled: true } })).decision, 'ASK');
  // A human without the permission is blocked; an unknown actor too.
  assert.equal(evaluate(human, ctx({ actorPermissions: ['company.read'] })).decision, 'BLOCK');
  assert.equal(evaluate(human, ctx({ actorPermissions: null })).decision, 'BLOCK');
  assert.equal(evaluate({ ...human, actor: { type: 'SYSTEM', id: null } }, ctx()).decision, 'BLOCK');
});

test('DoD: a stale or expired approval cannot send', () => {
  const stale = evaluate(ai, ctx({ approval: { ...approved, fingerprint: 'edited' } }));
  assert.equal(stale.decision, 'ASK');
  assert.ok(stale.reasonCodes.includes('APPROVAL_STALE'));
  const expired = evaluate(ai, ctx({ approval: { ...approved, expiresAt: '2026-01-06T10:59:00.000Z' } }));
  assert.equal(expired.decision, 'ASK');
  assert.ok(expired.reasonCodes.includes('APPROVAL_EXPIRED'));
  assert.equal(evaluate(ai, ctx({ approval: { ...approved, status: 'REJECTED' } })).decision, 'BLOCK');
  const ok = evaluate(ai, ctx({ approval: approved }));
  assert.deepEqual([ok.decision, ok.reasonCodes], ['ACT', ['APPROVAL_GRANTED']]);
});

test('DoD: policy failure never defaults to allow — unknown actions are denied', () => {
  const r = evaluate({ ...human, actionType: 'payment.refund' }, ctx());
  assert.deepEqual([r.decision, r.reasonCodes], ['BLOCK', ['POLICY_UNKNOWN_ACTION']]);
  assert.equal(evaluate(human, ctx({ recipients: [] })).decision, 'BLOCK');
  assert.equal(evaluate(human, ctx({ workspaceStatus: 'SUSPENDED' })).decision, 'BLOCK');
});

// ── autonomy ladder ──

test('autonomy: L2 sends follow-ups on its own, first outreach needs L3 (and first-touch approval if on)', () => {
  assert.equal(requiredAutonomy(false), 'L2');
  assert.equal(requiredAutonomy(true), 'L3');
  const l2 = { autonomy: { workspace: 'L2' as const, agent: null, agentEnabled: true } };
  assert.equal(evaluate(ai, ctx({ ...l2, firstTouch: false })).decision, 'ACT');
  assert.equal(evaluate(ai, ctx({ ...l2, firstTouch: true })).decision, 'ASK');
  const l3 = { autonomy: { workspace: 'L3' as const, agent: null, agentEnabled: true } };
  assert.deepEqual(evaluate(ai, ctx({ ...l3 })).reasonCodes, ['FIRST_TOUCH_REQUIRES_APPROVAL']);
  assert.equal(evaluate(ai, ctx({ ...l3, settings: { ...DEFAULT_POLICY_SETTINGS, firstTouchApproval: false } })).decision, 'ACT');
});

// ── operational limits ──

test('outside the send window waits until the window opens', () => {
  const r = evaluate(human, ctx({ now: '2026-01-06T02:14:00.000Z' }));
  assert.equal(r.decision, 'WAIT');
  assert.deepEqual(r.reasonCodes, ['OUTSIDE_SEND_WINDOW']);
  assert.equal(r.resumeAt, '2026-01-06T09:00:00.000Z');
  // Friday evening → Monday 09:00
  assert.equal(evaluate(human, ctx({ now: '2026-01-09T18:00:00.000Z' })).resumeAt, '2026-01-12T09:00:00.000Z');
});

test('daily limit and contact cool-down wait — and the wait lands inside the window', () => {
  const full = evaluate(human, ctx({ sentToday: 50 }));
  assert.deepEqual([full.decision, full.reasonCodes, full.resumeAt], ['WAIT', ['DAILY_LIMIT_REACHED'], '2026-01-07T09:00:00.000Z']);
  const recent = evaluate(human, ctx({ lastContactAt: '2026-01-05T15:00:00.000Z' }));
  assert.deepEqual([recent.decision, recent.reasonCodes, recent.resumeAt], ['WAIT', ['FREQUENCY_CAP'], '2026-01-08T15:00:00.000Z']);
  assert.equal(evaluate(human, ctx({ lastContactAt: '2026-01-01T11:00:00.000Z' })).decision, 'ACT');
});

test('a disconnected mailbox waits; BLOCK beats ASK beats WAIT', () => {
  assert.deepEqual(evaluate(human, ctx({ providerAvailable: false })).reasonCodes, ['PROVIDER_UNAVAILABLE']);
  // Suppressed + paused + needs approval → BLOCK
  assert.equal(evaluate(ai, ctx({ suppressions: [{ id: 's', scope: 'EMAIL', reason: 'MANUAL' }], outboundState: 'PAUSED' })).decision, 'BLOCK');
  // Needs approval + outside window → ASK first; the window applies after approval
  assert.equal(evaluate(ai, ctx({ now: '2026-01-06T02:00:00.000Z' })).decision, 'ASK');
});

test('non-outbound internal actions are not stopped by the kill switch', () => {
  const r = evaluate({ ...human, actionType: 'diagnostics.fake_send', actor: { type: 'SYSTEM', id: null }, payload: {} }, ctx({ outboundState: 'EMERGENCY_STOP', recipients: [] }));
  assert.equal(r.decision, 'ACT');
});

test('time helpers respect the time zone', () => {
  const w = DEFAULT_POLICY_SETTINGS.sendWindow;
  // 14:00 UTC = 09:00 in New York (EST) on a Tuesday
  assert.equal(inSendWindow(new Date('2026-01-06T14:00:00Z'), 'America/New_York', w), true);
  assert.equal(inSendWindow(new Date('2026-01-06T13:59:00Z'), 'America/New_York', w), false);
  assert.equal(nextWindowStart(new Date('2026-01-06T03:00:00Z'), 'Asia/Karachi', w)?.toISOString(), '2026-01-06T04:00:00.000Z');
  assert.equal(nextLocalMidnight(new Date('2026-01-06T11:00:00Z'), 'Asia/Karachi').toISOString(), '2026-01-06T19:00:00.000Z');
  assert.equal(nextWindowStart(new Date('2026-01-06T11:00:00Z'), 'UTC', { ...w, days: [] }), null);
});

// ── Phase 12: replies in a conversation (email.reply) ──

const reply: PolicyRequest = { ...human, actionType: 'email.reply' };
const aiReply: PolicyRequest = { ...reply, actor: { type: 'AI_AGENT', id: null, agentType: 'CONVERSATION' } };

test('a reply is not cold outreach: no first-touch approval, cool-down or daily cap — and a person may reply at night', () => {
  const busy = { firstTouch: true, lastContactAt: '2026-01-06T10:00:00.000Z', sentToday: 10_000, settings: { ...DEFAULT_POLICY_SETTINGS, contactCooldownDays: 3, dailySendLimit: 50 } };
  assert.equal(evaluate(reply, ctx(busy)).decision, 'ACT');
  assert.equal(evaluate(reply, ctx({ ...busy, now: '2026-01-06T02:00:00.000Z' })).decision, 'ACT');
  assert.equal(evaluate(aiReply, ctx({ ...busy, autonomy: { workspace: 'L3', agent: null, agentEnabled: true } })).decision, 'ACT');
});

test('AI replies need L3 (below that a person approves), keep to sending hours, and only the Conversation Agent may send them', () => {
  const r = evaluate(aiReply, ctx({ firstTouch: false, autonomy: { workspace: 'L2', agent: null, agentEnabled: true } }));
  assert.equal(r.decision, 'ASK');
  assert.deepEqual(r.reasonCodes, ['AUTONOMY_TOO_LOW']);
  assert.equal(requiredAutonomy(false, true), 'L3');
  const night = evaluate(aiReply, ctx({ now: '2026-01-06T02:00:00.000Z', autonomy: { workspace: 'L3', agent: null, agentEnabled: true } }));
  assert.equal(night.decision, 'WAIT');
  assert.ok(night.reasonCodes.includes('OUTSIDE_SEND_WINDOW'));
  assert.deepEqual(evaluate({ ...aiReply, actor: { type: 'AI_AGENT', id: null, agentType: 'CAMPAIGN' } }, ctx()).reasonCodes, ['AI_NOT_AUTHORIZED']);
  assert.deepEqual(evaluate({ ...ai, actor: { type: 'AI_AGENT', id: null, agentType: 'CONVERSATION' } }, ctx()).reasonCodes, ['AI_NOT_AUTHORIZED']);
});

test('suppression and the kill switch still stop replies', () => {
  assert.deepEqual(evaluate(reply, ctx({ suppressions: [{ id: 's', scope: 'EMAIL', reason: 'UNSUBSCRIBED' }] })).reasonCodes, ['SUPPRESSED_CONTACT']);
  assert.deepEqual(evaluate(aiReply, ctx({ outboundState: 'EMERGENCY_STOP' })).reasonCodes, ['GLOBAL_EMERGENCY_STOP']);
  assert.equal(evaluate(reply, ctx({ outboundState: 'PAUSED' })).decision, 'WAIT');
});
