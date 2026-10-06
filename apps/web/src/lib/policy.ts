import type {
  AutonomyLevel,
  OutboundState,
  PolicyOutcome,
  PolicySettings,
  SuppressionReason,
  SuppressionScope,
} from "@revenue-os/shared";

export interface OutboundInfo {
  state: OutboundState;
  reason: string | null;
  changedAt: string | null;
  changedBy: string | null;
}

export interface PolicyDecisionRow {
  id: string;
  stage: "PREPARE" | "APPROVAL" | "EXECUTION";
  actionType: string;
  actor: { type: string; id: string | null; agentType: string | null };
  entity: { type: string; id: string; name: string | null };
  externalActionId: string | null;
  decision: PolicyOutcome;
  reasonCodes: string[];
  reasonSummary: string;
  matchedRules: string[];
  policyVersion: number;
  riskLevel: string;
  resumeAt: string | null;
  evaluatedAt: string;
}

export interface PolicyOverview {
  outbound: OutboundInfo;
  autonomyLevel: AutonomyLevel;
  timezone: string;
  policyVersion: number;
  settings: PolicySettings;
  hardRules: { key: string; description: string }[];
  last7Days: Record<PolicyOutcome, number>;
  pendingApprovals: number;
  activeSuppressions: number;
  decisions: PolicyDecisionRow[];
}

export interface ApprovalRow {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "INVALIDATED" | "CANCELLED";
  actionType: string;
  entity: { type: string; id: string; name: string | null };
  requestedBy: { type: string; agentType: string | null; name: string | null };
  preview: { to: string[]; subject: string | null; text: string | null };
  reasonCodes: string[];
  reason: string;
  riskLevel: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export interface SuppressionRow {
  id: string;
  scope: SuppressionScope;
  value: string;
  label: string;
  reason: SuppressionReason;
  status: "ACTIVE" | "LIFTED";
  note: string | null;
  source: string;
  createdByType: string;
  createdAt: string;
  liftedAt: string | null;
  liftReason: string | null;
}

interface SimDecision {
  decision: PolicyOutcome;
  reasonCodes: string[];
  reasonSummary: string;
  resumeAt: string | null;
}

export interface SimulationResult {
  policyVersion: number;
  current: { autonomyLevel: AutonomyLevel; settings: PolicySettings };
  draft: { autonomyLevel: AutonomyLevel; settings: PolicySettings };
  scenarios: { key: string; label: string; current: SimDecision; draft: SimDecision; changed: boolean }[];
  history: {
    replayed: number;
    counts: { current: Record<PolicyOutcome, number>; draft: Record<PolicyOutcome, number> };
    changes: { id: string; actionType: string; evaluatedAt: string; current: SimDecision; draft: SimDecision }[];
  };
}

/** Colour per outcome — ACT brand, ASK accent, WAIT amber, BLOCK danger. */
export const OUTCOME_STYLE: Record<PolicyOutcome, string> = {
  ACT: "border-brand/25 bg-brand-soft text-brand",
  ASK: "border-accent/25 bg-accent-soft text-accent",
  WAIT: "border-amber/30 bg-amber-soft text-amber",
  BLOCK: "border-danger/25 bg-danger-soft text-danger",
};

export const OUTCOME_LABEL: Record<PolicyOutcome, string> = {
  ACT: "Act",
  ASK: "Ask a person",
  WAIT: "Wait",
  BLOCK: "Block",
};

export const ACTION_LABEL: Record<string, string> = {
  "email.send": "Send email",
  "diagnostics.fake_send": "Pipeline self-test",
};

export const SCOPE_LABEL: Record<SuppressionScope, string> = {
  EMAIL: "Email",
  DOMAIN: "Domain",
  PHONE: "Phone",
  PERSON: "Person",
  COMPANY: "Company",
};

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function actorLabel(a: { type: string; agentType: string | null; name?: string | null }): string {
  if (a.type === "AI_AGENT") return `${(a.agentType ?? "AI").toLowerCase().replace("_", " ")} agent`;
  if (a.type === "HUMAN") return a.name ?? "a person";
  return a.type.toLowerCase();
}
