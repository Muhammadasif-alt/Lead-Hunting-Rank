import type { Prisma, PrismaClient } from '@revenue-os/database';
import { AUTONOMY_LEVELS, type AutonomyLevel, type PolicyOutcome, type PolicySettings } from '@revenue-os/shared';
import { evaluate } from './engine.js';
import { loadPolicySettings } from './settings.js';
import type { PolicyContext, PolicyRequest, PolicyResult } from './types.js';

export interface PolicyDraft {
  autonomyLevel: AutonomyLevel;
  settings: PolicySettings;
}

interface Scenario {
  key: string;
  label: string;
  request: Omit<PolicyRequest, 'stage' | 'entity' | 'payload' | 'externalActionId'>;
  context: Partial<PolicyContext>;
}

const SENDER = ['conversation.send', 'company.read'];
const ENTITY = { type: 'PERSON' as const, id: '00000000-0000-4000-8000-000000000001' };
const PAYLOAD = { from: 'you@example.com', to: ['owner@prospect.example'], subject: 'Hello', text: 'Hi there' };
// A Tuesday, 11:00 UTC — inside default sending hours, so only the scenario's own condition matters.
const TUESDAY_11 = '2026-01-06T11:00:00.000Z';

/** Fixed situations from docs/10 §126-138 — what the policy would do in each, before and after a change. */
const SCENARIOS: Scenario[] = [
  { key: 'ai_first_touch', label: 'AI first email to a new contact', request: { actionType: 'email.send', actor: { type: 'AI_AGENT', id: null, agentType: 'CAMPAIGN' } }, context: {} },
  {
    key: 'ai_follow_up',
    label: 'AI follow-up to someone emailed a week ago',
    request: { actionType: 'email.send', actor: { type: 'AI_AGENT', id: null, agentType: 'CAMPAIGN' } },
    context: { firstTouch: false, lastContactAt: '2025-12-30T11:00:00.000Z' },
  },
  { key: 'human_send', label: 'Salesperson sends an email', request: { actionType: 'email.send', actor: { type: 'HUMAN', id: 'user' } }, context: {} },
  { key: 'viewer_send', label: 'Viewer tries to send', request: { actionType: 'email.send', actor: { type: 'HUMAN', id: 'user' } }, context: { actorPermissions: ['company.read'] } },
  { key: 'research_agent_send', label: 'Research agent tries to send', request: { actionType: 'email.send', actor: { type: 'AI_AGENT', id: null, agentType: 'RESEARCH' } }, context: {} },
  {
    key: 'suppressed',
    label: 'Approved email to an unsubscribed contact',
    request: { actionType: 'email.send', actor: { type: 'AI_AGENT', id: null, agentType: 'CAMPAIGN' } },
    context: { suppressions: [{ id: 's', scope: 'EMAIL', reason: 'UNSUBSCRIBED' }], approval: { id: 'a', status: 'APPROVED', fingerprint: 'fp', expiresAt: '2026-01-07T11:00:00.000Z' } },
  },
  {
    key: 'stale_approval',
    label: 'Approved, then the message was edited',
    request: { actionType: 'email.send', actor: { type: 'AI_AGENT', id: null, agentType: 'CAMPAIGN' } },
    context: { approval: { id: 'a', status: 'APPROVED', fingerprint: 'old', expiresAt: '2026-01-07T11:00:00.000Z' } },
  },
  {
    key: 'ai_reply',
    label: 'AI answers a prospect who replied',
    request: { actionType: 'email.reply', actor: { type: 'AI_AGENT', id: null, agentType: 'CONVERSATION' } },
    context: { firstTouch: false, lastContactAt: '2026-01-05T11:00:00.000Z' },
  },
  { key: 'human_reply_night', label: 'Salesperson replies at 02:00', request: { actionType: 'email.reply', actor: { type: 'HUMAN', id: 'user' } }, context: { now: '2026-01-06T02:00:00.000Z', firstTouch: false } },
  { key: 'night', label: 'Salesperson email at 02:00', request: { actionType: 'email.send', actor: { type: 'HUMAN', id: 'user' } }, context: { now: '2026-01-06T02:00:00.000Z' } },
  { key: 'daily_limit', label: 'Daily limit already used up', request: { actionType: 'email.send', actor: { type: 'HUMAN', id: 'user' } }, context: { sentToday: 10_000 } },
  { key: 'paused', label: 'Outbound paused', request: { actionType: 'email.send', actor: { type: 'HUMAN', id: 'user' } }, context: { outboundState: 'PAUSED' } },
  { key: 'emergency', label: 'Emergency stop, queued email', request: { actionType: 'email.send', actor: { type: 'HUMAN', id: 'user' } }, context: { outboundState: 'EMERGENCY_STOP' } },
];

