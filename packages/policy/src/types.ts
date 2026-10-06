import type { ActorType, EntityType, RiskLevel } from '@revenue-os/database';
import type { AutonomyLevel, OutboundState, PermissionKey, PolicyOutcome, PolicyReasonCode, PolicySettings } from '@revenue-os/shared';

export type PolicyStage = 'PREPARE' | 'APPROVAL' | 'EXECUTION';

export interface PolicyActor {
  type: ActorType;
  id: string | null;
  /** Set when type is AI_AGENT. */
  agentType?: string | null;
}

/** What someone wants to do (docs/10 §32 PolicyRequest). */
export interface PolicyRequest {
  stage: PolicyStage;
  actionType: string;
  actor: PolicyActor;
  entity: { type: EntityType; id: string };
  externalActionId?: string | null;
  payload: Record<string, unknown>;
}

/**
 * Everything the decision depends on, loaded fresh from the database (never cached for suppression, kill switch or
 * permissions — docs/10 §110-118). Plain JSON, so it is stored with the decision and the simulator can replay it.
 */
export interface PolicyContext {
  now: string;
  timezone: string;
  workspaceStatus: string;
  outboundState: OutboundState;
  policyVersion: number;
  settings: PolicySettings;
  autonomy: { workspace: AutonomyLevel; agent: AutonomyLevel | null; agentEnabled: boolean | null };
  /** HUMAN actors: effective permissions (deny wins); null when the actor isn't an active member. */
  actorPermissions: string[] | null;
  /** Normalized recipient emails. */
  recipients: string[];
  /** Active suppressions matching a recipient, its domain, person or company. */
  suppressions: { id: string; scope: string; reason: string }[];
  /** Recipients whose address failed verification. */
  invalidRecipients: string[];
  /** No earlier outbound message reached any of the recipients. */
  firstTouch: boolean;
  sentToday: number;
  lastContactAt: string | null;
  /** false when the pinned mailbox/integration is disconnected or disabled; null = not checked. */
  providerAvailable: boolean | null;
  /** The latest decided approval for this action, if any. */
  approval: { id: string; status: 'APPROVED' | 'REJECTED'; fingerprint: string; expiresAt: string } | null;
  /** Material fields of the action now. */
  fingerprint: string;
}

/** docs/10 §32-34 PolicyDecision. */
export interface PolicyResult {
  decision: PolicyOutcome;
  reasonCodes: PolicyReasonCode[];
  reasonSummary: string;
  matchedRules: string[];
  riskLevel: RiskLevel;
  /** WAIT: when to try again (null = when the blocking condition clears, e.g. outbound resumed). */
  resumeAt: string | null;
  /** ASK: who may approve, and for how long the approval holds. */
  requiredApproval: { permission: PermissionKey; ttlHours: number } | null;
}
