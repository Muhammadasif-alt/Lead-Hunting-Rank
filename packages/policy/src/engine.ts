import type { RiskLevel } from '@revenue-os/database';
import { AUTONOMY_LEVELS, POLICY_REASONS, type AutonomyLevel, type PolicyReasonCode } from '@revenue-os/shared';
import { actionDefinition, AGENT_ACTIONS } from './actions.js';
import { inSendWindow, nextLocalMidnight, nextWindowStart } from './time.js';
import type { PolicyContext, PolicyRequest, PolicyResult } from './types.js';

const rank = (l: AutonomyLevel) => AUTONOMY_LEVELS.indexOf(l);
const DAY_MS = 24 * 3_600_000;

/** The level the AI actually has: an agent may be set lower than the workspace, never higher (docs/10 §20-30). */
export function effectiveAutonomy(a: PolicyContext['autonomy']): AutonomyLevel {
  return a.agent && rank(a.agent) < rank(a.workspace) ? a.agent : a.workspace;
}

/**
 * The autonomy an AI needs to send on its own (docs/10 §20-30): L2 sends routine follow-ups, L3 also first outreach.
 * L0–L1 never send on their own — a person approves each message.
 */
export function requiredAutonomy(firstTouch: boolean): AutonomyLevel {
  return firstTouch ? 'L3' : 'L2';
}

function result(decision: PolicyResult['decision'], codes: PolicyReasonCode[], rules: string[], risk: RiskLevel, extra: Partial<PolicyResult> = {}): PolicyResult {
  return {
    decision,
    reasonCodes: codes,
    reasonSummary: codes.map((c) => POLICY_REASONS[c]).join('; '),
    matchedRules: rules,
    riskLevel: risk,
    resumeAt: null,
    requiredApproval: null,
    ...extra,
  };
}

/**
 * The Policy Engine (docs/10 §4, §139-149). Pure and deterministic: the same request and context always give the same
 * decision, and no model is ever asked. Precedence: hard safety → suppression/compliance → permission and authority →
 * autonomy and approval → operational limits (send window, daily limit, cool-down, provider). BLOCK beats ASK beats
 * WAIT; anything that cannot be established is not allowed.
 */
