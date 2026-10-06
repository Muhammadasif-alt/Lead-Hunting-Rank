/**
 * Policy catalog (docs/10, screen #17). Browser-safe: labels and defaults shared by the Policy Engine, the API and the
 * web app. Decisions are made only on the server by @revenue-os/policy.
 */
import { normalizeDomain, normalizeEmail, normalizePhone } from './normalize.js';

export const POLICY_OUTCOMES = ['ACT', 'ASK', 'WAIT', 'BLOCK'] as const;
export type PolicyOutcome = (typeof POLICY_OUTCOMES)[number];

export const AUTONOMY_LEVELS = ['L0', 'L1', 'L2', 'L3', 'L4'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_INFO: Record<AutonomyLevel, { label: string; description: string }> = {
  L0: { label: 'Manual', description: 'AI analyses, suggests and drafts. People do every external action.' },
  L1: { label: 'Assisted', description: 'AI researches, scores and prepares. Anything external asks a person first.' },
  L2: { label: 'Semi-autonomous', description: 'AI sends routine follow-ups on its own; first outreach and anything sensitive asks first.' },
  L3: { label: 'Autonomous', description: 'AI runs outreach and follow-ups within the rules. Pricing, legal and exceptions still go to a person.' },
  L4: { label: 'Goal-driven', description: 'AI plans within a goal and its limits. Same hard rules — never unlimited authority.' },
};

export const OUTBOUND_STATES = ['ACTIVE', 'PAUSED', 'EMERGENCY_STOP'] as const;
export type OutboundState = (typeof OUTBOUND_STATES)[number];

export const OUTBOUND_INFO: Record<OutboundState, { label: string; description: string }> = {
  ACTIVE: { label: 'Outbound on', description: 'Outbound actions run when the policy allows them.' },
  PAUSED: { label: 'Outbound paused', description: 'Nothing is sent. Waiting actions are checked again one by one after resuming.' },
  EMERGENCY_STOP: { label: 'Emergency stop', description: 'Every outbound action is blocked, including queued ones. Only an owner can resume.' },
};

/** Machine-readable reasons (docs/10 §32-34). The summary is what a person sees in "Why?". */
export const POLICY_REASONS = {
  ALLOWED: 'Every check passed',
  POLICY_UNKNOWN_ACTION: 'This kind of action has no policy, so it is not allowed (default deny)',
  POLICY_EVALUATION_FAILED: 'The policy could not be checked, so nothing was done (fail closed)',
  WORKSPACE_INACTIVE: 'The workspace is not active',
  GLOBAL_EMERGENCY_STOP: 'Emergency stop is on — all outbound is blocked',
  GLOBAL_OUTBOUND_PAUSED: 'Outbound is paused — this waits until it is resumed',
  SUPPRESSED_CONTACT: 'The recipient is on the do-not-contact list',
  INVALID_CONTACT: 'The email address failed verification',
  NO_RECIPIENT: 'The action has no recipient the policy can check',
  INSUFFICIENT_PERMISSION: 'The person who asked does not have permission for this',
  UNKNOWN_ACTOR: 'Who asked for this could not be established',
  AI_NOT_AUTHORIZED: 'This AI agent is not allowed to take this action',
  AGENT_DISABLED: 'This AI agent is turned off',
  AUTONOMY_TOO_LOW: 'The autonomy level does not let the AI do this on its own',
  FIRST_TOUCH_REQUIRES_APPROVAL: 'AI first messages to a new contact need approval',
  APPROVAL_GRANTED: 'A person approved this exact action',
  APPROVAL_STALE: 'The action changed after it was approved — it needs a new approval',
  APPROVAL_EXPIRED: 'The approval expired — it needs a new one',
  APPROVAL_REJECTED: 'A person rejected this action',
  OUTSIDE_SEND_WINDOW: 'Outside the sending hours — waits for the next window',
  DAILY_LIMIT_REACHED: 'The daily sending limit is reached — waits until tomorrow',
  FREQUENCY_CAP: 'This contact was messaged recently — waits for the cool-down',
  PROVIDER_UNAVAILABLE: 'The sending provider is not available right now',
} as const;
export type PolicyReasonCode = keyof typeof POLICY_REASONS;

/** Configurable workspace rules (docs/10 §35-36 "configurable"). Hard rules are not here — they cannot be changed. */
export interface PolicySettings {
  /** AI first messages to a contact need a person's approval, whatever the autonomy level. */
  firstTouchApproval: boolean;
  sendWindow: { enabled: boolean; startHour: number; endHour: number; days: number[] };
  /** Outbound emails per workspace per day (workspace time zone); null = no limit. */
  dailySendLimit: number | null;
  /** Minimum days between two messages to the same address. 0 = no cool-down. */
  contactCooldownDays: number;
  /** How long an approval stays valid. */
  approvalTtlHours: number;
}

export const DEFAULT_POLICY_SETTINGS: PolicySettings = {
  firstTouchApproval: true,
  sendWindow: { enabled: true, startHour: 9, endHour: 17, days: [1, 2, 3, 4, 5] },
  dailySendLimit: 50,
  contactCooldownDays: 3,
  approvalTtlHours: 24,
};

/** The hard safety rules (docs/10 §35-36). Shown read-only; no setting, role or approval can loosen them. */
export const HARD_RULE_INFO: Record<string, string> = {
  NO_SEND_TO_SUPPRESSED: 'Never contact an actively suppressed email, phone, person, company or domain.',
  NO_CROSS_WORKSPACE_ACCESS: 'No actor may read or change another workspace’s data.',
  NO_DUPLICATE_EXTERNAL_ACTION: 'One idempotency key produces at most one external effect.',
  NO_SECRETS_IN_AI_CONTEXT: 'Credentials and secrets never enter AI context.',
  NO_AI_PERMISSION_ESCALATION: 'AI never gains authority because a human has it.',
  KILL_SWITCH_BLOCKS_OUTBOUND: 'Emergency stop blocks every outbound action.',
  DEFAULT_DENY: 'An action without a policy is not allowed; a policy that cannot be checked allows nothing.',
};

export const SUPPRESSION_SCOPES = ['EMAIL', 'DOMAIN', 'PHONE', 'PERSON', 'COMPANY'] as const;
export type SuppressionScope = (typeof SUPPRESSION_SCOPES)[number];

export const SUPPRESSION_REASONS = {
  UNSUBSCRIBED: { label: 'Unsubscribed', liftable: false },
  COMPLAINT: { label: 'Complaint', liftable: false },
  LEGAL: { label: 'Legal hold', liftable: false },
  DO_NOT_CONTACT: { label: 'Do not contact', liftable: true },
  MANUAL: { label: 'Added by hand', liftable: true },
  INVALID_CONTACT: { label: 'Invalid contact', liftable: true },
  BOUNCE_POLICY: { label: 'Bounced', liftable: true },
} as const;
export type SuppressionReason = keyof typeof SUPPRESSION_REASONS;

/** The comparable key for a suppression; null when the value doesn't fit the scope. */
export function normalizeSuppressionValue(scope: SuppressionScope, raw: string): string | null {
  switch (scope) {
    case 'EMAIL':
      return normalizeEmail(raw);
    case 'DOMAIN':
      return normalizeDomain(raw);
    case 'PHONE':
      return normalizePhone(raw);
    case 'PERSON':
    case 'COMPANY':
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.trim()) ? raw.trim().toLowerCase() : null;
  }
}