function scenarioContext(draft: PolicyDraft, s: Scenario): PolicyContext {
  return {
    now: TUESDAY_11,
    timezone: 'UTC',
    workspaceStatus: 'ACTIVE',
    outboundState: 'ACTIVE',
    policyVersion: 0,
    settings: draft.settings,
    autonomy: { workspace: draft.autonomyLevel, agent: null, agentEnabled: null },
    actorPermissions: SENDER,
    recipients: PAYLOAD.to,
    suppressions: [],
    invalidRecipients: [],
    firstTouch: true,
    sentToday: 0,
    lastContactAt: null,
    providerAvailable: null,
    approval: null,
    fingerprint: 'fp',
    ...s.context,
  };
}

const brief = (r: PolicyResult) => ({ decision: r.decision, reasonCodes: r.reasonCodes, reasonSummary: r.reasonSummary, resumeAt: r.resumeAt });
const tally = () => ({ ACT: 0, ASK: 0, WAIT: 0, BLOCK: 0 }) as Record<PolicyOutcome, number>;

/**
 * Policy Simulator (docs/10 §76-92, docs/17 §62-66): runs the fixed scenarios and the workspace's recent real decisions
 * under the current policy and under a draft, and shows what would change. Read-only — nothing is saved or executed.
 */
export async function simulatePolicy(db: PrismaClient, workspaceId: string, draft: Partial<PolicyDraft>, historyLimit = 200) {
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { autonomyLevel: true } });
  const { settings, version } = await loadPolicySettings(db, workspaceId);
  const current: PolicyDraft = { autonomyLevel: ws.autonomyLevel as AutonomyLevel, settings };
  const proposed: PolicyDraft = {
    autonomyLevel: draft.autonomyLevel && AUTONOMY_LEVELS.includes(draft.autonomyLevel) ? draft.autonomyLevel : current.autonomyLevel,
    settings: draft.settings ?? current.settings,
  };

  const scenarios = SCENARIOS.map((s) => {
    const req: PolicyRequest = { ...s.request, stage: 'PREPARE', entity: ENTITY, payload: PAYLOAD };
    const before = evaluate(req, scenarioContext(current, s));
    const after = evaluate(req, scenarioContext(proposed, s));
    return { key: s.key, label: s.label, current: brief(before), draft: brief(after), changed: before.decision !== after.decision };
  });

  // Replay recent decisions: same request and context, with the draft's autonomy and rules swapped in.
  const rows = await db.policyDecision.findMany({ where: { workspaceId, stage: { in: ['PREPARE', 'EXECUTION'] } }, orderBy: { evaluatedAt: 'desc' }, take: historyLimit });
  const counts = { current: tally(), draft: tally() };
  const changes: { id: string; actionType: string; evaluatedAt: Date; current: ReturnType<typeof brief>; draft: ReturnType<typeof brief> }[] = [];
  let replayed = 0;
  for (const row of rows) {
    const input = row.input as Prisma.JsonObject as unknown as { request: PolicyRequest; context: PolicyContext | null };
    if (!input?.context) continue; // the policy could not be evaluated then — nothing to replay
    replayed++;
    const recorded = evaluate(input.request, { ...input.context, autonomy: { ...input.context.autonomy, workspace: current.autonomyLevel }, settings: current.settings });
    const next = evaluate(input.request, { ...input.context, autonomy: { ...input.context.autonomy, workspace: proposed.autonomyLevel }, settings: proposed.settings });
    counts.current[recorded.decision]++;
    counts.draft[next.decision]++;
    if (recorded.decision !== next.decision && changes.length < 20) changes.push({ id: row.id, actionType: row.actionType, evaluatedAt: row.evaluatedAt, current: brief(recorded), draft: brief(next) });
  }

  return { policyVersion: version, current, draft: proposed, scenarios, history: { replayed, counts, changes } };
}