export function evaluate(req: PolicyRequest, ctx: PolicyContext): PolicyResult {
  const def = actionDefinition(req.actionType);
  if (!def) return result('BLOCK', ['POLICY_UNKNOWN_ACTION'], ['DEFAULT_DENY'], 'HIGH');
  const risk: RiskLevel = def.outbound && ctx.recipients.length > 10 ? 'HIGH' : def.risk;

  // ── hard safety ──
  if (ctx.workspaceStatus !== 'ACTIVE') return result('BLOCK', ['WORKSPACE_INACTIVE'], ['NO_CROSS_WORKSPACE_ACCESS'], risk);
  if (def.outbound) {
    if (ctx.outboundState === 'EMERGENCY_STOP') return result('BLOCK', ['GLOBAL_EMERGENCY_STOP'], ['KILL_SWITCH_BLOCKS_OUTBOUND'], risk);
    if (ctx.recipients.length === 0) return result('BLOCK', ['NO_RECIPIENT'], ['DEFAULT_DENY'], risk);
    // ── suppression / compliance: wins over campaigns, autonomy and approvals ──
    if (ctx.suppressions.length) return result('BLOCK', ['SUPPRESSED_CONTACT'], ['NO_SEND_TO_SUPPRESSED'], risk);
    if (ctx.invalidRecipients.length) return result('BLOCK', ['INVALID_CONTACT'], ['NO_SEND_TO_SUPPRESSED'], risk);
  }

  // ── permission and authority ──
  const isAi = req.actor.type === 'AI_AGENT';
  if (req.actor.type === 'HUMAN') {
    if (!req.actor.id || !ctx.actorPermissions) return result('BLOCK', ['UNKNOWN_ACTOR'], ['DEFAULT_DENY'], risk);
    if (def.permission && !ctx.actorPermissions.includes(def.permission)) return result('BLOCK', ['INSUFFICIENT_PERMISSION'], [`PERMISSION:${def.permission}`], risk);
  } else if (isAi) {
    const agent = req.actor.agentType ?? '';
    // A human's permission never transfers to the AI (NO_AI_PERMISSION_ESCALATION).
    if (!AGENT_ACTIONS[agent]?.includes(req.actionType)) return result('BLOCK', ['AI_NOT_AUTHORIZED'], ['NO_AI_PERMISSION_ESCALATION'], risk);
    if (ctx.autonomy.agentEnabled === false) return result('BLOCK', ['AGENT_DISABLED'], ['AGENT_DISABLED'], risk);
  } else if (def.outbound) {
    // Outbound always has a responsible human or agent; the system alone never decides to contact someone.
    return result('BLOCK', ['UNKNOWN_ACTOR'], ['DEFAULT_DENY'], risk);
  }

  if (def.outbound && ctx.outboundState === 'PAUSED') return result('WAIT', ['GLOBAL_OUTBOUND_PAUSED'], ['KILL_SWITCH_BLOCKS_OUTBOUND'], risk);

  // ── autonomy and approval ──
  const asks: PolicyReasonCode[] = [];
  const askRules: string[] = [];
  if (isAi && def.outbound) {
    const level = effectiveAutonomy(ctx.autonomy);
    if (rank(level) < rank(requiredAutonomy(ctx.firstTouch))) {
      asks.push('AUTONOMY_TOO_LOW');
      askRules.push(`AUTONOMY:${level}`);
    }
    if (ctx.firstTouch && ctx.settings.firstTouchApproval) {
      asks.push('FIRST_TOUCH_REQUIRES_APPROVAL');
      askRules.push('FIRST_TOUCH_APPROVAL');
    }
  }
  const granted: PolicyReasonCode[] = [];
  if (asks.length) {
    const approval = ctx.approval;
    if (approval?.status === 'REJECTED') return result('BLOCK', ['APPROVAL_REJECTED'], askRules, risk);
    const ask = (extra: PolicyReasonCode[]) =>
      result('ASK', [...asks, ...extra], askRules, risk, { requiredApproval: { permission: 'approval.decide', ttlHours: ctx.settings.approvalTtlHours } });
    if (approval?.status !== 'APPROVED') return ask([]);
    // Approval ≠ guaranteed execution: it holds only for this exact action and until it expires.
    if (approval.fingerprint !== ctx.fingerprint) return ask(['APPROVAL_STALE']);
    if (new Date(approval.expiresAt).getTime() <= new Date(ctx.now).getTime()) return ask(['APPROVAL_EXPIRED']);
    granted.push('APPROVAL_GRANTED');
  }

  // ── operational limits: WAIT, with the time to try again ──
  if (def.outbound) {
    const now = new Date(ctx.now);
    const waits: PolicyReasonCode[] = [];
    const rules: string[] = [];
    let resumeAt = now;
    const later = (d: Date) => {
      if (d > resumeAt) resumeAt = d;
    };
    if (ctx.providerAvailable === false) {
      waits.push('PROVIDER_UNAVAILABLE');
      rules.push('PROVIDER_HEALTH');
      later(new Date(now.getTime() + 15 * 60_000));
    }
    const limit = ctx.settings.dailySendLimit;
    if (limit !== null && ctx.sentToday + ctx.recipients.length > limit) {
      waits.push('DAILY_LIMIT_REACHED');
      rules.push('DAILY_SEND_LIMIT');
      later(nextLocalMidnight(now, ctx.timezone));
    }
    const cooldown = ctx.settings.contactCooldownDays;
    if (cooldown > 0 && ctx.lastContactAt) {
      const until = new Date(new Date(ctx.lastContactAt).getTime() + cooldown * DAY_MS);
      if (until > now) {
        waits.push('FREQUENCY_CAP');
        rules.push('CONTACT_COOLDOWN');
        later(until);
      }
    }
    const window = ctx.settings.sendWindow;
    if (window.enabled && (waits.length || !inSendWindow(now, ctx.timezone, window))) {
      const start = nextWindowStart(resumeAt, ctx.timezone, window);
      if (!start) return result('BLOCK', ['OUTSIDE_SEND_WINDOW'], ['SEND_WINDOW'], risk); // a window with no open hours
      if (!inSendWindow(now, ctx.timezone, window)) {
        waits.push('OUTSIDE_SEND_WINDOW');
        rules.push('SEND_WINDOW');
      }
      later(start);
    }
    if (waits.length) return result('WAIT', [...granted, ...waits], [...askRules, ...rules], risk, { resumeAt: resumeAt.toISOString() });
  }

  return result('ACT', granted.length ? granted : ['ALLOWED'], askRules, risk);
}
